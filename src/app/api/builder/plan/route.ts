import { NextRequest } from "next/server";
import { handle, HttpError, loadSchema, requireClinicAdmin } from "@/lib/builder/server";
import { makePlan } from "@/lib/builder/planner";
import { describeStep } from "@/lib/builder/validate";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { clinicId, prompt, history } = await req.json();
    const { db, specialty } = await requireClinicAdmin(req, clinicId);
    if (typeof prompt !== "string" || !prompt.trim()) throw new HttpError(400, "Tell me what you would like to build.");
    if (prompt.length > 2000) throw new HttpError(400, "Please keep the request under 2000 characters.");

    const schema = await loadSchema(db, clinicId);
    const result = await makePlan({
      prompt: prompt.trim(), schema, specialty,
      history: Array.isArray(history) ? history.slice(-6).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) })) : [],
    });
    return { ...result, lines: result.plan ? result.plan.steps.map(describeStep) : [] };
  });
}
