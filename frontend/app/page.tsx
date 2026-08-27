"use client";

/*
 * impeccable direction contract — 로그인 사용자 홈: 별자리 소셜 피드
 * MODE: Inform/Explore. 로그인 사용자가 다른 학생들이 발행한 별자리를 둘러보는 관측 기록 열람.
 * AUDIENCE/JOB: 연세대 재학 인증을 마친 학생. 행동 = 카드를 훑어보며 남의 로드맵에서 아이디어를
 *   얻는 것 - 아직 상세 페이지가 없으므로 클릭 유도는 하지 않는다(카드는 정보 표면일 뿐).
 * DIRECTION: TelescopeLanding의 "관측/성도" 어휘를 어두운 우주 쪽으로 그대로 옮긴다. 하나의
 *   관측 로그 헤더(serif 헤드라인 + mono 필드노트 서브라인) 아래 카드 그리드 - 히어로 없음,
 *   피드 자체가 콘텐츠.
 * MEMORABLE MOMENT: 카드 안의 MiniConstellation - 진짜 그래프 데이터를 그대로 축소해 보여주는
 *   것 자체가 장식이다(따로 일러스트를 그리지 않음).
 * CONSTRAINTS: 색은 ink-*, spec-*, text-*, rule 토큰만. 모션은 카드 호버 트랜지션 1개뿐(상시
 *   애니메이션 금지). 카드는 아직 링크가 아니다(상세 페이지 없음) - cursor-default.
 * RESOLVES: .impeccable/surfaces/frontend-app-page-tsx.md의 Unresolved 노트 - 로그인 사용자의
 *   "/"는 이제 이 별자리 피드다. 비로그인 방문자는 TelescopeLanding을 그대로 본다(미변경).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { MiniConstellation } from "@/components/MiniConstellation";
import { TelescopeLanding } from "@/components/TelescopeLanding";
import { getFeed, type FeedItemDto } from "@/lib/constellation-api";
import { relativeTimeKo } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";

function FeedSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <div className="mb-8 h-8 w-48 animate-pulse rounded bg-ink-800" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-rule bg-ink-800/70">
            <div className="aspect-[16/10] animate-pulse bg-ink-700/50" />
            <div className="space-y-2 p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-ink-700/50" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-ink-700/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedCard({ item }: { item: FeedItemDto }) {
  const { constellation, author } = item;
  const nodeList = Object.values(constellation.nodes);
  const completed = nodeList.filter((n) => n.isCompleted).length;

  return (
    <article className="cursor-default rounded-lg border border-rule bg-ink-800/70 backdrop-blur-[2px] transition-colors hover:bg-ink-800/90">
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-lg border-b border-rule bg-ink-900">
        <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
        <MiniConstellation
          nodes={constellation.nodes}
          edges={constellation.edges}
          className="absolute inset-0 h-full w-full p-3"
        />
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        <h3 className="truncate font-sans text-body font-medium text-text-hi">{constellation.title}</h3>
        <div className="flex items-center justify-between gap-2">
          <Avatar emoji={author.avatarEmoji ?? "🔭"} name={author.displayName ?? "이름 없는 관측자"} size="sm" />
          <span className="shrink-0 font-mono text-caption text-text-lo">
            {completed}/{nodeList.length}
          </span>
        </div>
        <span className="font-mono text-micro tracking-[0.08em] text-text-lo/80">
          {relativeTimeKo(constellation.updatedAt)}
        </span>
      </div>
    </article>
  );
}

/** 아직 발행된 별자리가 없을 때 - ReticleFigure(랜딩)의 선화 어휘를 카드
 * 안에 들어갈 크기로 축약한 버전(점선 시야원 + 속이 빈 별 몇 개). */
function EmptyFeedFigure() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className="mx-auto mb-5" aria-hidden>
      <circle cx="60" cy="60" r="46" stroke="var(--rule)" strokeWidth="1" strokeDasharray="3 6" fill="transparent" />
      <g stroke="var(--rule)" fill="transparent" strokeWidth="1.2" opacity="0.7">
        <circle cx="46" cy="52" r="4" />
        <circle cx="76" cy="44" r="3" />
        <circle cx="66" cy="76" r="3.5" />
      </g>
    </svg>
  );
}

function FeedContent() {
  const [items, setItems] = useState<FeedItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    setItems(null);
    getFeed()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "피드를 불러오지 못했어요"));
  }

  useEffect(load, []);

  if (error) {
    return (
      <div className="mx-auto max-w-sm py-24 text-center">
        <p className="text-body-sm text-text-lo">{error}</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={load}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (items === null) return <FeedSkeleton />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <header className="mb-8 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">다른 사람들의 별자리</h1>
        <span className="font-mono text-caption tracking-[0.14em] text-text-lo">
          FIELD NOTE · {items.length}개의 별자리
        </span>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-rule px-6 py-16 text-center">
          <EmptyFeedFigure />
          <p className="text-body font-semibold text-text-lo">아직 발행된 별자리가 없어요</p>
          <p className="mx-auto mt-2 max-w-sm text-body-sm text-text-lo/80">
            첫 번째 관측자가 되어보세요
          </p>
          <div className="mt-5 flex justify-center">
            {/* Button은 <button>이라 <a> 안에 중첩하면 인터랙티브 콘텐츠 중첩(HTML
                무효) - verify/page.tsx의 LINK_PRIMARY처럼 버튼 시각 스타일을
                Link 자체에 입힌다. */}
            <Link
              href="/constellation/new"
              className="rounded-md border border-transparent bg-spec-b px-5 py-2.5 text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
            >
              별자리 만들러 가기
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <FeedCard key={item.constellation.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FeedPage() {
  const { user, loading } = useAuth();

  if (!loading && !user) return <TelescopeLanding />;
  if (loading) return <FeedSkeleton />;

  return <FeedContent />;
}
