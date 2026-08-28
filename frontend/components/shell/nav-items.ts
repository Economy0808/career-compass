import type { ComponentType } from "react";
import { CalendarIcon, EagleIcon, ProfileIcon, SeedIcon } from "@/components/ui/icons";
import type { AuthUser } from "@/lib/types";

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
  { key: "feed", label: "소셜", shortLabel: "소셜", Icon: EagleIcon, href: "/feed", requiresAuth: false },
  { key: "schedule", label: "일정", shortLabel: "일정", Icon: CalendarIcon, href: "/schedule", requiresAuth: true },
  {
    key: "new",
    label: "별자리 생성하기",
    shortLabel: "생성",
    Icon: SeedIcon,
    href: "/constellation/new",
    requiresAuth: false,
    primary: true,
  },
  // Instagram convention: the last tab is the profile mark, not a feature name.
  { key: "mine", label: "프로필", shortLabel: "프로필", Icon: ProfileIcon, href: null, requiresAuth: true },
] as const;

/** Tab-bar order puts the primary action in the centre, within thumb reach. */
export const TAB_ORDER: readonly string[] = ["feed", "schedule", "new", "mine"];

/** Resolves where a nav item should navigate to for the current user. */
export function navTarget(item: NavItem, user: AuthUser | null): string {
  if (item.requiresAuth && !user) return "/login";
  if (item.href) return item.href;
  // "내 별자리": 개인 프로필로 이동.
  return user ? `/profile/${user.uid}` : "/login";
}

/** Whether a nav item should be highlighted as active for the current route. */
export function isNavActive(item: NavItem, pathname: string, user: AuthUser | null): boolean {
  if (item.key === "mine") {
    return user !== null && pathname === `/profile/${user.uid}`;
  }
  return pathname === item.href;
}
