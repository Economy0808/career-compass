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
import type { EdgeDto, NodeDto } from "@/lib/constellation-api";

export interface MiniConstellationProps {
  nodes: Record<string, NodeDto>;
  edges: Record<string, EdgeDto>;
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

export function MiniConstellation({ nodes, edges, className }: MiniConstellationProps) {
  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  // 존재하지 않는 노드를 가리키는 엣지는 건너뛴다 (ConstellationCanvas의
  // validEdges와 동일한 방어 규칙).
  const validEdges = useMemo(
    () => Object.values(edges).filter((e) => nodes[e.sourceNodeId] && nodes[e.targetNodeId]),
    [edges, nodes]
  );

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

  const xs = nodeList.map((n) => n.position.x);
  const ys = nodeList.map((n) => n.position.y);
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
      {validEdges.map((edge) => {
        const source = nodes[edge.sourceNodeId];
        const target = nodes[edge.targetNodeId];
        const lit = source.isCompleted && target.isCompleted;
        return (
          <line
            key={edge.id}
            x1={source.position.x}
            y1={source.position.y}
            x2={target.position.x}
            y2={target.position.y}
            stroke={lit ? "var(--lit)" : "var(--rule)"}
            strokeWidth={lit ? 1.6 : 1}
            opacity={lit ? 1 : 0.7}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {nodeList.map((node) => {
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
    </svg>
  );
}
