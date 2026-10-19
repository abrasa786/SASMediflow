import { parseBookingText } from "@/lib/booking/parse";
import { handleCalendar } from "./calendar";
import { handleRecords } from "./records";
import { handleReports } from "./reports";
import type { AxCtx, AxReply } from "./common";

/** Order matters: an open request first, then calendar (specific verbs), then reports, then records. Returns null when nothing here applies. */
export async function runAssistantModules(c: AxCtx): Promise<AxReply | null> {
  const open = String(c.prev?.intent ?? "");
  if (open.startsWith("ax:cal_")) return handleCalendar(c);
  if (open.startsWith("ax:rep_")) return handleReports(c);
  if (open.startsWith("ax:rec_")) return handleRecords(c, parseBookingText as any);
  return (await handleCalendar(c)) ?? (await handleReports(c)) ?? (await handleRecords(c, parseBookingText as any));
}
