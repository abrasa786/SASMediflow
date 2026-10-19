/**
 * Reports and dashboards by chat, for everyone on the team (data access follows the signed-in person):
 *   "Show appointments by doctor"            -> runs it now and answers in text
 *   "Create a report of unpaid invoices by month" / "Create a dashboard called Daily ops with ..." -> confirm, then save
 *   "Show my dashboards"                     -> lists saved dashboards and reports
 * Changing the app itself (new tables, fields, flows) stays with the Builder.
 */
import { describeAgentStep, parseAssistantRequest, parseReportPhrase } from "@/lib/builder/agent-tools";
import { isYes, type AxCtx, type AxReply } from "./common";

export function detectReport(t: string): boolean {
  return /\b(?:reports?|dashboards?|charts?|graphs?|analytics)\b/i.test(t) || /^(?:show|give|chart|graph)\s+(?:me\s+)?.+\s(?:by|per)\s.+/i.test(t.trim());
}

export async function handleReports(c: AxCtx): Promise<AxReply | null> {
  if (c.prev?.intent === "ax:rep_confirm") {
    if (!isYes(c.message)) return null;
    const { error } = await c.db.rpc("assistant_apply", { p_clinic: c.clinicId, p_actor: c.userId, p_prompt: c.prev.prompt ?? "", p_plan: { steps: c.prev.steps } });
    if (error) return { reply: `I couldn't save that: ${String(error.message).replace(/^[A-Z_]+:\s*/, "")}`, draft: null };
    const dash = (c.prev.steps as any[]).some((s) => s.tool === "create_dashboard");
    return { reply: `Done. ${dash ? "The dashboard and its reports are saved." : "The report is saved."} Everyone with access to that data can open it.`, draft: null, actions: [{ label: dash ? "Open dashboards" : "Open reports", url: "/reports" }] };
  }
  if (!detectReport(c.message)) return null;
  const t = c.message.trim();
  const { loadSchema } = await import("@/lib/builder/server");
  const schema = await loadSchema(c.db, c.clinicId);

  if (/^(?:show|list|view|see|open|what)\b.*\b(?:my |the |all |saved )?(?:dashboards?|reports?)\b\s*\??$/i.test(t) && !/\bby\b/i.test(t)) {
    const [{ data: ds }, { data: rs }] = await Promise.all([
      c.db.from("saved_dashboards").select("name").eq("clinic_id", c.clinicId).order("name").limit(20),
      c.db.from("saved_reports").select("name").eq("clinic_id", c.clinicId).order("name").limit(30),
    ]);
    return { reply: `Dashboards: ${(ds ?? []).map((d: any) => d.name).join(", ") || "none yet"}.\nReports: ${(rs ?? []).map((r: any) => r.name).join(", ") || "none yet"}.\nSay “Create a dashboard called Daily ops with appointments by doctor and unpaid invoices by month” to add one.`, draft: null, actions: [{ label: "Open reports", url: "/reports" }] };
  }

  const wantsSave = /^(?:please\s+)?(?:create|make|build|add|save|new|set up)\b/i.test(t) || /\bdashboard\b/i.test(t);
  if (wantsSave) {
    const r = parseAssistantRequest(t, schema);
    if (!r) return null;
    if ("error" in r) return { reply: r.error, draft: null };
    return { reply: `${r.message}\n${r.steps.map((s) => "• " + describeAgentStep(s)).join("\n")}\nReply yes to save.`, draft: { intent: "ax:rep_confirm", steps: r.steps, prompt: t.slice(0, 500) } };
  }

  // ad-hoc: run it now
  const phrase = t.replace(/^(?:show|give|chart|graph|report)\s+(?:me\s+)?/i, "");
  const rep = parseReportPhrase(phrase, schema);
  if (!rep) return { reply: "I couldn't turn that into a report. Try “appointments by doctor”, “unpaid invoices by month” or “patients by gender”.", draft: null };
  const { data, error } = await c.db.rpc("builder_query", { p_clinic: c.clinicId, p_actor: c.userId, p: { ...rep.spec, limit: rep.spec.limit ?? 20 } });
  if (error) return { reply: String(error.message).replace(/^[A-Z_]+:\s*/, ""), draft: null };
  const rows: any[] = data?.rows ?? data?.groups ?? [];
  const lines = rows.slice(0, 12).map((r) => "• " + Object.values(r).filter((v) => v != null).join(": "));
  const body = data?.value != null && !rows.length ? String(data.value) : lines.join("\n") || "No data yet.";
  return { reply: `${rep.name}\n${body}\nSay “create a report of ${phrase}” to keep it.`, draft: null };
}
