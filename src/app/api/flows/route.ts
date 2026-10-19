import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { describeAgentStep, type AgentStep } from "@/lib/builder/agent-tools";

export const dynamic = "force-dynamic";

/** What flows exist and what they did recently. Read only: flows are created and paused by chatting with the AI Builder. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db } = await requireClinicMember(req, clinicId, ["admin"]);
    const [f, r] = await Promise.all([
      db.from("flows").select("id, name, description, trigger_event, trigger_object, conditions, actions, is_active, created_at").eq("clinic_id", clinicId).order("created_at"),
      db.from("flow_runs").select("id, flow_name, event, status, detail, created_at").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(50),
    ]);
    const flows = (f.data ?? []).map((x: any) => ({ ...x, summary: describeAgentStep({ tool: "create_flow", args: { name: x.name, trigger: { event: x.trigger_event, object: x.trigger_object ?? undefined }, conditions: x.conditions, actions: x.actions } } as AgentStep) }));
    return { flows, runs: r.data ?? [] };
  });
}
