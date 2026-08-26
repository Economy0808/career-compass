"use client";

/**
 * 별자리(constellation) 캔버스 - OurLab의 핵심 UI.
 *
 * 이전 콩나무(BeanstalkCanvas) 시스템의 밤하늘/달/구름/언덕 같은 삽화 요소는
 * 전부 버리고, Obsidian 그래프 뷰에 가까운 절제된 노트앱 톤으로 다시 그린다.
 * "별자리스러움"은 삽화가 아니라 "완료된 노드끼리 선이 빛난다"는 인접 발광
 * 규칙(is_edge_lit, backend/app/domain/constellation.py) 하나에서만 나온다.
 *
 * 그래프 라이브러리 없이 순수 SVG + 포인터 이벤트로 구현한다(의도적으로
 * 새 의존성을 넣지 않음).
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "@/lib/cn";

export interface CanvasPosition {
  x: number;
  y: number;
}

/** 백엔드 Node 모델과 1:1로 대응. type은 열린 문자열 - 새 종류가 언제든 생길 수 있다. */
export interface CanvasNode {
  id: string;
  label: string;
  type: string;
  isCompleted: boolean;
  position: CanvasPosition;
  level?: number | null;
}

/** 백엔드 Edge 모델과 1:1로 대응. */
export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface ConstellationCanvasProps {
  /** id를 key로 하는 맵. Firestore 점 표기 부분 업데이트와 형태를 맞춘 것이므로 배열로 바꾸지 않는다. */
  nodes: Record<string, CanvasNode>;
  edges: Record<string, CanvasEdge>;
  onNodeDrag: (nodeId: string, position: CanvasPosition) => void;
  onNodeToggleComplete: (nodeId: string) => void;
  onEdgeCreate: (sourceNodeId: string, targetNodeId: string) => void;
  onEdgeDelete?: (edgeId: string) => void;
  /**
   * 외부(원소 보관함 패널 등)에서 HTML5 드래그로 들어온 드롭을 받는다. 캔버스는
   * 드롭된 데이터의 의미(어떤 원소인지)를 알 필요가 없으므로, dataTransfer의
   * "application/json" 페이로드 원문과 변환된 월드 좌표만 그대로 넘긴다.
   * 좌표 변환(clientToWorld)은 pan/zoom transform을 아는 이 컴포넌트 안에서만
   * 해야 하므로, 그 로직을 밖으로 복제하지 않고 이 콜백 하나로 캡슐화했다.
   */
  onExternalDrop?: (data: string, position: CanvasPosition) => void;
  /** 피드 카드/미리보기용. true면 드래그·토글·엣지 생성이 전부 실제로 막힌다. */
  readOnly?: boolean;
  className?: string;
}

const NODE_RADIUS = 9;
const HANDLE_RADIUS = 17;
/** 클릭과 드래그를 구분하는 임계값(px, 화면 좌표 기준). 이보다 적게 움직이면 클릭 = 완료 토글. */
const CLICK_THRESHOLD = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;

// 항성 분광형 악센트(globals.css --spec-*)와 1:1로 대응. 새 type이 런타임에
// 생겨도 하드 실패하지 않도록 DEFAULT_TYPE_COLOR(text-lo)로 안전하게 떨어진다.
const TYPE_COLOR: Record<string, string> = {
  course: "var(--spec-b)", // 수업
  certification: "var(--spec-a)", // 자격증
  organization: "var(--spec-g)", // 학회
  activity: "var(--spec-k)", // 대외활동
  networking: "var(--spec-m)", // 네트워킹
};
const DEFAULT_TYPE_COLOR = "var(--text-lo)"; // 모르는 type도 이 색으로 안전하게 렌더링

function colorForType(type: string): string {
  return TYPE_COLOR[type] ?? DEFAULT_TYPE_COLOR;
}

/** 라벨 앞에 학정번호(예: "BIZ2101 경영정보시스템")가 붙어 있으면 분리한다.
 * 코드는 식별자이므로 font-mono로 작게, 나머지는 본문 폰트로 렌더링한다. */
const COURSE_CODE_RE = /^([A-Z]{2,6}\d{3,5})\s+(.+)$/;
function splitCourseCode(label: string): { code: string | null; rest: string } {
  const m = COURSE_CODE_RE.exec(label);
  return m ? { code: m[1], rest: m[2] } : { code: null, rest: label };
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface DragNodeState {
  kind: "node";
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorld: CanvasPosition;
  moved: boolean;
}

interface DragPanState {
  kind: "pan";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startTransform: Transform;
}

interface DragEdgeState {
  kind: "edge";
  pointerId: number;
  sourceNodeId: string;
}

type DragState = DragNodeState | DragPanState | DragEdgeState | null;

export function ConstellationCanvas({
  nodes,
  edges,
  onNodeDrag,
  onNodeToggleComplete,
  onEdgeCreate,
  onEdgeDelete,
  onExternalDrop,
  readOnly = false,
  className,
}: ConstellationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(null);

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  // 드래그 중인 노드 하나만 낙관적으로 덮어쓴다. 부모의 영속화는 디바운스될 수
  // 있으므로, 실제 props가 따라올 때까지 로컬 좌표를 계속 신뢰한다.
  const [dragPosition, setDragPosition] = useState<{ nodeId: string; position: CanvasPosition } | null>(null);
  const [edgeCursor, setEdgeCursor] = useState<CanvasPosition | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const positionOf = useCallback(
    (nodeId: string): CanvasPosition => {
      if (dragPosition && dragPosition.nodeId === nodeId) return dragPosition.position;
      const n = nodes[nodeId];
      return n ? n.position : { x: 0, y: 0 };
    },
    [nodes, dragPosition]
  );

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): CanvasPosition => {
      const rect = svgRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      return {
        x: (clientX - left - transform.x) / transform.k,
        y: (clientY - top - transform.y) / transform.k,
      };
    },
    [transform]
  );

  // --- 팬 & 줌 -------------------------------------------------------------

  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      const px = e.clientX - (rect?.left ?? 0);
      const py = e.clientY - (rect?.top ?? 0);
      setTransform((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor));
        // 포인터 아래 지점이 화면상 같은 위치에 남도록 x/y를 함께 보정한다.
        const worldX = (px - prev.x) / prev.k;
        const worldY = (py - prev.y) / prev.k;
        return { k: nextK, x: px - worldX * nextK, y: py - worldY * nextK };
      });
    },
    []
  );

  const handleBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      dragRef.current = {
        kind: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTransform: transform,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [transform]
  );

  // --- 노드 드래그 -----------------------------------------------------------

  const beginNodeDrag = useCallback(
    (nodeId: string) => (e: ReactPointerEvent<SVGGElement>) => {
      if (readOnly || e.button !== 0) return;
      e.stopPropagation();
      const n = nodes[nodeId];
      if (!n) return;
      dragRef.current = {
        kind: "node",
        nodeId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorld: n.position,
        moved: false,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [nodes, readOnly]
  );

  // --- 엣지 생성 ---------------------------------------------------------
  // 노드 몸통을 드래그하면 이동이므로, 엣지는 노드 가장자리를 감싸는 별도의
  // 투명 "핸들 링"(HANDLE_RADIUS)에서 드래그를 시작해야 생성된다. 두 제스처가
  // 겹치지 않도록 물리적으로 다른 히트 영역을 쓰는 방식을 택했다.
  const beginEdgeDrag = useCallback(
    (nodeId: string) => (e: ReactPointerEvent<SVGCircleElement>) => {
      if (readOnly || e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = { kind: "edge", pointerId: e.pointerId, sourceNodeId: nodeId };
      setEdgeCursor(clientToWorld(e.clientX, e.clientY));
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [readOnly, clientToWorld]
  );

  const findNodeNear = useCallback(
    (world: CanvasPosition, excludeId?: string): string | null => {
      const hitR = HANDLE_RADIUS / transform.k;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const n of Object.values(nodes)) {
        if (n.id === excludeId) continue;
        const dx = n.position.x - world.x;
        const dy = n.position.y - world.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= hitR && dist < bestDist) {
          best = n.id;
          bestDist = dist;
        }
      }
      return best;
    },
    [nodes, transform.k]
  );

  // --- 공통 포인터 이동/해제 ------------------------------------------------

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        if (e.pointerId !== drag.pointerId) return;
        setTransform({
          x: drag.startTransform.x + (e.clientX - drag.startClientX),
          y: drag.startTransform.y + (e.clientY - drag.startClientY),
          k: drag.startTransform.k,
        });
      } else if (drag.kind === "node") {
        if (e.pointerId !== drag.pointerId) return;
        const dxScreen = e.clientX - drag.startClientX;
        const dyScreen = e.clientY - drag.startClientY;
        if (Math.hypot(dxScreen, dyScreen) > CLICK_THRESHOLD) drag.moved = true;
        const world = clientToWorld(e.clientX, e.clientY);
        setDragPosition({ nodeId: drag.nodeId, position: world });
      } else if (drag.kind === "edge") {
        if (e.pointerId !== drag.pointerId) return;
        setEdgeCursor(clientToWorld(e.clientX, e.clientY));
      }
    },
    [clientToWorld]
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;

      if (drag.kind === "node") {
        if (drag.moved) {
          const world = clientToWorld(e.clientX, e.clientY);
          onNodeDrag(drag.nodeId, world);
        } else {
          // 임계값 이내로만 움직였다 = 드래그가 아니라 클릭 -> 완료 토글.
          onNodeToggleComplete(drag.nodeId);
        }
        setDragPosition(null);
      } else if (drag.kind === "edge") {
        const world = clientToWorld(e.clientX, e.clientY);
        const targetId = findNodeNear(world, drag.sourceNodeId);
        if (targetId) onEdgeCreate(drag.sourceNodeId, targetId);
        setEdgeCursor(null);
      }
      // pan은 별도 처리 불필요 - transform이 이미 최신 상태.
    },
    [clientToWorld, findNodeNear, onEdgeCreate, onNodeDrag, onNodeToggleComplete]
  );

  const handleNodeKeyDown = useCallback(
    (nodeId: string) => (e: ReactKeyboardEvent<SVGGElement>) => {
      if (readOnly) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onNodeToggleComplete(nodeId);
      }
    },
    [readOnly, onNodeToggleComplete]
  );

  // --- 파생 데이터 ----------------------------------------------------------

  // 존재하지 않는 노드를 가리키는 엣지는 조용히 건너뛴다 (노드 삭제 직후
  // 엣지 정리가 아직 안 된 과도기 상태 - 백엔드 prune_orphan_edges와 동일한 방어 규칙).
  const validEdges = useMemo(
    () =>
      Object.values(edges).filter((edge) => nodes[edge.sourceNodeId] && nodes[edge.targetNodeId]),
    [edges, nodes]
  );

  const dragEdgeSource = dragRef.current?.kind === "edge" ? dragRef.current.sourceNodeId : null;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-ink-900 bg-radec-grid", className)}>
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        onWheel={handleWheel}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={(e) => {
          if (readOnly || !onExternalDrop) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          if (readOnly || !onExternalDrop) return;
          e.preventDefault();
          const data = e.dataTransfer.getData("application/json");
          if (!data) return;
          onExternalDrop(data, clientToWorld(e.clientX, e.clientY));
        }}
        style={{ cursor: readOnly ? "default" : "grab" }}
      >
        <defs>
          <filter id="const-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* 배경 격자는 SVG가 아니라 컨테이너의 .bg-radec-grid(적경/적위 좌표선,
            globals.css)로 깐다 - "차트 위에 찍는 중"이라는 인상만 아주 옅게. */}

        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {/* 엣지 */}
          {validEdges.map((edge) => {
            const source = nodes[edge.sourceNodeId];
            const target = nodes[edge.targetNodeId];
            if (!source || !target) return null;
            const sp = positionOf(edge.sourceNodeId);
            const tp = positionOf(edge.targetNodeId);
            // 인접 발광 규칙: 양 끝 노드가 모두 완료일 때만 "빛나는" 스타일.
            // backend/app/domain/constellation.py의 is_edge_lit과 동일한 규칙.
            const lit = source.isCompleted && target.isCompleted;
            return (
              <g key={edge.id}>
                <line
                  x1={sp.x}
                  y1={sp.y}
                  x2={tp.x}
                  y2={tp.y}
                  stroke={lit ? "var(--lit)" : "var(--rule)"}
                  strokeWidth={lit ? 2 : 1}
                  opacity={lit ? 1 : 0.8}
                  filter={lit ? "url(#const-glow)" : undefined}
                  style={lit ? { animation: "glowPulse 3.2s ease-in-out infinite" } : undefined}
                  onDoubleClick={
                    !readOnly && onEdgeDelete ? () => onEdgeDelete(edge.id) : undefined
                  }
                  className={!readOnly && onEdgeDelete ? "cursor-pointer" : undefined}
                />
              </g>
            );
          })}

          {/* 생성 중인 엣지 미리보기 */}
          {dragEdgeSource && edgeCursor && nodes[dragEdgeSource] && (
            <line
              x1={positionOf(dragEdgeSource).x}
              y1={positionOf(dragEdgeSource).y}
              x2={edgeCursor.x}
              y2={edgeCursor.y}
              stroke="var(--spec-b)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}

          {/* 노드 */}
          {Object.values(nodes).map((node) => {
            const pos = positionOf(node.id);
            const color = colorForType(node.type);
            const isHovered = hoveredNodeId === node.id;
            const isFocused = focusedNodeId === node.id;
            // level(1000~4000)을 겉보기 등급처럼 쓴다: 낮은 학년 과목일수록 더
            // 밝고 큰 별로 읽히게. level이 없으면 중간값(2000)으로 취급해
            // 항상 자연스럽게 보이도록 한다. 은은하게만 - magT는 0~1.
            const magT = Math.min(1, Math.max(0, ((node.level ?? 2000) - 1000) / 3000));
            const r = NODE_RADIUS - magT * 2.4;
            const magOpacity = node.isCompleted ? 1 : 1 - magT * 0.22;
            const { code, rest } = splitCourseCode(node.label);
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x} ${pos.y})`}
                tabIndex={readOnly ? -1 : 0}
                role="button"
                aria-label={node.label}
                aria-pressed={node.isCompleted}
                onKeyDown={handleNodeKeyDown(node.id)}
                onFocus={() => setFocusedNodeId(node.id)}
                onBlur={() => setFocusedNodeId((cur) => (cur === node.id ? null : cur))}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId((cur) => (cur === node.id ? null : cur))}
                onPointerDown={beginNodeDrag(node.id)}
                style={{ cursor: readOnly ? "default" : "pointer", outline: "none" }}
              >
                {/* 엣지 생성용 핸들 링 - 호버/포커스일 때만 보이는 넓은 히트 영역 */}
                {!readOnly && (
                  <circle
                    r={HANDLE_RADIUS}
                    fill="transparent"
                    stroke={isHovered || isFocused ? "var(--spec-b)" : "transparent"}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    onPointerDown={beginEdgeDrag(node.id)}
                  />
                )}

                {(isFocused || node.isCompleted) && (
                  <circle
                    r={r + 5}
                    fill="none"
                    stroke={node.isCompleted ? color : "var(--spec-b)"}
                    strokeWidth={isFocused ? 1.5 : 1}
                    opacity={node.isCompleted ? 0.35 : 0.7}
                  />
                )}

                <circle
                  r={r}
                  fill={node.isCompleted ? color : "var(--ink-900)"}
                  stroke={color}
                  strokeWidth={node.isCompleted ? 0 : 1.5}
                  opacity={magOpacity}
                  filter={node.isCompleted ? "url(#const-glow)" : undefined}
                />

                <text
                  x={0}
                  y={r + 16}
                  textAnchor="middle"
                  fontSize={11.5}
                  className="font-sans"
                  fill={node.isCompleted ? "var(--text-hi)" : "var(--text-lo)"}
                  style={{ paintOrder: "stroke", stroke: "var(--ink-900)", strokeWidth: 3, strokeOpacity: 0.75 }}
                >
                  {code && (
                    <tspan className="font-mono" fontSize={9.5} dx={0}>
                      {code}{" "}
                    </tspan>
                  )}
                  {rest}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {readOnly && (
        <div className="pointer-events-none absolute inset-0" aria-hidden />
      )}
    </div>
  );
}
