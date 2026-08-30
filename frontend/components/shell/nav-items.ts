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
  // 비로그인 = 실제 서비스 화면 접근 불가(사용자 지시) - 둘러보기는 /demo가 전담한다.
  { key: "explore", label: "탐색", shortLabel: "탐색", Icon: SearchIcon, href: "/explore", requiresAuth: true },
  { key: "feed", label: "소셜", shortLabel: "소셜", Icon: EagleIcon, href: "/feed", requiresAuth: true },
  { key: "community", label: "커뮤니티", shortLabel: "커뮤니티", Icon: BoardIcon, href: "/community", requiresAuth: true },
  { key: "schedule", label: "일정", shortLabel: "일정", Icon: CalendarIcon, href: "/schedule", requiresAuth: true },
  {
    key: "new",
    label: "별자리 생성하기",
    shortLabel: "생성",
    Icon: SeedIcon,
    href: "/constellation/new",
    // 예전엔 비로그인 데모 진입점이었지만, 둘러보기는 /demo가 전담하고 인테이크
    // API도 익명 401이 됐다 - 비로그인이 들어오면 대화가 뜬 채로 실패한다.
    requiresAuth: true,
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
  // "로그인" 여부만 본다(user 존재) - "인증(yonseiVerified)" 여부는 각 화면이 담당한다.
  // 로그인만 되어 있으면 미인증 상태라도 여기는 통과시켜야 한다(사용자 지시).
  if (item.requiresAuth && !user) {
    return item.href ? `/login?next=${encodeURIComponent(item.href)}` : "/login";
  }
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
