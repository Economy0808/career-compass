"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useUser } from "@/lib/user-context";
import { Avatar } from "./Avatar";

export function UserSwitcher() {
  const { users, currentUser, setCurrentUserId, loading } = useUser();
  const [open, setOpen] = useState(false);

  if (loading) {
    return <div className="h-10 w-32 animate-pulse rounded-2xl bg-ink-100 dark:bg-ink-800" />;
  }

  if (!currentUser) {
    return <span className="text-sm text-muted">유저 없음</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-1.5 text-sm font-medium shadow-soft"
      >
        <Avatar emoji={currentUser.avatar_emoji} size="sm" />
        {currentUser.display_name}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
            >
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setCurrentUserId(u.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800 ${
                    u.id === currentUser.id ? "bg-ink-50 dark:bg-ink-800" : ""
                  }`}
                >
                  <Avatar emoji={u.avatar_emoji} size="sm" />
                  {u.display_name}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
