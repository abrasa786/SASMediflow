import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Client-side Supabase client (browser components) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase = createBrowserClient(url, anonKey) as any;

/** Server-side admin client — use ONLY in API routes, never in browser */
export function createAdminClient() {
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}
