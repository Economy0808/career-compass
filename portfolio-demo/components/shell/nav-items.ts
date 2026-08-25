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

// 정적 데모는 로그인이 없어서 requiresAuth 항목("내 콩나무", "일정")은 뺐다 —
// 원본 앱과 화면 구조를 맞추기 위해 필드 자체는 남겨둔다.
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "forest", label: "로드맵 숲", shortLabel: "숲", Icon: ForestIcon, href: "/", requiresAuth: false },
  { key: "new", label: "새 씨앗 심기", shortLabel: "심기", Icon: SeedIcon, href: "/new", requiresAuth: false, primary: true },
  { key: "ranking", label: "콩 랭킹", shortLabel: "랭킹", Icon: BeanIcon, href: "/ranking", requiresAuth: false },
] as const;

/** Tab-bar order puts the primary action in the centre, within thumb reach. */
export const TAB_ORDER: readonly string[] = ["forest", "new", "ranking"];

/** Resolves where a nav item should navigate to. 정적 데모엔 인증 분기가 없다. */
export function navTarget(item: NavItem, _me: MeOut | null): string {
  return item.href ?? "/";
}

/** Whether a nav item should be highlighted as active for the current route. */
export function isNavActive(item: NavItem, pathname: string, _me: MeOut | null): boolean {
  return pathname === item.href;
}
