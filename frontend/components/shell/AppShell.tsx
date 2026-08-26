"use client";

import type { ReactNode } from "react";
import { SideRail } from "./SideRail";
import { TabBar } from "./TabBar";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
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
