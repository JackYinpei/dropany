"use client";
import { SessionProvider } from "next-auth/react";

export default function AuthProvider({ children }) {
  return (
    <SessionProvider refetchInterval={300} refetchOnWindowFocus>
      {children}
    </SessionProvider>
  );
}
