"use client";

/*
 * 게시물 상세의 "작성자 별자리 미리보기" - 사용자 지시: "미니 프리뷰인데 그냥
 * SVG로 대충 만들지 말고 메인 캔버스처럼 멋있게 크게 띄워".
 *
 * MiniConstellation(프로필 그리드의 소형 SVG)이 아니라 실제 ConstellationCanvas를
 * readOnly로 임베드한다 - /constellation/{cid} 뷰어와 동일한 렌더 경로라 노드
 * 글로우·엣지 색·성단까지 본편 그대로 나온다.
 *
 * 다만 스크롤 페이지 한가운데라 캔버스의 휠 줌이 페이지 스크롤을 가로채면
 * 곤란하다 - 투명 링크를 전면에 덮어 "보이는 건 실캔버스, 만지면 뷰어로 이동"
 * 으로 정리한다(줌·성단 토글은 뷰어에서).
 *
 * 작성자의 발행 별자리 중 최신(updatedAt) 하나만 보여준다. 없으면 섹션 자체를
 * 렌더하지 않는다(빈 상태로 상세 페이지를 어지럽히지 않는다).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConstellationCanvas } from "@/components/ConstellationCanvas";
import { listUserConstellations, type ConstellationDto } from "@/lib/constellation-api";
import { mapEdges, mapGroups, mapNodes } from "@/lib/constellation-canvas-map";

// readOnly=true라 호출되지 않지만 캔버스 props 계약상 필수(뷰어와 동일한 사정).
function noop() {}

export function AuthorConstellationPreview({ uid }: { uid: string }) {
  const [constellation, setConstellation] = useState<ConstellationDto | null>(null);
  const [fitRequest, setFitRequest] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConstellation(null);
    setFitRequest(null);
    listUserConstellations(uid)
      .then((list) => {
        if (cancelled) return;
        const published = list
          .filter((c) => c.isPublished)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        if (published.length === 0) return;
        setConstellation(published[0]);
        setFitRequest(1);
      })
      .catch(() => {
        // 조회 실패 = 섹션 미표시. 게시물 상세 본편을 막지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const nodes = useMemo(() => (constellation ? mapNodes(constellation) : {}), [constellation]);
  const edges = useMemo(() => (constellation ? mapEdges(constellation) : {}), [constellation]);
  const groups = useMemo(() => (constellation ? mapGroups(constellation) : {}), [constellation]);

  if (!constellation) return null;

  return (
    <section aria-label="작성자의 별자리" className="mt-6">
      <h2 className="mb-2.5 font-sans text-caption font-semibold text-text-lo">작성자의 별자리</h2>
      <div className="relative h-[26rem] overflow-hidden rounded-lg border border-rule bg-ink-900">
        <ConstellationCanvas
          nodes={nodes}
          edges={edges}
          groups={groups}
          readOnly
          fitRequest={fitRequest}
          onNodeDrag={noop}
          onNodeToggleComplete={noop}
          onEdgeCreate={noop}
        />
        {/* 전면 투명 링크 - 클릭 어디서든 뷰어로. 캔버스의 휠/드래그 캡처도 함께 차단. */}
        <Link
          href={`/constellation/${encodeURIComponent(constellation.id)}`}
          aria-label={`${constellation.title} 별자리 크게 보기`}
          className="absolute inset-0 z-10 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-spec-b"
        >
          <span className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
            <span className="truncate font-serif text-body-sm font-bold text-text-hi">
              {constellation.title}
            </span>
            <span className="shrink-0 rounded-md border border-rule bg-ink-800/80 px-2.5 py-1.5 font-sans text-caption text-text-lo backdrop-blur-sm">
              크게 보기 →
            </span>
          </span>
        </Link>
      </div>
    </section>
  );
}
