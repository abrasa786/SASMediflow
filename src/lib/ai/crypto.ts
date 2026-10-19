import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Application-level encryption for stored AI questions and answers (AES-256-GCM).
 * Even someone with a database export sees only ciphertext. The key (AI_DATA_KEY) lives in the
 * hosting environment, never in the database. If the key is lost the history cannot be read.
 */
const key = () => (process.env.AI_DATA_KEY ? createHash("sha256").update(process.env.AI_DATA_KEY).digest() : null);

export const encryptionEnabled = () => !!key();

export function encrypt(plain: string): { value: string; encrypted: boolean } {
  const k = key();
  if (!k) return { value: plain, encrypted: false };
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { value: "v1:" + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64"), encrypted: true };
}

export function decrypt(value: string | null, encrypted: boolean): string {
  if (value == null) return "";
  if (!encrypted) return value;
  const k = key();
  if (!k || !value.startsWith("v1:")) return "[encrypted: key not available]";
  try {
    const raw = Buffer.from(value.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch { return "[encrypted: could not be read]"; }
}
