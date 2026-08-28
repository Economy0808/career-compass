import type { ComponentType } from "react";
import { BoardIcon, CalendarIcon, EagleIcon, ProfileIcon, SearchIcon, SeedIcon } from "@/components/ui/icons";
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
  // 탐색: 관심사 기반 사람 찾기(사용자 지시 "돋보기 아이콘 + 탐색").
  { key: "explore", label: "탐색", shortLabel: "탐색", Icon: SearchIcon, href: "/explore", requiresAuth: false },
  { key: "feed", label: "소셜", shortLabel: "소셜", Icon: EagleIcon, href: "/feed", requiresAuth: false },
  { key: "community", label: "커뮤니티", shortLabel: "커뮤니티", Icon: BoardIcon, href: "/community", requiresAuth: false },
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

/** Tab-bar order puts the primary action in the centre, within thumb reach.
 * Five slots (IG-style bottom bar cap). Schedule is desktop-rail-only now -
 * explore took its mobile slot (user-approved trade-off). */
export const TAB_ORDER: readonly string[] = ["explore", "feed", "new", "community", "mine"];

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
  // 커뮤니티는 게시판/글 상세까지 하위 경로 전부를 "커뮤니티" 탭 활성으로 본다.
  if (item.key === "community") {
    return pathname.startsWith("/community");
  }
  return pathname === item.href;
}
