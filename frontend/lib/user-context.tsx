"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getUsers } from "./api";
import type { UserOut } from "./types";

const STORAGE_KEY = "career-compass:current-user-id";

interface UserContextValue {
  users: UserOut[];
  currentUser: UserOut | null;
  setCurrentUserId: (id: number) => void;
  loading: boolean;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [currentUserId, setCurrentUserIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUsers()
      .then((fetched) => {
        setUsers(fetched);
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const storedId = stored ? Number(stored) : null;
        if (storedId !== null && fetched.some((u) => u.id === storedId)) {
          setCurrentUserIdState(storedId);
        } else if (fetched.length > 0) {
          setCurrentUserIdState(fetched[0].id);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const setCurrentUserId = useCallback((id: number) => {
    setCurrentUserIdState(id);
    window.localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const currentUser = users.find((u) => u.id === currentUserId) ?? null;

  return (
    <UserContext.Provider value={{ users, currentUser, setCurrentUserId, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
