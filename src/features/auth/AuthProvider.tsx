import { createContext, useContext, useMemo } from "react";

import { authClient } from "@/lib/auth-client";

import type { AuthState } from "./types";

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data, isPending } = authClient.useSession();

  const value = useMemo<AuthState>(
    () => ({ user: data?.user ?? null, isPending }),
    [data?.user, isPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
