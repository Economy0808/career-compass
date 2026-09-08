"use client";

/*
 * 탐색 허브 - 예전에는 이 경로가 "학우"(관심사 기반 사람 찾기) 화면 그 자체였지만,
 * 2026-09-08 사용자 지시로 허브 화면으로 바뀌었다. 사람 찾기 로직은 통째로
 * app/explore/people/page.tsx로 옮기고, 여기는 세 목적지(학우·자격증·학회·동아리)로
 * 갈라지는 진입점만 남긴다. societies/certifications와 같은 밝은 종이 테마
 * (paper-* 토큰, .paper-surface 스코프)로 통일한다 - 예전 어두운 우주 테마는
 * /explore/people로 옮겨가면서 이미 종이 테마로 바뀌었다.
 *
 * 레이아웃: 큰 돋보기 히어로 아래, 마인드맵 형태로 세 노드를 연결한다. 그래프
 * 라이브러리 없이 얇은 SVG 선(데스크톱 - 돋보기에서 세 갈래) + 단순 세로선
 * (모바일 - 카드가 세로로 쌓이므로 굳이 갈라지는 선이 필요 없다)으로 충분하다.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { BoardIcon, CheckIcon, ProfileIcon, SearchIcon } from "@/components/ui/icons";

interface ExploreNodeSpec {
  href: string;
  label: string;
  desc: string;
  icon: ReactNode;
}

const NODES: readonly ExploreNodeSpec[] = [
  { href: "/explore/people", label: "학우", desc: "관심사로 사람을 찾아요", icon: <ProfileIcon size={26} /> },
  { href: "/certifications", label: "자격증", desc: "공식·제보 자격증을 찾아요", icon: <CheckIcon size={26} /> },
  { href: "/societies", label: "학회 · 동아리", desc: "분야별 학회·동아리 정보", icon: <BoardIcon size={26} /> },
] as const;

function ExploreNode({ href, label, desc, icon }: ExploreNodeSpec) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-2xl border border-paper-line/60 bg-paper-soft/70 px-5 py-6 text-center no-underline shadow-[0_1px_2px_rgba(28,28,45,0.04),0_6px_20px_-8px_rgba(28,28,45,0.08)] transition-shadow hover:shadow-[0_2px_4px_rgba(28,28,45,0.05),0_10px_28px_-8px_rgba(28,28,45,0.10)]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-paper-line bg-paper text-paper-ink">
        {icon}
      </span>
      <span className="font-sans text-body font-semibold text-paper-ink">{label}</span>
      <span className="text-caption text-paper-lo">{desc}</span>
    </Link>
  );
}

export default function ExploreHubPage() {
  return (
    <div className="paper-surface mx-auto max-w-3xl rounded-3xl border border-paper-line/60 bg-paper px-4 py-12 shadow-[0_2px_8px_rgba(20,20,40,0.06),0_24px_56px_-28px_rgba(20,20,40,0.28)] md:px-10 md:py-16">
      <header className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="font-serif text-display font-bold text-paper-ink">탐색</h1>
        <p className="text-body-sm text-paper-lo">무엇을 찾고 있나요?</p>
      </header>

      {/* 거대한 돋보기 히어로 */}
      <div className="mt-8 flex justify-center">
        <SearchIcon size={112} className="text-paper-ink" />
      </div>

      {/* 돋보기 -> 세 노드로 이어지는 마인드맵. 트렁크(줄기)는 항상 보이고,
          갈래는 데스크톱만(모바일은 세로로 쌓이니 갈라질 필요가 없다). */}
      <div className="mx-auto mt-2 h-6 w-px bg-paper-line" aria-hidden />
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="hidden h-8 w-full md:block"
        aria-hidden
      >
        <path
          d="M50 0 L16.5 32 M50 0 L50 32 M50 0 L83.5 32"
          stroke="var(--paper-line)"
          strokeWidth="1"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mx-auto block h-6 w-px bg-paper-line md:hidden" aria-hidden />

      <div className="mt-1 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {NODES.map((node) => (
          <ExploreNode key={node.href} {...node} />
        ))}
      </div>
    </div>
  );
}
