import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const REFRESH_MARGIN_SECONDS = 60; // 快到期前60秒刷新

function ensureSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase env");
  }
}

function createSupabaseServerClient() {
  ensureSupabaseEnv();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function refreshSupabaseSession(refreshToken) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    throw error || new Error("Failed to refresh Supabase session");
  }
  return data.session;
}

let refreshPromise = null;
let refreshTokenInFlight = null;

async function getRefreshedSession(refreshToken) {
  if (refreshPromise && refreshTokenInFlight === refreshToken) {
    return refreshPromise;
  }
  refreshTokenInFlight = refreshToken;
  refreshPromise = refreshSupabaseSession(refreshToken)
    .then((session) => {
      refreshPromise = null;
      refreshTokenInFlight = null;
      return session;
    })
    .catch((err) => {
      refreshPromise = null;
      refreshTokenInFlight = null;
      throw err;
    });
  return refreshPromise;
}

function resolveExpiresAt(session) {
  if (!session) return null;
  if (typeof session.expires_at === "number") return session.expires_at;
  if (typeof session.expires_in === "number") {
    return Math.floor(Date.now() / 1000) + session.expires_in;
  }
  return null;
}

export const authOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        ensureSupabaseEnv();
        const supabase = createSupabaseServerClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });
        if (error || !data?.user || !data?.session) {
          return null;
        }
        const user = data.user;
        const session = data.session;
        const supabaseExpiresAt = resolveExpiresAt(session);
        return {
          id: user.id,
          email: user.email,
          supabaseAccessToken: session.access_token,
          supabaseRefreshToken: session.refresh_token,
          supabaseExpiresAt,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.email = user.email;
        token.supabaseAccessToken = user.supabaseAccessToken;
        token.supabaseRefreshToken = user.supabaseRefreshToken;
        token.supabaseExpiresAt = user.supabaseExpiresAt;
        delete token.error;
      }

      const expiresAt = token.supabaseExpiresAt ? token.supabaseExpiresAt * 1000 : null;
      const shouldRefresh =
        typeof expiresAt === "number" &&
        Date.now() >= expiresAt - REFRESH_MARGIN_SECONDS * 1000;

      if (!shouldRefresh) {
        return token;
      }

      if (!token.supabaseRefreshToken) {
        token.supabaseAccessToken = null;
        token.supabaseExpiresAt = null;
        token.error = "MissingSupabaseRefreshToken";
        return token;
      }

      try {
        const session = await getRefreshedSession(token.supabaseRefreshToken);
        token.supabaseAccessToken = session.access_token;
        token.supabaseRefreshToken = session.refresh_token;
        token.supabaseExpiresAt = resolveExpiresAt(session);
        delete token.error;
      } catch (err) {
        console.error("Failed to refresh Supabase session", err);
        token.supabaseAccessToken = null;
        token.supabaseRefreshToken = null;
        token.supabaseExpiresAt = null;
        token.error = "SupabaseRefreshFailed";
      }
      return token;
    },
    async session({ session, token }) {
      session.user = session.user || {};
      session.user.id = token.uid;
      session.user.email = token.email;
      session.supabaseAccessToken = token.supabaseAccessToken;
      session.supabaseRefreshToken = token.supabaseRefreshToken;
      session.supabaseExpiresAt = token.supabaseExpiresAt;
      if (token.error) {
        session.error = token.error;
      } else {
        delete session.error;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
