"use client";

import { useState } from "react";
import { useUser } from "@/lib/user-context";

export function UserSwitcher() {
  const { users, currentUser, setCurrentUserId, loading } = useUser();
  const [open, setOpen] = useState(false);

  if (loading) {
    return <div className="h-9 w-full animate-pulse rounded-[10px] bg-[rgba(143,220,138,.08)]" />;
  }

  if (!currentUser) {
    return <span className="px-2 text-xs text-moss-700">유저 없음</span>;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-[10px] px-[11px] py-2 text-left text-[12.5px] font-semibold text-moss-400 transition-colors hover:bg-[rgba(143,220,138,.16)]"
      >
        <span className="text-[15px]">{currentUser.avatar_emoji}</span>
        {currentUser.display_name}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-[rgba(143,220,138,.18)] bg-[rgba(6,18,10,.96)] shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur-[10px]">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setCurrentUserId(u.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-moss-400 hover:bg-[rgba(143,220,138,.13)] ${
                  u.id === currentUser.id ? "bg-[rgba(143,220,138,.13)] text-moss-300" : ""
                }`}
              >
                <span className="text-[15px]">{u.avatar_emoji}</span>
                {u.display_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
