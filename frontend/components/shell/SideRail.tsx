"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { KeyIcon } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, navTarget, isNavActive } from "./nav-items";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-body-sm font-semibold transition-colors";

// 활성 항목 = "잉크가 눌린" 채움(paper-ink 배경 + paper 텍스트). 종이 위에서
// spec-b 틴트는 대비가 약해(~1.6:1) 랜딩의 .cta-ink 언어를 가져왔다.
const ITEM_ACTIVE = "bg-paper-ink text-paper";
const ITEM_INACTIVE = "text-paper-lo hover:bg-paper-soft";

export function SideRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <nav className="paper-surface sticky top-0 hidden h-dvh w-rail shrink-0 flex-col gap-1 border-r border-paper-line bg-paper/95 p-4 backdrop-blur-md md:flex">
      <div className="mb-4 px-1">
        <div className="font-serif text-heading font-bold text-paper-ink">OurLab</div>
        <div className="mt-0.5 text-micro tracking-[.08em] text-paper-lo">별자리 로드맵</div>
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => router.push(navTarget(item, user))}
          className={cn(ITEM, isNavActive(item, pathname, user) ? ITEM_ACTIVE : ITEM_INACTIVE)}
        >
          <item.Icon />
          {item.label}
        </button>
      ))}

      <div className="mt-3 border-t border-paper-line pt-3">
        {loading ? (
          <div className="h-9 w-full animate-pulse rounded-sm bg-paper-soft" />
        ) : user ? (
          <div className="flex flex-col gap-1">
            <Link
              href={user.yonseiVerified ? `/profile/${user.uid}` : "/verify"}
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm font-semibold !text-paper-lo no-underline transition-colors hover:bg-paper-soft"
            >
              <span className="text-body">{user.avatarEmoji ?? "🙂"}</span>
              <span className="truncate">{user.displayName ?? "사용자"}</span>
              {!user.yonseiVerified && (
                <span className="ml-auto shrink-0 rounded-full bg-spec-m/18 px-1.5 py-0.5 text-micro font-semibold text-spec-m">
                  인증 전
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm px-3 py-1.5 text-left text-caption text-paper-lo transition-colors hover:bg-paper-soft hover:text-paper-ink"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
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
    </nav>
  );
}
