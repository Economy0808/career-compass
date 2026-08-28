"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { DrawerIcon, KeyIcon } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, navTarget, isNavActive } from "./nav-items";

// 몰입형 캔버스(별자리 화면) 전용 네비게이션 - SideRail처럼 화면 폭을 차지하는
// 풀높이 판 대신, 좌하단 서랍 버튼을 누르면 그 자리에서 섬이 확장되는
// 팝오버다. 로직(항목 목록/활성 판정/로그인·로그아웃)은 SideRail과 동일해
// nav-items.ts를 그대로 재사용한다 - 화면마다 다른 진실을 두지 않기 위해서.
const ITEM =
  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-body-sm font-semibold transition-colors";
// 섬의 기조가 bg-paper-soft라(SideRail의 bg-paper보다 한 단계 어둡다), 눌린
// 상태와 호버는 그보다 밝은 bg-paper로 떠 보이게 한다 - SideRail의
// hover:bg-paper-soft를 그대로 가져오면 기조와 구분이 안 된다.
const ITEM_ACTIVE = "bg-paper-ink text-paper";
const ITEM_INACTIVE = "text-paper-lo hover:bg-paper";

export function NavIsland() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭/ESC로 닫힘. open일 때만 리스너를 붙여 유휴 비용이 없게 한다.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function go(target: string) {
    setOpen(false);
    router.push(target);
  }

  async function handleLogout() {
    setOpen(false);
    await logout();
    router.push("/");
  }

  return (
    // <md에서는 숨긴다 - TabBar가 같은 항목을 이미 하단에 노출하므로
    // (nav-items.ts 공유) 서랍 버튼은 모바일 TabBar 아래 깔려 안 보이던
    // 죽은 UI였다. 별개의 진입점을 또 두는 대신 md 이상(TabBar가 없는
    // 화면)에서만 서랍으로 남긴다.
    <div ref={containerRef} className="pointer-events-auto fixed bottom-3 left-3 z-30 hidden md:block">
      {open && (
        <div
          role="menu"
          aria-label="탐색"
          className={cn(
            "paper-surface absolute bottom-[calc(100%+8px)] left-0 flex w-56 origin-bottom-left flex-col gap-1 rounded-xl border border-paper-line bg-paper-soft/95 p-3 shadow-panel backdrop-blur-md",
            "animate-[islandExpand_220ms_cubic-bezier(.22,1,.36,1)]"
          )}
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => go(navTarget(item, user))}
              className={cn(ITEM, isNavActive(item, pathname, user) ? ITEM_ACTIVE : ITEM_INACTIVE)}
            >
              <item.Icon />
              {item.label}
            </button>
          ))}

          <div className="mt-2 border-t border-paper-line pt-2">
            {loading ? (
              <div className="h-9 w-full animate-pulse rounded-sm bg-paper" />
            ) : user ? (
              <div className="flex flex-col gap-1">
                <Link
                  href={user.yonseiVerified ? `/profile/${user.uid}` : "/verify"}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm font-semibold !text-paper-lo no-underline transition-colors hover:bg-paper"
                >
                  <span className="text-body">{user.avatarEmoji ?? "🙂"}</span>
                  <span className="truncate">{user.displayName ?? "사용자"}</span>
                  {!user.yonseiVerified && (
                    // SideRail의 bg-spec-m/18 + text-spec-m 배지는 어두운
                    // 표면 기준(spec-m 자체가 밝은 코랄이라 종이 위 텍스트로
                    // 쓰면 대비가 ~2.4:1로 미달) - 이 섬은 paper 표면이라
                    // 텍스트만 paper-ink로 바꾼다(틴트는 그대로 spec-m 유지 -
                    // 색으로는 여전히 "주의" 신호를 준다, 새 hex는 안 씀).
                    <span className="ml-auto shrink-0 rounded-full bg-spec-m/18 px-1.5 py-0.5 text-micro font-semibold text-paper-ink">
                      인증 전
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-sm px-3 py-1.5 text-left text-caption text-paper-lo transition-colors hover:bg-paper hover:text-paper-ink"
                >
                  로그아웃
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => go("/login")}
                className={cn(
                  ITEM,
                  pathname === "/login" || pathname === "/signup" ? ITEM_ACTIVE : ITEM_INACTIVE
                )}
              >
                <KeyIcon />
                로그인
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "탐색 메뉴 닫기" : "탐색 메뉴 열기"}
        onClick={() => setOpen((o) => !o)}
        className="paper-surface flex h-11 w-11 items-center justify-center rounded-full border border-paper-line bg-paper-soft/95 text-paper-ink shadow-panel backdrop-blur-md transition-colors hover:bg-paper"
      >
        <DrawerIcon size={20} />
      </button>
    </div>
  );
}
