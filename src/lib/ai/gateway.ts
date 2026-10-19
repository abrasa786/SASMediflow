/**
 * The ONLY place in the product that talks to an external AI provider (enforced by tests/unit/architecture.test.ts).
 * Every call goes through these gates, in order:
 *   1. Clinic policy: external AI must have been switched on by the clinic admin (default OFF).
 *   2. Rate limit per person.
 *   3. De-identification: known names -> tokens, phone/e-mail/Aadhaar/PAN/long numbers -> labels.
 *   4. Stateless call: no conversation id or memory at the provider; history is replayed from OUR database.
 *   5. The answer is returned to the clinic with the real names put back; nothing is stored at the provider by us.
 * The model's output is plain text or JSON that our code validates. It never executes anything on its own.
 */
import { HttpError } from "@/lib/server/http";
import { throwRpc } from "@/lib/server/rpc";
import { Pseudonymizer, redactText } from "./redact";
import { getPolicy } from "./store";
import { checkScope, OutOfScopeError, SCOPE_RULE, type ScopeModule } from "./scope";

export class AiDisabledError extends Error { constructor(public reason: "off" | "no_key") { super(reason === "off" ? "External AI is switched off for this clinic." : "No AI provider key is configured."); } }

export interface GenerateInput {
  db: any; clinicId: string; userId: string;
  system: string; turns: { role: "user" | "assistant"; content: string }[];
  names?: string[];                       // patient/staff names to pseudonymise
  json?: boolean; maxTokens?: number; temperature?: number; timeoutMs?: number;
  /** The person's own words and which module is asking. The gateway re-checks scope itself (defence in depth). */
  scope: { module: ScopeModule; text: string; hasOpenRequest?: boolean; hasHistory?: boolean };
}
export interface GenerateOutput { text: string; sentText: string; redactions: number }

export async function externalAiAvailable(db: any, clinicId: string): Promise<"on" | "off" | "no_key"> {
  if (!process.env.GEMINI_API_KEY) return "no_key";
  return (await getPolicy(db, clinicId)).external_enabled ? "on" : "off";
}

export async function generate(i: GenerateInput): Promise<GenerateOutput> {
  const sc = checkScope(i.scope.text, { module: i.scope.module, hasOpenRequest: i.scope.hasOpenRequest, hasHistory: i.scope.hasHistory });
  if (!sc.ok) throw new OutOfScopeError(sc.topic ?? "other");
  const state = await externalAiAvailable(i.db, i.clinicId);
  if (state !== "on") throw new AiDisabledError(state === "off" ? "off" : "no_key");
  const { error: rl } = await i.db.rpc("ai_rate_check", { p_clinic: i.clinicId, p_user: i.userId, p_per_minute: 20 });
  if (rl) { if (/RATE_LIMIT/.test(rl.message)) throw new HttpError(429, "You are asking very quickly. Wait a minute and try again."); throwRpc(rl); }

  const pseudo = new Pseudonymizer(i.names ?? []);
  let redactions = 0;
  const clean = (t: string) => { const a = pseudo.apply(t), b = redactText(a.text); redactions += a.count + b.count; return b.text; };
  const system = clean(i.system + "\n\n" + SCOPE_RULE);
  const turns = i.turns.slice(-8).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: clean(t.content).slice(0, 1500) }] }));
  const sentText = turns.map((t) => t.parts[0].text).join("\n---\n");

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: turns,
      generationConfig: { temperature: i.temperature ?? 0.2, maxOutputTokens: i.maxTokens ?? 512, ...(i.json ? { responseMimeType: "application/json" } : {}) } }),
    signal: AbortSignal.timeout(i.timeoutMs ?? 20000),
  });
  if (!res.ok) { const e: any = await res.json().catch(() => ({})); throw new HttpError(502, e?.error?.message ?? "The AI service is not responding. Try again shortly."); }
  const j: any = await res.json();
  const text: string = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (/^\s*OUT_OF_SCOPE/i.test(text)) throw new OutOfScopeError("model declined");
  return { text: pseudo.restore(text), sentText, redactions };
}
