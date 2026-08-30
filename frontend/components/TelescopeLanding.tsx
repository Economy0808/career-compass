"use client";

/*
 * impeccable direction contract — 망원경 랜딩 (승인 시안: 디자인 캔버스 아티팩트 88238bcc, 보드 1·2)
 * THESIS: 인쇄된 종이 성도(星圖) 위에서 진로를 "잇는 행위"로 초대한다 — 카드·지표 나열형 랜딩 거부.
 * OWN-WORLD: 청보라 잉크의 밝은(흰) 지면(--paper-*), 좌표 격자·계선·눈금, Gowun Batang 헤드라인,
 *   선화 SVG(점·선·점선 시야원)만 — 일러스트·마스코트·그라데이션 텍스트 없음.
 * STORY: 방문자는 "흩어진 점이 별자리가 된다"를 읽고, 망원경을 들여다보는 단 하나의 행동을 한다.
 * FIRST VIEWPORT: 좌측 헤드라인+단일 CTA, 우측(모바일은 상단 축소판) 미완성 별자리 도면.
 * FORM: 사용자 승인 시안으로 고정(pinned) — 주사위 없이 채택. 시그니처 인터랙션 = CTA 클릭 시
 *   접안렌즈 원이 화면을 덮는 명→암 전환(apertureOpen, 1회성).
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review,
 *   the verdict, DESIGN.md, and every shipping raster carrying its provenance.
 *
 * 색은 전부 globals.css의 --paper-* CSS 변수를 인라인으로 참조한다 - Tailwind
 * 신규 토큰은 dev 서버 재시작 전엔 컴파일되지 않아(실제 사고: 랜딩이 어둡게
 * 렌더됨) 이 파일만은 인라인 var()가 안전하다. --paper-faint는 장식 선 전용 -
 * 읽는 텍스트에 쓰면 대비 미달(리뷰 지적 1.9:1).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "@/lib/auth-context";
import { BgmToggle } from "@/components/BgmToggle";
import { BGM_TEMPO } from "@/lib/bgm-score";

/* BGM(47BPM)의 마디(4박)에 모션 주기를 맞춘다 - 음악과 화면이 같은 숨을 쉬게.
 * 사용자 지시: "요소들 약간 둥둥 + 타겟팅 원 천천히 회전(아이언맨 HUD)". */
const LANDING_BAR_S = (60 / BGM_TEMPO) * 4;

/** 미완성 별자리 선화 - 점선 시야원 + 이은 별 + 아직 못 이은 빈 별.
 * 상시 모션(금지 규칙의 명시적 예외, 사용자 지시): 점선 링은 12마디에 한 바퀴
 * 시계방향, 아크 세그먼트 링은 8마디 반시계(HUD 타겟팅), 이어진 별자리는
 * 통째로 2마디 주기 둥둥(선이 별을 따라가야 하므로 그룹 단위), 못 이은 빈 별
 * 셋은 각자 다른 위상으로 둥둥. reduced-motion이면 전역 킬 스위치가 끈다. */
function ReticleFigure({ width }: { width: number }) {
  // 한 방향에 한 마디(alternate라 왕복 2마디). 진폭이 3px일 땐 초당 0.6px라
  // 사실상 안 보였다(사용자 지적) - 7~11px로 키워 "둥둥"이 실제로 읽히게.
  const floatStyle = (amp: number, delayBars: number): CSSProperties => ({
    ["--float-amp" as string]: `${amp}px`,
    animation: `landingFloat ${LANDING_BAR_S}s ease-in-out ${-delayBars * LANDING_BAR_S}s infinite alternate`,
  });
  return (
    <svg
      width={width}
      height={Math.round((width * 560) / 520)}
      viewBox="0 0 520 560"
      fill="transparent"
      className="block"
      aria-hidden
    >
      <circle
        cx="270"
        cy="280"
        r="228"
        stroke="var(--paper-line)"
        strokeWidth="1"
        strokeDasharray="3 7"
        fill="transparent"
        style={{ transformOrigin: "270px 280px", animation: `landingSpin ${LANDING_BAR_S * 12}s linear infinite` }}
      />
      {/* 아크 세그먼트 링 - 점선 링과 반대로 도는 HUD 타겟팅 조각들
          (원둘레 2π×240≈1508을 대시 배열로 쪼개 아크 두 조각만 남긴다). */}
      <circle
        cx="270"
        cy="280"
        r="240"
        stroke="var(--paper-line)"
        strokeWidth="1.5"
        strokeDasharray="120 260 40 1088"
        fill="transparent"
        style={{ transformOrigin: "270px 280px", animation: `landingSpinCcw ${LANDING_BAR_S * 8}s linear infinite` }}
      />
      <circle cx="270" cy="280" r="252" stroke="var(--paper-soft)" strokeWidth="1" fill="transparent" />
      <g stroke="var(--paper-faint)" strokeWidth="1">
        <line x1="270" y1="24" x2="270" y2="36" />
        <line x1="270" y1="524" x2="270" y2="536" />
        <line x1="14" y1="280" x2="26" y2="280" />
        <line x1="514" y1="280" x2="526" y2="280" />
      </g>
      {/* 이어진 별자리(선+별)는 한 몸으로 둥둥 - 따로 띄우면 선이 끊긴다. */}
      <g style={floatStyle(7, 0)}>
        <g stroke="var(--rule)" strokeWidth="1.2" opacity="0.55">
          <line x1="150" y1="368" x2="238" y2="292" />
          <line x1="238" y1="292" x2="330" y2="330" />
          <line x1="238" y1="292" x2="282" y2="196" />
          <line x1="282" y1="196" x2="376" y2="164" />
          <line x1="330" y1="330" x2="398" y2="256" />
        </g>
        <g fill="var(--rule)">
          <circle cx="150" cy="368" r="5" />
          <circle cx="238" cy="292" r="6.5" />
          <circle cx="330" cy="330" r="5" />
          <circle cx="282" cy="196" r="5" />
          <circle cx="376" cy="164" r="6.5" />
          <circle cx="398" cy="256" r="4" />
        </g>
      </g>
      {/* 아직 못 이은 빈 별 - 선이 없으니 각자 자유 위상으로 둥둥. */}
      <g stroke="var(--rule)" fill="transparent" strokeWidth="1.2" opacity="0.6">
        <circle cx="192" cy="180" r="4.5" style={floatStyle(11, 0.35)} />
        <circle cx="430" cy="352" r="4.5" style={floatStyle(9, 0.65)} />
        <circle cx="168" cy="452" r="4.5" style={floatStyle(10, 0.9)} />
      </g>
    </svg>
  );
}

/** 비로그인 첫 방문자에게 보이는 전체 화면 랜딩. AppShell 위에 떠 있는 오버레이라
 * 레일/탭바 구조를 건드리지 않는다(패널은 캔버스 위에 뜬다는 §설계 원칙과 동일). */
export function TelescopeLanding() {
  const router = useRouter();
  // "/"는 로그인 여부와 무관하게 항상 이 랜딩이다(사용자 지시). 로그인
  // 상태면 우상단 "로그인" 자리가 "피드"(소셜)로 바뀐다.
  const { user } = useAuth();
  // 진입 연출의 무게중심이 로그인 화면으로 옮겨졌다(사용자 지시: "망원경
  // 들여다보기 누르면 (...) 로그인창이 떴으면 좋겠어"). 접안렌즈 도상과 명->암
  // 확대 전환은 이제 app/login/page.tsx가 들고 있고, 랜딩은 그리로 넘기기만
  // 한다. 연타로 라우팅이 중복되지 않게 이동 중 플래그만 남긴다.
  const [leaving, setLeaving] = useState(false);

  // CTA를 누르기 전에 목적지를 미리 받아 전환 직후 빈 화면이 없게 한다.
  // 비로그인 = 실제 서비스 화면 접근 불가(사용자 지시) - 메인 CTA는 로그인으로 간다.
  useEffect(() => {
    router.prefetch("/login");
  }, [router]);

  return (
    <div
      className="telescope-landing bg-paper-grid fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden"
      style={{ backgroundColor: "var(--paper)", color: "var(--paper-ink)" }}
    >
      {/* 성도 인쇄물의 외곽 계선 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-4 border md:inset-7"
        style={{ borderColor: "var(--paper-line)" }}
      />

      {/* 상단 바 */}
      <header className="absolute inset-x-4 top-4 z-10 flex items-center justify-between px-6 py-5 md:inset-x-7 md:top-7 md:px-9">
        <span className="font-serif text-title font-bold tracking-wide" style={{ color: "var(--paper-ink)" }}>
          OurLab
        </span>
        <nav className="flex items-center gap-7 text-body-sm">
          {/* 진입 플로우 BGM(랜딩=묵직한 믹스). 사용자 배치 지시. */}
          <BgmToggle mode="landing" variant="paper" />
          <Link href="/demo" style={{ color: "var(--paper-lo)" }}>
            둘러보기
          </Link>
          {user ? (
            <Link href="/feed" className="font-medium" style={{ color: "var(--paper-ink)" }}>
              피드
            </Link>
          ) : (
            <Link href="/login" className="font-medium" style={{ color: "var(--paper-ink)" }}>
              로그인
            </Link>
          )}
        </nav>
      </header>

      {/* 본문: 좌 헤드라인 · 우 도면 (모바일은 도면 축소판이 헤드라인 위) */}
      <div className="flex min-h-full items-center py-24 lg:py-0">
        <div className="mx-auto grid w-full max-w-[1280px] items-center gap-10 px-10 md:px-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-12">
          <div className="flex max-w-[680px] flex-col items-start gap-7">
            {/* 모바일/태블릿: 축소된 도면이 첫 뷰포트를 지킨다 */}
            <div className="-mb-2 self-center lg:hidden">
              <ReticleFigure width={196} />
            </div>
            <span className="font-mono text-caption tracking-[0.14em]" style={{ color: "var(--paper-lo)" }}>
              FOR UNDECLARED · YONSEI
            </span>
            <h1
              className="font-serif text-[28px] font-bold leading-[1.45] md:text-[40px]"
              style={{ color: "var(--paper-ink)", wordBreak: "keep-all", textWrap: "pretty" }}
            >
              흩어진 점들을 이으면,
              <br />
              나만의 별자리가 된다.
            </h1>
            <p
              className="text-[16px] leading-[1.75]"
              style={{ color: "var(--paper-lo)", wordBreak: "keep-all" }}
            >
              몇 가지 질문에 답하면, 수업·자격증·활동을 이어
              <br className="hidden md:block" /> 지금의 나에게 맞는 로드맵 별자리를 제안해요.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-5">
              <button
                type="button"
                onClick={() => {
                  if (leaving) return;
                  setLeaving(true);
                  router.push("/login");
                }}
                disabled={leaving}
                className="cta-ink flex items-center gap-2.5 rounded-full px-7 py-[15px] text-body font-medium leading-none disabled:opacity-70"
                style={{ backgroundColor: "var(--paper-ink)", color: "var(--paper)" }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 20 20"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M2.5 12.5 L13 4.5" />
                  <path d="M12 3.2 L16.8 8 L14.5 9.8 L10.2 5.5 Z" />
                  <path d="M7 9 L4 17" />
                  <path d="M7.6 12.8 L11 17" />
                </svg>
                망원경 들여다보기
              </button>
              <Link
                href="/demo"
                className="border-b pb-0.5 text-body-sm"
                style={{ color: "var(--paper-lo)", borderColor: "var(--paper-line)" }}
              >
                로그인 없이 먼저 둘러보기
              </Link>
            </div>
          </div>

          {/* 데스크톱: 원본 크기 도면 + 도판 라벨 */}
          <div className="relative hidden lg:block" aria-hidden>
            <ReticleFigure width={480} />
            <p className="absolute bottom-1 left-24 text-[11px] tracking-[0.1em]" style={{ color: "var(--paper-lo)" }}>
              <span className="font-mono">FIG. 1</span> — 아직 이름 없는 별자리
            </p>
          </div>
        </div>
      </div>

      {/* 하단 캡션 - 모바일에서는 흐름에 두어 CTA와 겹치지 않게 한다 */}
      <p
        className="px-10 pb-10 pt-2 text-caption md:px-16 lg:absolute lg:bottom-12 lg:left-16 lg:p-0"
        style={{ color: "var(--paper-lo)" }}
      >
        연세대학교 재학생 인증 기반 · OurLab
      </p>

    </div>
  );
}
