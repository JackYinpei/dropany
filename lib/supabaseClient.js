import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createBrowserSupabase(accessTokenOrResolver) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  const resolveAccessToken = async () => {
    if (typeof accessTokenOrResolver === "function") {
      const value = await accessTokenOrResolver();
      return value ?? null;
    }
    return accessTokenOrResolver ?? null;
  };

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    accessToken: resolveAccessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
}
