"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, TAB_ORDER, navTarget, isNavActive, type NavItem } from "./nav-items";

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const ordered = TAB_ORDER.map((k) => NAV_ITEMS.find((i) => i.key === k)).filter(
    (i): i is NavItem => Boolean(i)
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-rule bg-ink-800/90 px-1 backdrop-blur-lg md:hidden"
      style={{
        height: "calc(var(--tabbar-h) + var(--safe-bottom))",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      {ordered.map((item) => {
        const target = navTarget(item, user);

        if (item.primary) {
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.shortLabel}
              onClick={() => router.push(target)}
              className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(160deg,#9DB4FF,#FFF3C4)] text-ink-900 shadow-fab"
            >
              <item.Icon size={22} />
            </button>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            onClick={() => router.push(target)}
            className={cn(
              "flex min-w-[56px] flex-col items-center gap-1 py-1.5 text-micro font-semibold transition-colors",
              isNavActive(item, pathname, user) ? "text-spec-b" : "text-text-lo"
            )}
          >
            <item.Icon size={20} />
            {item.shortLabel}
          </button>
        );
      })}
    </nav>
  );
}
