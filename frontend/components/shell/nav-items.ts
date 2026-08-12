import type { ComponentType } from "react";
import { BeanIcon, CalendarIcon, ForestIcon, SeedIcon, SproutIcon } from "@/components/ui/icons";
import type { MeOut } from "@/lib/types";

export interface NavItem {
  key: string;
  label: string;
  shortLabel: string; // tab bar (tighter)
  Icon: ComponentType<{ size?: number; className?: string }>;
  /** null means "resolve at runtime from the signed-in user". */
  href: string | null;
  requiresAuth: boolean;
  /** Highlighted as the primary action in the mobile tab bar. */
  primary?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "mine", label: "내 콩나무", shortLabel: "내 콩나무", Icon: SproutIcon, href: null, requiresAuth: true },
  { key: "schedule", label: "일정", shortLabel: "일정", Icon: CalendarIcon, href: "/schedule", requiresAuth: true },
  { key: "forest", label: "로드맵 숲", shortLabel: "숲", Icon: ForestIcon, href: "/", requiresAuth: false },
  { key: "new", label: "새 씨앗 심기", shortLabel: "심기", Icon: SeedIcon, href: "/new", requiresAuth: false, primary: true },
  { key: "ranking", label: "콩 랭킹", shortLabel: "랭킹", Icon: BeanIcon, href: "/ranking", requiresAuth: false },
] as const;

/** Tab-bar order puts the primary action in the centre, within thumb reach. */
export const TAB_ORDER: readonly string[] = ["forest", "schedule", "new", "ranking", "mine"];

/** Resolves where a nav item should navigate to for the current user. */
export function navTarget(item: NavItem, me: MeOut | null): string {
  if (item.requiresAuth && !me) return "/login";
  if (item.href) return item.href;
  // "내 콩나무": the user grows several, so land on their profile.
  return me ? `/profile/${me.id}` : "/login";
}

/** Whether a nav item should be highlighted as active for the current route. */
export function isNavActive(item: NavItem, pathname: string, me: MeOut | null): boolean {
  if (item.key === "mine") {
    return pathname.startsWith("/roadmap") || (me !== null && pathname === `/profile/${me.id}`);
  }
  return pathname === item.href;
}
