"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, navTarget, isNavActive } from "./nav-items";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-body-sm font-semibold transition-colors";

export function SideRail() {
  const pathname = usePathname();
  const router = useRouter();
  const me = null;

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
        <p className="px-3 py-2 text-caption text-content-muted">
          🌱 포트폴리오 데모 — 게스트로 둘러보는 중
        </p>
      </div>
    </nav>
  );
}
