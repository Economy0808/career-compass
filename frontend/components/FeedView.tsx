"use client";

/*
 * 별자리 소셜 피드 - 로그인 홈("/")과 상시 접근 가능한 "/feed" 둘 다 이 컴포넌트를
 * 그대로 렌더한다. 로그인 여부에 따른 분기(비로그인 "/"는 TelescopeLanding)는 이
 * 컴포넌트 밖(app/page.tsx)의 책임이고, 여기는 "발행된 별자리 목록을 어떻게 보여줄
 * 것인가"만 담당한다 - 백엔드 GET /feed가 이미 익명 요청을 허용하므로 이 컴포넌트도
 * 로그인 여부를 신경 쓰지 않는다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { MiniConstellation } from "@/components/MiniConstellation";
import { StoryRing } from "@/components/StoryRing";
import { StoryViewer } from "@/components/StoryViewer";
import { getFeed, type FeedItemDto } from "@/lib/constellation-api";
import type { StoryRingEntryDto } from "@/lib/stories-api";
import { relativeTimeKo } from "@/lib/format";

/** 데이터 로딩 중 표시. app/page.tsx가 인증 상태 로딩 중에도 동일한 스켈레톤을
 * 재사용하므로 export한다. */
export function FeedSkeleton() {
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
    // 카드 전체가 발행 별자리 뷰어(/constellation/{cid})로 가는 링크다 - 예전엔
    // "클릭해도 갈 곳이 없다"는 뜻으로 cursor-default를 달아 뒀지만, 이제 갈 곳이
    // 생겼으므로 뗐다. 호버는 기존에 있던 트랜지션 1개(bg 밝아짐)만 그대로 쓰고
    // 새 모션은 추가하지 않는다.
    <Link
      href={`/constellation/${constellation.id}`}
      className="block overflow-hidden rounded-lg border border-rule bg-ink-800/70 no-underline backdrop-blur-[2px] transition-colors hover:bg-ink-800/90"
    >
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
        {/* relativeTimeKo()는 "N시간 전"처럼 항상 한글을 포함한다 - IBM Plex
            Mono엔 한글 글리프가 없으므로(No-Korean-Mono, design-handoff-guide
            §3-6) font-sans로 렌더링한다. */}
        <span className="font-sans text-micro tracking-[0.08em] text-text-lo/80">
          {relativeTimeKo(constellation.updatedAt)}
        </span>
      </div>
    </Link>
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

/** 발행된 별자리 소셜 피드. 데이터 fetch까지 포함해 자기완결적이다 -
 * 호출부는 어디에 배치할지만 결정하면 된다. */
export function FeedView() {
  const [items, setItems] = useState<FeedItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uid: string; ring: StoryRingEntryDto[] } | null>(null);

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
        {/* "개의 별자리"는 한글이라 font-mono(IBM Plex Mono, 한글 글리프 없음)에
            남기면 안 된다(No-Korean-Mono, design-handoff-guide §3-6) - 라틴/숫자
            구간만 font-mono로 남기고 나머지는 font-sans로 분리한다. */}
        <span className="text-caption tracking-[0.14em] text-text-lo">
          <span className="font-mono">FIELD NOTE · {items.length}</span>
          <span className="font-sans">개의 별자리</span>
        </span>
      </header>

      <StoryRing onOpen={(uid, ring) => setViewer({ uid, ring })} className="mb-8" />

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

      {viewer && (
        <StoryViewer ring={viewer.ring} startUid={viewer.uid} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
