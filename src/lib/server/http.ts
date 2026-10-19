import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export async function handle(fn: () => Promise<any>) {
  try { return NextResponse.json(await fn()); }
  catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("api error:", e);
    return NextResponse.json({ error: e?.message ?? "Unexpected error", ...(e instanceof HttpError ? e.extra : {}) }, { status });
  }
}
