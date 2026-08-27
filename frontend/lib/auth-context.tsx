"use client";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { postAuthSync } from "./api";
import { getFirebaseAuth } from "./firebase";
import type { AuthUser } from "./types";

/**
 * Firebase 유저 객체만으로 최소한의 AuthUser를 만든다.
 * 서버(/api/auth/sync) 호출이 실패했을 때(백엔드 다운 등) UI가 완전히 죽지 않도록
 * uid/email/emailVerified는 Firebase에서, 나머지는 안전한 기본값으로 채운다.
 */
function fallbackAuthUser(fbUser: FirebaseUser): AuthUser {
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    emailVerified: fbUser.emailVerified,
    yonseiVerified: false,
    displayName: fbUser.displayName,
    avatarEmoji: null,
  };
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** 인증 상태가 바뀐 뒤 서버와 다시 동기화해 최신 AuthUser를 읽는다. */
  refresh: () => Promise<AuthUser | null>;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    avatarEmoji: string,
    consent: boolean
  ) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const synced = await postAuthSync();
        setUser(synced);
      } catch {
        // 백엔드가 죽어 있어도 화면 자체는 최소 정보로 굴러가야 한다.
        setUser(fallbackAuthUser(fbUser));
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const refresh = useCallback(async (): Promise<AuthUser | null> => {
    const fbUser = getFirebaseAuth().currentUser;
    if (!fbUser) {
      setUser(null);
      return null;
    }
    try {
      const synced = await postAuthSync();
      setUser(synced);
      return synced;
    } catch {
      const fallback = fallbackAuthUser(fbUser);
      setUser(fallback);
      return fallback;
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
    // 라우팅은 반드시 이 반환값의 yonseiVerified로 해야 한다 — 방금 발급된 토큰엔
    // 커스텀 클레임이 아직 반영돼 있지 않을 수 있다.
    const synced = await postAuthSync();
    setUser(synced);
    return synced;
  }, []);

  const signup = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      avatarEmoji: string,
      consent: boolean
    ): Promise<AuthUser> => {
      const credential = await createUserWithEmailAndPassword(
        getFirebaseAuth(),
        email,
        password
      );
      await updateProfile(credential.user, { displayName });
      await sendEmailVerification(credential.user);
      const synced = await postAuthSync({ displayName, avatarEmoji, consent });
      setUser(synced);
      return synced;
    },
    []
  );

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth());
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
