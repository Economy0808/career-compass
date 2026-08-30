"use client";

/*
 * 둘러보기(데모) 전용 셸 - 로그인 없이 누구나 별자리 잇기/탐색/소셜을
 * 실제와 같은 퀄리티로 체험해 볼 수 있는 3탭 레이아웃(사용자 지시).
 *
 * AppShell(components/shell/AppShell.tsx)은 "/demo"가 IMMERSIVE_PREFIXES·
 * ISLAND_CHROME_ROUTES 어디에도 없어 기본 분기(SideRail + 스크롤 main +
 * 모바일 TabBar)를 그대로 태운다 - 이 레이아웃은 그 main 안의 일반 문서
 * 흐름에 얹히므로 fixed를 쓰지 않는다(sticky만): SideRail은 flex 형제
 * 컬럼이라 겹칠 수 없고, TabBar는 main에 이미 예약된 하단 여백
 * (pb-[tabbar-h+safe-bottom]) 안에 있어 겹치지 않는다 - 브라우저로 실측
 * 확인 완료(1440x900 · 375x812 둘 다 겹침 없음).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs } from "@/components/ui";

const DEMO_TABS = [
  { value: "constellation", label: "별자리 잇기" },
  { value: "explore", label: "탐색" },
  { value: "social", label: "소셜" },
] as const;

type DemoTab = (typeof DEMO_TABS)[number]["value"];

function tabFromPathname(pathname: string | null): DemoTab {
  if (pathname?.startsWith("/demo/explore")) return "explore";
  if (pathname?.startsWith("/demo/social")) return "social";
  return "constellation";
}

export default function DemoLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = tabFromPathname(pathname);

  return (
    <div className="flex flex-col gap-4 pb-10">
      {/* 상단 고정 안내 배너 - main 문서 흐름 안에서 sticky(뷰포트 fixed 아님,
          위 주석 참고). */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-rule bg-ink-800/95 px-4 py-2.5 backdrop-blur-md">
        <p className="text-caption text-text-lo">
          <span className="font-semibold text-text-hi">둘러보기 모드</span>예요 — 저장되지 않아요
        </p>
        <Link
          href="/signup"
          className="ml-auto min-h-11 shrink-0 rounded-md border border-transparent bg-spec-b px-3.5 py-1.5 text-caption font-bold leading-[2.2] text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
        >
          가입하고 시작하기
        </Link>
      </div>

      <Tabs items={DEMO_TABS} value={active} onChange={(v) => router.push(`/demo/${v}`)} />

      {children}
    </div>
  );
}
