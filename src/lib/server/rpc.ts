import { HttpError } from "./http";
import { parseEngineError, friendlyEngineMessage } from "@/lib/booking/engine";

/** Turn a database function error ("CODE: message") into a clean HTTP error. */
export function throwRpc(error: { message: string }): never {
  const { code, detail } = parseEngineError(error.message);
  const status = code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "PATIENT_NOT_FOUND" || code === "TEMPLATE_NOT_FOUND" ? 404
    : code === "ERROR" ? 500
    : ["SLOT_UNAVAILABLE", "ORDER", "NOT_ALLOWED", "TENANT_MISMATCH", "ALREADY", "OVERLAP", "BALANCE"].includes(code) ? 409 : 400;
  let msg = code === "SLOT_UNAVAILABLE" && /\s/.test(detail) ? detail : friendlyEngineMessage(code, detail);
  if (code === "ERROR") {
    // an unexpected database error: say what it was, so a missing update or a bad column is found at once instead of a vague message
    const raw = String(error.message || "").slice(0, 220);
    msg = /could not find the function|schema cache|does not exist/i.test(raw)
      ? `The database is missing an update (${raw}). Run the latest migration file in Supabase, then try again.`
      : `Something went wrong while saving. Details: ${raw}`;
  }
  throw new HttpError(status, msg, { code });
}
