"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import { UserSwitcher } from "./UserSwitcher";
import { getFeed } from "@/lib/api";
import { useUser } from "@/lib/user-context";

function SproutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 22V10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12.5C12 9 9 7 5 7C5 10.5 8 12.5 12 12.5Z" fill="currentColor" />
      <path d="M12 10C12 7 14.5 5 18 5C18 8.5 15.5 10 12 10Z" fill="currentColor" />
    </svg>
  );
}

function ForestIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 21v-7M12 21V8M18 21v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function SeedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const ITEM_BASE =
  "flex w-full items-center gap-[9px] rounded-[10px] px-[11px] py-[9px] text-left text-[13px] font-semibold transition-colors hover:bg-[rgba(143,220,138,.16)]";
const ITEM_ON = "bg-[rgba(143,220,138,.16)] text-moss-300";
const ITEM_OFF = "text-moss-500";

export function SideNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser } = useUser();
  // Cache of "my latest roadmap id" per user, valid for this session only.
  const myRoadmapCache = useRef<Map<number, number | null>>(new Map());

  async function goMyBeanstalk() {
    if (!currentUser) return;
    let roadmapId = myRoadmapCache.current.get(currentUser.id);
    if (roadmapId === undefined) {
      try {
        const cards = await getFeed({ limit: 100 });
        roadmapId = cards.find((c) => c.user.id === currentUser.id)?.id ?? null;
        myRoadmapCache.current.set(currentUser.id, roadmapId);
      } catch {
        roadmapId = null;
      }
    }
    router.push(roadmapId !== null ? `/roadmap/${roadmapId}` : "/new");
  }

  return (
    <nav className="fixed left-[22px] top-[22px] z-[60] flex w-[168px] flex-col gap-[5px] rounded-2xl border border-[rgba(143,220,138,.15)] bg-[rgba(6,18,10,.74)] p-3.5 shadow-[0_10px_30px_rgba(0,0,0,.4)] backdrop-blur-[10px]">
      <div className="mx-0.5 mb-2.5 mt-0.5">
        <div className="font-serif text-[15px] font-bold text-moss-100">Career Compass</div>
        <div className="mt-0.5 text-[10.5px] tracking-[.08em] text-moss-600">콩나무 로드맵</div>
      </div>
      <button
        type="button"
        onClick={goMyBeanstalk}
        className={`${ITEM_BASE} ${pathname.startsWith("/roadmap") ? ITEM_ON : ITEM_OFF}`}
      >
        <SproutIcon />내 콩나무
      </button>
      <button
        type="button"
        onClick={() => router.push("/")}
        className={`${ITEM_BASE} ${pathname === "/" ? ITEM_ON : ITEM_OFF}`}
      >
        <ForestIcon />로드맵 숲
      </button>
      <button
        type="button"
        onClick={() => router.push("/new")}
        className={`${ITEM_BASE} ${pathname === "/new" ? ITEM_ON : ITEM_OFF}`}
      >
        <SeedIcon />새 씨앗 심기
      </button>
      <div className="mt-2 border-t border-[rgba(143,220,138,.12)] pt-2.5">
        <UserSwitcher />
      </div>
    </nav>
  );
}
