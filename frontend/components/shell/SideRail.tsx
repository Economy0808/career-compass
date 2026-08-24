"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { KeyIcon } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, navTarget, isNavActive } from "./nav-items";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-body-sm font-semibold transition-colors";

export function SideRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <nav className="sticky top-0 hidden h-dvh w-rail shrink-0 flex-col gap-1 border-r border-line bg-surface-overlay p-4 backdrop-blur-md md:flex">
      <div className="mb-4 px-1">
        <div className="font-serif text-heading font-bold text-content-primary">OurCompass</div>
        <div className="mt-0.5 text-micro tracking-[.08em] text-content-muted">콩나무 로드맵</div>
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => router.push(navTarget(item, me))}
          className={cn(
            ITEM,
            isNavActive(item, pathname, me) ? "bg-goal/18 text-goal-bright" : "text-content-secondary hover:bg-goal/10"
          )}
        >
          <item.Icon />
          {item.label}
        </button>
      ))}

      <div className="mt-3 border-t border-line pt-3">
        {loading ? (
          <div className="h-9 w-full animate-pulse rounded-sm bg-white/5" />
        ) : me ? (
          <div className="flex flex-col gap-1">
            <Link
              href={me.yonsei_verified ? `/profile/${me.id}` : "/verify"}
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm font-semibold !text-content-secondary no-underline transition-colors hover:bg-goal/10"
            >
              <span className="text-body">{me.avatar_emoji}</span>
              <span className="truncate">{me.display_name}</span>
              {!me.yonsei_verified && (
                <span className="ml-auto shrink-0 rounded-full bg-wither/18 px-1.5 py-0.5 text-micro font-semibold text-wither">
                  인증 전
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm px-3 py-1.5 text-left text-caption text-content-muted transition-colors hover:bg-goal/10 hover:text-content-secondary"
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
              pathname === "/login" || pathname === "/signup"
                ? "bg-goal/18 text-goal-bright"
                : "text-content-secondary hover:bg-goal/10"
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
