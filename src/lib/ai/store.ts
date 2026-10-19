import { randomUUID } from "crypto";
import { HttpError } from "@/lib/server/http";
import { throwRpc } from "@/lib/server/rpc";
import { decrypt, encrypt } from "./crypto";

export interface AiPolicy { external_enabled: boolean; retention_days: number }
export type AiModule = "assistant" | "builder";

export async function getPolicy(db: any, clinicId: string): Promise<AiPolicy> {
  const { data, error } = await db.rpc("ai_policy", { p_clinic: clinicId });
  // Before migration 009 is installed, behave in the safest way: nothing leaves, nothing stored.
  if (error || !data) return { external_enabled: false, retention_days: 0 };
  return data as AiPolicy;
}

export async function setPolicy(db: any, clinicId: string, patch: Partial<AiPolicy>): Promise<AiPolicy> {
  const { data, error } = await db.rpc("ai_set_policy", { p_clinic: clinicId, p: patch });
  if (error) throwRpc(error);
  return data as AiPolicy;
}

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export const newSession = () => randomUUID();

export interface LogInput {
  clinicId: string; userId: string; sessionId: string; module: AiModule; question: string; answer: string;
  source: "local" | "rules" | "external"; intent?: string; sentText?: string; redactions?: number;
}

/** Stores one question and answer. Never throws: the user already has their answer. */
export async function logInteraction(db: any, i: LogInput): Promise<void> {
  try {
    const q = encrypt(i.question.slice(0, 2000)), a = encrypt(i.answer.slice(0, 6000));
    const s = i.sentText ? encrypt(i.sentText.slice(0, 6000)) : null;
    await db.rpc("ai_log", { p: { clinic_id: i.clinicId, user_id: i.userId, session_id: i.sessionId, module: i.module, question: q.value, answer: a.value,
      sent_text: s?.value ?? null, encrypted: q.encrypted, intent: i.intent ?? null, source: i.source, redactions: i.redactions ?? 0 } });
  } catch (e) { console.error("ai_log failed:", (e as Error).message); }
}

/** The AI's memory for this conversation. Comes from our database, so deleting history makes the AI forget it. */
export async function loadHistory(db: any, clinicId: string, userId: string, sessionId: string, limit = 8): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data } = await db.from("ai_questionnaire").select("question, answer, encrypted").eq("clinic_id", clinicId).eq("user_id", userId).eq("session_id", sessionId)
    .order("created_at", { ascending: false }).limit(limit);
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const r of (data ?? []).reverse()) {
    turns.push({ role: "user", content: decrypt(r.question, r.encrypted) });
    if (r.answer) turns.push({ role: "assistant", content: decrypt(r.answer, r.encrypted) });
  }
  return turns;
}

export async function listHistory(db: any, clinicId: string, userId: string, opts: { all: boolean; module?: string; limit?: number }) {
  let q = db.from("ai_questionnaire").select("id, user_id, session_id, module, question, answer, sent_text, encrypted, source, redactions, created_at")
    .eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(Math.min(opts.limit ?? 100, 300));
  if (!opts.all) q = q.eq("user_id", userId);
  if (opts.module) q = q.eq("module", opts.module);
  const { data, error } = await q;
  if (error) throw new HttpError(500, /does not exist/.test(error.message) ? "AI history is not installed yet. Run supabase/migrations/009_ai_trust_layer.sql in the Supabase SQL editor." : error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, user_id: r.user_id, session_id: r.session_id, module: r.module, source: r.source, redactions: r.redactions, created_at: r.created_at,
    question: decrypt(r.question, r.encrypted), answer: decrypt(r.answer, r.encrypted), sent_text: r.sent_text ? decrypt(r.sent_text, r.encrypted) : null }));
}

export async function deleteHistory(db: any, clinicId: string, actor: string, spec: { scope: "one" | "session" | "mine" | "all"; id?: string; session_id?: string }): Promise<number> {
  const { data, error } = await db.rpc("ai_delete", { p_clinic: clinicId, p_actor: actor, p: spec });
  if (error) throwRpc(error);
  return data as number;
}
