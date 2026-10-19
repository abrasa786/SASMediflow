import { HttpError } from "./http";
import { parseEngineError, friendlyEngineMessage } from "@/lib/booking/engine";

/** Turn a database function error ("CODE: message") into a clean HTTP error. */
export function throwRpc(error: { message: string }): never {
  const { code, detail } = parseEngineError(error.message);
  const status = code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "PATIENT_NOT_FOUND" || code === "TEMPLATE_NOT_FOUND" ? 404
    : code === "ERROR" ? 500
    : ["SLOT_UNAVAILABLE", "ORDER", "NOT_ALLOWED", "TENANT_MISMATCH", "ALREADY", "OVERLAP", "BALANCE"].includes(code) ? 409 : 400;
  const msg = code === "SLOT_UNAVAILABLE" && /\s/.test(detail) ? detail : friendlyEngineMessage(code, detail);
  throw new HttpError(status, msg, { code });
}
