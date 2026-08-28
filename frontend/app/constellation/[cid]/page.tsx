"use client";

/**
 * 발행 별자리 열람 전용 뷰어 - "/constellation/{cid}".
 *
 * 누구나(비로그인 포함) 발행된 별자리를 구경할 수 있게 하는 화면. 편집 화면
 * (app/constellation/new/page.tsx)과 달리 서버 상태를 로컬로 복제해 뮤테이션
 * 큐로 되돌려보내는 로직이 전혀 없다 - getConstellation으로 한 번 읽어 온
 * 그래프를 ConstellationCanvas에 readOnly로 그대로 넘길 뿐이다.
 *
 * 노트는 이 단계에서 다루지 않는다(공개/비공개 노트 정책이 백엔드에서 아직
 * 확정 중) - listNotes를 아예 호출하지 않고, 노드에도 noteCount를 매핑하지
 * 않는다 - 팝오버가 열리더라도(readOnly가 실제로 막는지는 아래 렌더 직전
 * 주석 참고) "노트" 관련 UI가 뜰 여지 자체를 없앤다.
 *
 * description/contributors는 백엔드 커밋 a8fa8ab(스키마 B1)로 이미 내려오지만,
 * lib/constellation-api.ts(수정 금지 파일)의 ConstellationDto 타입은 아직 그
 * 필드들을 선언하지 않았을 수 있다 - 타입을 확장하는 대신 응답 객체를 안전하게
 * 좁혀서만 읽는다(아래 readDescription/readContributors).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ConstellationCanvas,
  type CanvasEdge,
  type CanvasNode,
} from "@/components/ConstellationCanvas";
import { EmptyState, Avatar } from "@/components/ui";
import { getConstellation, type ConstellationDto } from "@/lib/constellation-api";
import { ApiError } from "@/lib/api";

function readDescription(data: ConstellationDto): string | undefined {
  if (!("description" in data)) return undefined;
  const value = (data as { description?: unknown }).description;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readContributors(data: ConstellationDto): string[] {
  if (!("contributors" in data)) return [];
  const value = (data as { contributors?: unknown }).contributors;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function mapNodes(dto: ConstellationDto): Record<string, CanvasNode> {
  const nodes: Record<string, CanvasNode> = {};
  for (const n of Object.values(dto.nodes)) {
    nodes[n.id] = {
      id: n.id,
      label: n.label,
      type: n.type,
      isCompleted: n.isCompleted,
      position: n.position,
      level: n.level,
      code: n.code,
      description: n.description,
      color: n.color,
      // noteCount는 일부러 매핑하지 않는다 - 이 뷰어는 노트를 다루지 않는다.
    };
  }
  return nodes;
}

function mapEdges(dto: ConstellationDto): Record<string, CanvasEdge> {
  const edges: Record<string, CanvasEdge> = {};
  for (const e of Object.values(dto.edges)) {
    edges[e.id] = { id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId };
  }
  return edges;
}

// no-op 편집 콜백 - readOnly=true라 실제로 호출되지 않지만, ConstellationCanvas의
// props 계약은 이 셋을 필수로 요구한다(캔버스는 "새 원소 놓기 화면"과 이
// 뷰어가 공유하는 컴포넌트라 여기서 새로 optional로 바꾸지 않는다 - 수정 금지 파일).
function noop() {}

type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "loaded"; data: ConstellationDto };

export default function ConstellationViewerPage() {
  const params = useParams<{ cid: string }>();
  const cid = params.cid;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const fitTokenRef = useRef(0);
  const [fitRequest, setFitRequest] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getConstellation(cid)
      .then((data) => {
        if (cancelled) return;
        // 미발행 별자리는 익명 열람 대상이 아니다 - 소유자 본인이 쿠키를 들고
        // 같은 페이지를 열어 200을 받는 경우까지 포함해 여기서 한 번 더 막는다.
        if (!data.isPublished) {
          setState({ kind: "unavailable" });
          return;
        }
        setState({ kind: "loaded", data });
        fitTokenRef.current += 1;
        setFitRequest(fitTokenRef.current);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setState({ kind: "unavailable" });
          return;
        }
        console.error("[constellation viewer] 로드 실패", err);
        setState({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [cid]);

  const nodes = useMemo(() => (state.kind === "loaded" ? mapNodes(state.data) : {}), [state]);
  const edges = useMemo(() => (state.kind === "loaded" ? mapEdges(state.data) : {}), [state]);

  if (state.kind === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-900">
        <p className="animate-pulse font-serif text-sm text-text-lo">관측 준비 중…</p>
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-900 px-6">
        <EmptyState
          title="관측할 수 없는 별자리"
          description="발행되지 않았거나 삭제되었을 수 있어요."
          action={
            <Link
              href="/feed"
              className="rounded-md border border-transparent bg-spec-b px-5 py-2.5 text-body-sm font-bold text-ink-900 no-underline transition-[filter] duration-150 hover:brightness-110"
            >
              피드로 돌아가기
            </Link>
          }
        />
      </div>
    );
  }

  const { data } = state;
  const description = readDescription(data);
  const contributors = readContributors(data);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      <ConstellationCanvas
        nodes={nodes}
        edges={edges}
        readOnly
        fitRequest={fitRequest}
        onNodeDrag={noop}
        onNodeToggleComplete={noop}
        onEdgeCreate={noop}
      />

      {/* 상단 정보 카드 - 이름 + 작성자(+ description/contributors가 있으면).
          새 별자리 만들기 화면의 좌상단 저장 툴바와 같은 종이 크롬 시각
          언어(paper-surface, DESIGN.md의 Floating-Chrome Paper Rule). */}
      <div className="paper-surface fixed left-1/2 top-3 z-20 max-w-md -translate-x-1/2 rounded-lg border border-paper-line bg-paper-soft/95 px-4 py-3 shadow-panel backdrop-blur-md">
        <h1 className="truncate font-serif text-title font-bold text-paper-ink">{data.title}</h1>
        <div className="mt-1.5 flex items-center gap-2">
          {/* 이 엔드포인트(GET /constellations/{id})는 피드와 달리 작성자
              표시 이름을 내려주지 않는다(ownerId뿐) - 피드 카드가 이름이 없을
              때 쓰는 것과 같은 자리표시 문구로 통일한다. */}
          <Avatar emoji="🔭" name="이름 없는 관측자" size="sm" />
        </div>
        {description && (
          <p className="mt-2 font-sans text-xs leading-relaxed text-paper-lo">{description}</p>
        )}
        {contributors.length > 0 && (
          <p className="mt-1.5 font-sans text-micro text-paper-lo">
            함께: {contributors.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
