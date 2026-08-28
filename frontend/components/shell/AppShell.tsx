"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SideRail } from "./SideRail";
import { TabBar } from "./TabBar";
import { NavIsland } from "./NavIsland";

export interface AppShellProps {
  children: ReactNode;
}

// 별자리 캔버스처럼 그래프 자체가 배경이 되어야 하는 "몰입형" 화면들. 이
// 경로에서는 풀높이 레일이 폭을 차지하는 flex 컬럼으로 뜨지 않는다 - 그래프가
// 화면 전체를 채우고, 크롬은 로고(좌상단, 카드 없음) + NavIsland(좌하단 서랍
// 팝오버) + TabBar(모바일 하단)로만 그 위에 뜬다(섬 구조, F2). SideRail·
// TabBar는 AppShell만 렌더링하므로(페이지가 직접 그리지 않음, 그래서 이중
// 렌더 버그가 재발하지 않음) 이 분기 전환은 여기서만 할 수 있다 - 페이지 쪽
// 오버라이드로는 불가능해서 부득이 셸을 건드렸다. 다른 라우트(/schedule,
// /profile, 인증 페이지 등)는 이 분기를 타지 않으므로 동작이 전혀 바뀌지 않는다.
const IMMERSIVE_PREFIXES = ["/constellation"];

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isImmersive = IMMERSIVE_PREFIXES.some((p) => pathname?.startsWith(p));

  if (isImmersive) {
    // "섬(island)" 크롬: 풀높이 종이 레일 대신, 어두운 우주 위에 로고만 직접
    // 얹고(카드 없음) 네비게이션은 좌하단 서랍 버튼에서 확장되는 팝오버로
    // 옮겼다(NavIsland.tsx). SideRail은 더 이상 이 분기에서 쓰지 않는다 -
    // 비몰입 화면(피드/프로필 등)은 아래 return의 SideRail을 그대로 쓴다.
    return (
      <div className="relative h-dvh overflow-hidden bg-ink-900">
        {/* 캔버스가 배경 전체(레일 뒤쪽 포함)를 채우도록 main을 뷰포트에
            그대로 꽉 채운다 - padding/max-width 없음, 카드 아님. */}
        <main className="absolute inset-0">{children}</main>

        {/* 좌상단 로고 - 종이 카드 없이 어두운 우주 위에 직접. 로고=홈 관례로
            "/"로 이동. OurLab 글자 아래 헤어라인을 밑줄처럼 두고 그 아래에
            작은 "Yonsei Community" 라벨(라틴 전용 font-mono, 한글 없음 -
            No-Korean-Mono Rule에 저촉되지 않는다). */}
        <Link
          href="/"
          className="fixed left-4 top-4 z-20 flex flex-col rounded-sm outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b"
        >
          <span className="font-serif text-title font-bold leading-tight text-text-hi">OurLab</span>
          <span className="mt-1 border-t border-rule pt-1 font-mono text-micro tracking-[0.14em] text-text-lo">
            Yonsei Community
          </span>
        </Link>

        {/* 네비 섬 - 좌하단 서랍 버튼(NavIsland 내부에서 자체적으로 open
            상태를 들고 있음, md 이하에서도 항상 노출 - 모바일은 TabBar와
            병행). */}
        <NavIsland />

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
