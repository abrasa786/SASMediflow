import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase";
import { runScheduledFlows } from "@/lib/flows/engine";
import { runRecallDaily } from "@/lib/recall/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily job (Vercel Cron): day-before reminders, morning flows, low-stock flows, and any events still waiting. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const db = createAdminClient();
  const flows = await runScheduledFlows(db);
  let recall = { clinics: 0, sent: 0 };
  try { recall = await runRecallDaily(db); } catch (e) { console.error("daily recall failed:", e instanceof Error ? e.message : e); }
  return NextResponse.json({ ok: true, ...flows, recall });
}
