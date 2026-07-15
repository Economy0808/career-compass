"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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

function BeanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 4C4 6 3.5 10.5 6 14c2.6 3.6 7.4 5.4 10.9 4C20 16.8 21 12.5 18.5 9 15.9 5.4 10 2 7 4Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M9 8c1.5 1 4.5 3.5 5.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
  const { me, loading, logout } = useAuth();

  function goMyBeanstalk() {
    // 유저는 콩나무를 여러 개 키우므로 내 프로필(콩나무 목록)로 간다.
    router.push(me ? `/profile/${me.id}` : "/login");
  }

  async function handleLogout() {
    await logout();
    router.push("/");
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
        className={`${ITEM_BASE} ${
          pathname.startsWith("/roadmap") || (me !== null && pathname === `/profile/${me.id}`)
            ? ITEM_ON
            : ITEM_OFF
        }`}
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
      <button
        type="button"
        onClick={() => router.push("/ranking")}
        className={`${ITEM_BASE} ${pathname === "/ranking" ? ITEM_ON : ITEM_OFF}`}
      >
        <BeanIcon />콩 랭킹
      </button>

      <div className="mt-2 border-t border-[rgba(143,220,138,.12)] pt-2.5">
        {loading ? (
          <div className="h-9 w-full animate-pulse rounded-[10px] bg-[rgba(143,220,138,.08)]" />
        ) : me ? (
          <div className="flex flex-col gap-1">
            <Link
              href={me.yonsei_verified ? `/profile/${me.id}` : "/verify"}
              className="flex items-center gap-2 rounded-[10px] px-[11px] py-2 text-[12.5px] font-semibold !text-moss-400 no-underline transition-colors hover:bg-[rgba(143,220,138,.16)]"
            >
              <span className="text-[15px]">{me.avatar_emoji}</span>
              <span className="truncate">{me.display_name}</span>
              {!me.yonsei_verified && (
                <span className="ml-auto shrink-0 rounded-full bg-[rgba(196,154,90,.18)] px-1.5 py-0.5 text-[9.5px] font-semibold text-wither-300">
                  인증 전
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-[10px] px-[11px] py-1.5 text-left text-[11.5px] text-moss-700 transition-colors hover:bg-[rgba(143,220,138,.1)] hover:text-moss-400"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
            className={`${ITEM_BASE} ${pathname === "/login" || pathname === "/signup" ? ITEM_ON : ITEM_OFF}`}
          >
            <span className="text-[15px]">🔑</span>로그인
          </button>
        )}
      </div>
    </nav>
  );
}
