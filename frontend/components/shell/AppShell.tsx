"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SideRail } from "./SideRail";
import { TabBar } from "./TabBar";

export interface AppShellProps {
  children: ReactNode;
}

// 별자리 캔버스처럼 그래프 자체가 배경이 되어야 하는 "몰입형" 화면들. 이
// 경로에서는 레일이 폭을 차지하는 flex 컬럼이 아니라 캔버스 위에 뜨는
// 오버레이가 된다 - 그래프가 화면 전체(레일 뒤쪽까지)를 채우고, 레일/탭바는
// 반투명 판으로 그 위에 얹힌다. SideRail·TabBar는 AppShell만 렌더링하므로
// (페이지가 직접 그리지 않음, 그래서 이중 렌더 버그가 재발하지 않음) 이
// 오버레이 전환은 여기서만 할 수 있다 - 페이지 쪽 오버라이드로는 불가능해서
// 부득이 셸을 건드렸다. 다른 라우트(/schedule, /profile, 인증 페이지 등)는
// 이 분기를 타지 않으므로 동작이 전혀 바뀌지 않는다.
const IMMERSIVE_PREFIXES = ["/constellation"];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isImmersive = IMMERSIVE_PREFIXES.some((p) => pathname?.startsWith(p));

  if (isImmersive) {
    return (
      <div className="relative h-dvh overflow-hidden bg-ink-900">
        {/* 캔버스가 배경 전체(레일 뒤쪽 포함)를 채우도록 main을 뷰포트에
            그대로 꽉 채운다 - padding/max-width 없음, 카드 아님. */}
        <main className="absolute inset-0">{children}</main>
        {/* 레일은 더 이상 flex 폭을 차지하지 않고 캔버스 위에 뜬다. */}
        <div className="pointer-events-none fixed inset-y-0 left-0 z-30 hidden md:block">
          <div className="pointer-events-auto h-full">
            <SideRail />
          </div>
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh bg-ink-900">
      <SideRail />
      <main
        className={
          "mx-auto min-w-0 w-full max-w-5xl flex-1 px-4 pt-6 md:px-8 md:pt-10 " +
          // Keep content clear of the mobile tab bar.
          "pb-[calc(var(--tabbar-h)+var(--safe-bottom)+16px)] md:pb-10"
        }
      >
        {children}
      </main>
      {/* 레일과 같은 폭의 균형추. 없으면 본문이 "레일을 뺀 나머지" 기준으로
          중앙 정렬돼 화면 기준으로는 레일 절반만큼 오른쪽으로 치우친다.
          1440px부터 켜는 이유: 그 아래에서는 균형추가 본문 폭(max-w-5xl)을
          갉아먹는다 (196*2 + 1024 = 1416). */}
      <div aria-hidden className="hidden w-rail shrink-0 min-[1440px]:block" />
      <TabBar />
    </div>
  );
}
