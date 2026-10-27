import { NextRequest } from "next/server";
import { handle, HttpError, loadSchema, requireClinicAdmin } from "@/lib/builder/server";
import { makePlan } from "@/lib/builder/planner";
import { describeStep } from "@/lib/builder/validate";
import { AiDisabledError, externalAiAvailable, generate } from "@/lib/ai/gateway";
import { isUuid, logInteraction, newSession } from "@/lib/ai/store";
import { loadSchemaWithBuiltins } from "@/lib/builder/builtin";
import { checkScope, OutOfScopeError, refusal } from "@/lib/ai/scope";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { clinicId, prompt, history, sessionId } = await req.json();
    const { db, specialty, userId } = await requireClinicAdmin(req, clinicId);
    if (typeof prompt !== "string" || !prompt.trim()) throw new HttpError(400, "Tell me what you would like to build.");
    if (prompt.length > 2000) throw new HttpError(400, "Please keep the request under 2000 characters.");

    const sid = isUuid(sessionId) ? sessionId : newSession();
    const { data: cr } = await db.from("clinics").select("ai_name").eq("id", clinicId).maybeSingle();
    const botName: string = cr?.ai_name || "Assistant";
    const hist = Array.isArray(history) ? history : [];
    const scope = checkScope(prompt, { module: "builder", hasHistory: hist.length > 0 });
    if (!scope.ok) {
      const reply = refusal("builder", botName);
      await logInteraction(db, { clinicId, userId, sessionId: sid, module: "builder", question: prompt.trim(), answer: reply, source: "local", intent: "out_of_scope" });
      return { message: reply, plan: null, source: "rules", lines: [], sessionId: sid };
    }
    const schema = await loadSchemaWithBuiltins(db, clinicId, await loadSchema(db, clinicId));
    // The external model is used only if this clinic's admin switched it on; otherwise the built-in rules plan the change.
    const external = (await externalAiAvailable(db, clinicId)) === "on";
    let sent = "", redactions = 0;
    const result = await makePlan({
      prompt: prompt.trim(), schema, specialty,
      history: Array.isArray(history) ? history.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) })) : [],
      generate: external ? async ({ system, turns }) => {
        try { const o = await generate({ db, clinicId, userId, system, turns, json: true, maxTokens: 4096, scope: { module: "builder", text: prompt, hasHistory: hist.length > 0 } }); sent = o.sentText; redactions += o.redactions; return o.text; }
        catch (e) { if (e instanceof AiDisabledError || e instanceof OutOfScopeError) throw e; throw e; }
      } : undefined,
    });
    if (!result.plan) { try { await db.from("builder_unhandled").insert({ clinic_id: clinicId, user_id: userId, prompt: prompt.trim().slice(0, 1000) }); } catch { /* best effort */ } }
    const lines = result.plan ? result.plan.steps.map(describeStep) : [];
    await logInteraction(db, { clinicId, userId, sessionId: sid, module: "builder", question: prompt.trim(), answer: [result.message, ...lines.map((l: string) => "• " + l)].join("\n"),
      source: result.source === "gemini" ? "external" : "rules", sentText: sent || undefined, redactions });
    return { ...result, lines, sessionId: sid };
  });
}
