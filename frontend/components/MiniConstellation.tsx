"use client";

/**
 * 피드 카드용 별자리 축소 미리보기 - ConstellationCanvas의 정지 사본.
 *
 * 팬/줌/드래그/선택 등 캔버스의 상호작용은 전부 없고, 그리기 문법만 그대로
 * 가져온다: 노드는 유형색(colorForType) + 완료=채움/미완료=속이 빈 점,
 * 인접 발광 규칙(양 끝 완료 시에만 lit 색 간선)도 동일하게 따른다 - 다만
 * 실제 발광(필터)과 pulse 애니메이션은 카드 크기에서 소음일 뿐이라 뺐다.
 *
 * 좌표는 원본 캔버스의 world 좌표를 그대로 쓰고, 노드 바운딩 박스에 맞춘
 * viewBox로 확대/축소한다. vector-effect="non-scaling-stroke"로 헤어라인
 * 굵기가 별자리 크기와 무관하게 화면 픽셀 기준으로 일정하게 보이게 한다.
 */

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import type { EdgeDto, GroupDto, NodeDto } from "@/lib/constellation-api";

export interface MiniConstellationProps {
  nodes: Record<string, NodeDto>;
  edges: Record<string, EdgeDto>;
  /** id를 key로 하는 맵(nodes/edges와 동일 관례) - 생략하면 성단 없이 기존과
   * 동일하게 그린다. 이 타일은 정지 사본이라 펼치기/접기 상호작용은 없고,
   * collapsed=true인 그룹만 항상 점 하나로 그린다(ConstellationCanvas의
   * 대표연결·dedupe 규칙을 그대로 따르는 정적 버전). */
  groups?: Record<string, GroupDto>;
  className?: string;
}

const PADDING_RATIO = 0.12;
const MIN_SPAN = 40; // 노드가 한 줄/한 점에 몰려 폭이나 높이가 0일 때의 최소 뷰박스 크기

/** 카드가 비어 있을 때의 장식용 정적 별밭 - 애니메이션 없음, 좌표는 고정값. */
function EmptyStarfield() {
  return (
    <svg viewBox="0 0 200 125" className="h-full w-full" aria-hidden>
      <g fill="var(--text-lo)">
        <circle cx="38" cy="40" r="1.4" opacity="0.4" />
        <circle cx="96" cy="70" r="1.8" opacity="0.5" />
        <circle cx="150" cy="34" r="1.2" opacity="0.35" />
        <circle cx="66" cy="96" r="1.2" opacity="0.3" />
        <circle cx="132" cy="88" r="1.5" opacity="0.4" />
        <circle cx="20" cy="90" r="1" opacity="0.3" />
        <circle cx="170" cy="66" r="1" opacity="0.3" />
      </g>
    </svg>
  );
}

/** 엣지 끝점 하나를 해석한 결과 - 접힌 그룹 멤버를 가리키면 그룹 점으로
 * 대체된다(ConstellationCanvas.resolveEndpoint의 정적 버전). */
interface Endpoint {
  key: string;
  x: number;
  y: number;
  isCompleted: boolean;
}

export function MiniConstellation({ nodes, edges, groups, className }: MiniConstellationProps) {
  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  // 존재하지 않는 노드를 가리키는 엣지는 건너뛴다 (ConstellationCanvas의
  // validEdges와 동일한 방어 규칙).
  const validEdges = useMemo(
    () => Object.values(edges).filter((e) => nodes[e.sourceNodeId] && nodes[e.targetNodeId]),
    [edges, nodes]
  );

  // 접힌 그룹만 - 정지 타일이라 펼침/접힘 상호작용 없이 collapsed=true인
  // 그룹은 항상 점 하나로 그린다(캔버스의 collapsedGroupList와 동일 규칙).
  const collapsedGroups = useMemo(() => Object.values(groups ?? {}).filter((g) => g.collapsed), [groups]);
  // 숨겨진 멤버 nodeId -> 그 그룹 id. 존재하지 않는 노드는 매핑하지 않는다.
  const memberGroupId = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of collapsedGroups) {
      for (const m of g.memberNodeIds) if (nodes[m]) map.set(m, g.id);
    }
    return map;
  }, [collapsedGroups, nodes]);
  const hiddenNodeIds = useMemo(() => new Set(memberGroupId.keys()), [memberGroupId]);
  const visibleNodes = useMemo(() => nodeList.filter((n) => !hiddenNodeIds.has(n.id)), [nodeList, hiddenNodeIds]);
  // 멤버가 하나도 안 남은(전부 삭제된) 빈 그룹은 방어적으로 숨긴다.
  const visibleGroups = useMemo(
    () => collapsedGroups.filter((g) => g.memberNodeIds.some((m) => nodes[m])),
    [collapsedGroups, nodes]
  );

  // 표시용 엣지 - 그룹으로 대체된 끝점끼리 중복되는 쌍은 하나로 합치고,
  // 같은 그룹 내부 간선(양 끝이 같은 그룹으로 대체됨)은 완전히 숨긴다.
  const displayEdges = useMemo(() => {
    function resolveEndpoint(nodeId: string): Endpoint | null {
      const groupId = memberGroupId.get(nodeId);
      if (groupId) {
        const g = groups?.[groupId];
        if (!g) return null;
        const members = g.memberNodeIds.filter((m) => nodes[m]);
        const isCompleted = members.length > 0 && members.every((m) => nodes[m].isCompleted);
        return { key: `group:${g.id}`, x: g.position.x, y: g.position.y, isCompleted };
      }
      const n = nodes[nodeId];
      if (!n) return null;
      return { key: nodeId, x: n.position.x, y: n.position.y, isCompleted: n.isCompleted };
    }
    const seen = new Map<string, { id: string; source: Endpoint; target: Endpoint }>();
    for (const e of validEdges) {
      const source = resolveEndpoint(e.sourceNodeId);
      const target = resolveEndpoint(e.targetNodeId);
      if (!source || !target || source.key === target.key) continue;
      const key = source.key < target.key ? `${source.key}|${target.key}` : `${target.key}|${source.key}`;
      if (!seen.has(key)) seen.set(key, { id: e.id, source, target });
    }
    return Array.from(seen.values());
  }, [validEdges, memberGroupId, groups, nodes]);

  if (nodeList.length === 0) {
    return (
      <div className={cn("flex items-center justify-center", className)} aria-hidden>
        <EmptyStarfield />
      </div>
    );
  }

  if (nodeList.length === 1) {
    const only = nodeList[0];
    const color = only.color ?? colorForType(only.type);
    return (
      <svg viewBox="0 0 100 100" className={className} aria-hidden>
        <circle
          cx={50}
          cy={50}
          r={5}
          fill={only.isCompleted ? color : "transparent"}
          stroke={only.isCompleted ? "none" : "var(--rule)"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  // 뷰박스는 실제로 그려지는 점(숨겨진 그룹 멤버 제외 + 성단 점 자체 포함) 기준.
  const xs = [...visibleNodes.map((n) => n.position.x), ...visibleGroups.map((g) => g.position.x)];
  const ys = [...visibleNodes.map((n) => n.position.y), ...visibleGroups.map((g) => g.position.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, MIN_SPAN);
  const spanY = Math.max(maxY - minY, MIN_SPAN);
  const padX = spanX * PADDING_RATIO;
  const padY = spanY * PADDING_RATIO;
  // 폭/높이가 0에 가까운 축은 중앙에 재배치해 뷰박스 중심에 오도록 한다.
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const viewMinX = centerX - spanX / 2 - padX;
  const viewMinY = centerY - spanY / 2 - padY;
  const viewW = spanX + padX * 2;
  const viewH = spanY + padY * 2;
  const nodeR = Math.max(Math.min(spanX, spanY) * 0.035, 3);

  return (
    <svg
      viewBox={`${viewMinX} ${viewMinY} ${viewW} ${viewH}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {/* 엣지 - 접힌 그룹의 멤버를 가리키는 끝점은 성단 점으로 대체된다
          (displayEdges, 위 대표연결 로직 참고). */}
      {displayEdges.map(({ id, source, target }) => {
        const lit = source.isCompleted && target.isCompleted;
        return (
          <line
            key={id}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke={lit ? "var(--lit)" : "var(--rule)"}
            strokeWidth={lit ? 1.6 : 1}
            opacity={lit ? 1 : 0.7}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* 노드 - 접힌 그룹의 멤버는 숨긴다(아래 성단 점으로 대표된다). */}
      {visibleNodes.map((node) => {
        const color = node.color ?? colorForType(node.type);
        return (
          <circle
            key={node.id}
            cx={node.position.x}
            cy={node.position.y}
            r={nodeR}
            fill={node.isCompleted ? color : "transparent"}
            stroke={node.isCompleted ? "none" : "var(--rule)"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {/* 성단(접힌 그룹) - 멤버 유형이 섞이면 중립 악센트로 강등한다(캔버스와
          동일 규칙). 정지 타일이라 개수 배지 없이 점 하나로만 표시. */}
      {visibleGroups.map((group) => {
        const members = group.memberNodeIds.map((m) => nodes[m]).filter((n): n is NodeDto => !!n);
        if (members.length === 0) return null;
        const firstType = members[0].type;
        const color = members.every((n) => n.type === firstType) ? colorForType(firstType) : "var(--text-hi)";
        const allCompleted = members.every((n) => n.isCompleted);
        return (
          <circle
            key={`group:${group.id}`}
            cx={group.position.x}
            cy={group.position.y}
            r={nodeR * 1.6}
            fill={allCompleted ? color : "transparent"}
            stroke={allCompleted ? "none" : "var(--rule)"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
