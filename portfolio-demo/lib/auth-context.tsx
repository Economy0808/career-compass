"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getMe, postLogout } from "./api";
import type { MeOut } from "./types";

interface AuthContextValue {
  me: MeOut | null;
  loading: boolean;
  /** 로그인/인증 상태가 바뀐 뒤 서버에서 me를 다시 읽는다. */
  refresh: () => Promise<MeOut | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeOut | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<MeOut | null> => {
    try {
      const fetched = await getMe();
      setMe(fetched);
      return fetched;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await postLogout();
    } finally {
      setMe(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
