import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** null when env vars are missing → app falls back to demo data. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { realtime: { params: { eventsPerSecond: 10 } } }) : null;

export const isDemo = supabase === null;
