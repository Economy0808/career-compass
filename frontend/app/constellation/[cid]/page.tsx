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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ConstellationCanvas } from "@/components/ConstellationCanvas";
import { EmptyState, Avatar } from "@/components/ui";
import { getConstellation, type ConstellationDto } from "@/lib/constellation-api";
import { mapEdges, mapGroups, mapNodes } from "@/lib/constellation-canvas-map";
import { getProfile, type ProfileDto } from "@/lib/profiles-api";
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

// DTO→캔버스 매핑은 lib/constellation-canvas-map.ts 공용(게시물 상세의 작성자
// 별자리 미리보기와 공유). noteCount를 매핑하지 않는 이유도 그 파일 참고.

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
  // 작성자 표시 - 뷰어 렌더를 막지 않는 별도 상태. undefined=조회 중/실패(자리표시
  // 유지), ProfileDto=로드 성공.
  const [author, setAuthor] = useState<ProfileDto | undefined>(undefined);
  // 성단 펼침/접힘의 로컬 전용 오버라이드 - 이 화면은 남의 별자리를 구경만
  // 하는 뷰어라 서버 PATCH를 절대 보내지 않는다(편집 화면의 handleGroupToggleCollapse와
  // 달리 큐가 아예 없다). groupId -> collapsed로만 base 맵을 덮어써 렌더한다.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setGroupOverrides({});
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

  const ownerId = state.kind === "loaded" ? state.data.ownerId : null;

  useEffect(() => {
    if (ownerId === null) return;
    let cancelled = false;
    setAuthor(undefined);
    getProfile(ownerId)
      .then((p) => {
        if (!cancelled) setAuthor(p);
      })
      .catch(() => {
        // 조회 실패는 헤더 자리표시("알 수 없는 관측자")만 유지 - 뷰어 렌더를 막지 않는다.
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  const nodes = useMemo(() => (state.kind === "loaded" ? mapNodes(state.data) : {}), [state]);
  const edges = useMemo(() => (state.kind === "loaded" ? mapEdges(state.data) : {}), [state]);
  const baseGroups = useMemo(() => (state.kind === "loaded" ? mapGroups(state.data) : {}), [state]);
  // base 위에 로컬 오버라이드만 얹는다 - 서버 응답은 절대 덮어쓰지 않는다.
  const groups = useMemo(() => {
    const overrideIds = Object.keys(groupOverrides);
    if (overrideIds.length === 0) return baseGroups;
    const next = { ...baseGroups };
    for (const id of overrideIds) {
      if (next[id]) next[id] = { ...next[id], collapsed: groupOverrides[id] };
    }
    return next;
  }, [baseGroups, groupOverrides]);

  const handleGroupToggleCollapse = useCallback((groupId: string, collapsed: boolean) => {
    setGroupOverrides((prev) => ({ ...prev, [groupId]: collapsed }));
  }, []);

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
        groups={groups}
        readOnly
        fitRequest={fitRequest}
        onNodeDrag={noop}
        onNodeToggleComplete={noop}
        onEdgeCreate={noop}
        onGroupToggleCollapse={handleGroupToggleCollapse}
      />

      {/* 상단 정보 카드 - 이름 + 작성자(+ description/contributors가 있으면).
          새 별자리 만들기 화면의 좌상단 저장 툴바와 같은 종이 크롬 시각
          언어(paper-surface, DESIGN.md의 Floating-Chrome Paper Rule). */}
      {/* 모바일: 좌상단 로고 섬과 같은 줄에서 충돌하지 않게 그 아래로 내리고,
          폭은 뷰포트에 클램프한다(375px에서 max-w-md가 넘치던 검수 지적). */}
      <div className="paper-surface fixed left-1/2 top-16 z-20 w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-paper-line bg-paper-soft/95 px-4 py-3 shadow-panel backdrop-blur-md md:top-3">
        <h1 className="truncate font-serif text-title font-bold text-paper-ink">{data.title}</h1>
        <div className="mt-1.5 flex items-center gap-2">
          {/* GET /constellations/{id}는 ownerId만 내려준다 - 표시 이름/아바타는
              lib/profiles-api.ts의 GET /api/profiles/{uid}로 별도 조회한다.
              조회 실패(404 등)는 "알 수 없는 관측자" 자리표시로 통일한다. */}
          <Avatar emoji={author?.avatarEmoji ?? "🔭"} name={author?.displayName ?? "알 수 없는 관측자"} size="sm" />
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
