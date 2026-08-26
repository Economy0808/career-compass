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
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
  /** 노드 삭제(툴바 "삭제" 버튼). 이 노드를 참조하는 엣지 정리는 상태를 들고
   * 있는 부모(page.tsx)의 책임 - 캔버스는 nodes/edges를 그대로 받아 그리기만
   * 하므로 스스로 정리할 수 없다. */
  onNodeDelete?: (nodeId: string) => void;
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
  onNodeDelete,
  onExternalDrop,
  readOnly = false,
  className,
}: ConstellationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(null);
  const didAutoCenterRef = useRef(false);

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  // 드래그 중인 노드 하나만 낙관적으로 덮어쓴다. 부모의 영속화는 디바운스될 수
  // 있으므로, 실제 props가 따라올 때까지 로컬 좌표를 계속 신뢰한다.
  const [dragPosition, setDragPosition] = useState<{ nodeId: string; position: CanvasPosition } | null>(null);
  const [edgeCursor, setEdgeCursor] = useState<CanvasPosition | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  // 선택된 노드 - 툴바(달성/잇기/삭제)를 여는 트리거. 클릭/Enter는 이제 완료를
  // 즉시 토글하지 않고 선택만 한다(아래 activateNode 참고).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // "잇기" 모드의 출발 노드. 설정돼 있으면 다음 노드 클릭이 연결 대상이 된다.
  const [connectSource, setConnectSource] = useState<string | null>(null);

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

  // --- 최초 자동 중앙 정렬 ----------------------------------------------------
  // transform의 초기값은 {x:0, y:0, k:1}이고 SVG에는 viewBox가 없으므로,
  // world 좌표 (0,0)은 항상 SVG 자신의 좌상단 픽셀에 고정된다. 시드 노드처럼
  // 좌표가 음수를 포함하면 그래프 전체가 뷰포트 밖(왼쪽/위)으로 나가 버린다 -
  // "엣지가 노드에서 어긋나 보인다"고 오인되기 쉽지만 실제로는 엣지·노드가
  // 똑같이 잘못된 위치에 같이 그려지는 것뿐이다. 마운트 후 컨테이너 크기를
  // 알 수 있게 되면 노드들의 바운딩 박스를 뷰포트 중앙에 오도록 딱 한 번만
  // 보정한다 - 이후 사용자의 팬/줌은 절대 덮어쓰지 않는다.
  useEffect(() => {
    if (didAutoCenterRef.current) return;
    const svg = svgRef.current;
    if (!svg) return;
    const nodeList = Object.values(nodes);
    if (nodeList.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xs = nodeList.map((n) => n.position.x);
    const ys = nodeList.map((n) => n.position.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    didAutoCenterRef.current = true;
    setTransform({ x: rect.width / 2 - cx, y: rect.height / 2 - cy, k: 1 });
  }, [nodes]);

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

  // --- 선택 / 잇기 모드 ------------------------------------------------------

  // 이미 이어진 쌍인지(방향 무관) 확인 - "잇기" 토글(다시 이으면 끊김) 힌트와
  // 배너 문구에 쓴다. 실제 토글 실행은 부모(page.tsx)의 onEdgeCreate가 맡는다.
  const isLinked = useCallback(
    (a: string, b: string) =>
      Object.values(edges).some(
        (edge) =>
          (edge.sourceNodeId === a && edge.targetNodeId === b) ||
          (edge.sourceNodeId === b && edge.targetNodeId === a)
      ),
    [edges]
  );

  // 클릭(또는 Enter/Space)의 공통 처리. "잇기" 모드 중이면 이 노드가 연결
  // 대상이 되고, 아니면 이 노드를 선택해 툴바를 연다. 클릭이 완료 토글을
  // 곧바로 실행하던 이전 동작은 제거했다 - 그게 우연히 눌리는 사고의 원인이었다.
  const activateNode = useCallback(
    (nodeId: string) => {
      if (connectSource) {
        if (nodeId !== connectSource) onEdgeCreate(connectSource, nodeId);
        setConnectSource(null);
        setSelectedNodeId(null);
      } else {
        setSelectedNodeId(nodeId);
      }
    },
    [connectSource, onEdgeCreate]
  );

  // Esc는 어디에 포커스가 있든(툴바 버튼 포함) 잇기 모드와 선택/툴바를 닫는다.
  useEffect(() => {
    if (readOnly) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConnectSource(null);
        setSelectedNodeId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly]);

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
          // 임계값 이내로만 움직였다 = 드래그가 아니라 클릭 -> 선택(또는 잇기 대상 지정).
          activateNode(drag.nodeId);
        }
        setDragPosition(null);
      } else if (drag.kind === "edge") {
        const world = clientToWorld(e.clientX, e.clientY);
        const targetId = findNodeNear(world, drag.sourceNodeId);
        if (targetId) onEdgeCreate(drag.sourceNodeId, targetId);
        setEdgeCursor(null);
      } else if (drag.kind === "pan") {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.hypot(dx, dy) <= CLICK_THRESHOLD) {
          // 빈 캔버스 클릭 - 선택/잇기 모드를 닫는다(토글 아님).
          setSelectedNodeId(null);
          setConnectSource(null);
        }
      }
      // pan의 transform 자체는 별도 처리 불필요 - 이미 최신 상태.
    },
    [activateNode, clientToWorld, findNodeNear, onEdgeCreate, onNodeDrag]
  );

  const handleNodeKeyDown = useCallback(
    (nodeId: string) => (e: ReactKeyboardEvent<SVGGElement>) => {
      if (readOnly) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        // 선택인가 토글인가: 클릭과 동일한 의미(선택)로 통일한다. 키보드
        // 사용자도 툴바를 거쳐 달성/잇기/삭제에 동등하게 접근해야 하므로,
        // 여기서만 즉시 토글해 버리면 클릭과 다른 동작이 되어 일관성이 깨진다.
        activateNode(nodeId);
      }
    },
    [readOnly, activateNode]
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
                  style={lit ? { animation: "edgeGlowPulse 3.2s ease-in-out infinite" } : undefined}
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
            const isSelected = selectedNodeId === node.id;
            const isConnectSource = connectSource === node.id;
            // level(1000~4000)을 겉보기 등급처럼 쓴다: 낮은 학년 과목일수록 더
            // 밝고 큰 별로 읽히게. level이 없으면 중간값(2000)으로 취급해
            // 항상 자연스럽게 보이도록 한다. 은은하게만 - magT는 0~1.
            const magT = Math.min(1, Math.max(0, ((node.level ?? 2000) - 1000) / 3000));
            const r = NODE_RADIUS - magT * 2.4;
            // 완료 여부를 "밝기"로 읽히게 한다 - 미완료는 속이 빈 어두운 점(희미한
            // 별), 완료는 분광형 색으로 꽉 찬 밝은 별(+발광). 대비를 세게 줬다:
            // 미완료는 불투명도도 낮춰 눈에 잘 안 띄게, 완료는 항상 100%.
            const magOpacity = node.isCompleted ? 1 : 0.55 - magT * 0.18;
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

                {/* "잇기" 모드의 출발 노드 표시 - 점선 링. */}
                {isConnectSource && (
                  <circle r={r + 8} fill="none" stroke="var(--spec-b)" strokeWidth={1.5} strokeDasharray="3 3" />
                )}

                {(isFocused || isSelected || node.isCompleted) && (
                  <circle
                    r={r + 5}
                    fill="none"
                    stroke={node.isCompleted ? color : "var(--spec-b)"}
                    strokeWidth={isFocused || isSelected ? 1.5 : 1}
                    opacity={node.isCompleted ? 0.35 : 0.7}
                  />
                )}

                {/* 완료 = 밝은 별(분광형 색 채움 + 발광), 미완료 = 속이 빈 희미한 점.
                    타입 색은 미완료일 때 더 이상 쓰지 않는다 - "밝기"만으로 완료
                    여부가 읽혀야 하고, 색은 완료된 뒤에야 드러나는 보상이어야 한다. */}
                <circle
                  r={r}
                  fill={node.isCompleted ? color : "none"}
                  stroke={node.isCompleted ? "none" : "var(--rule)"}
                  strokeWidth={node.isCompleted ? 0 : 1}
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
                  opacity={node.isCompleted ? 1 : 0.6}
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

      {/* 빈 캔버스 안내 - 노드가 하나라도 생기면 즉시 사라진다. */}
      {!readOnly && Object.keys(nodes).length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
          <p className="max-w-xs text-center font-sans text-sm leading-relaxed text-text-lo">
            보관함에서 원소를 끌어와 캔버스에 놓거나,
            <br />
            칩을 포커스한 뒤 Enter를 누르면 여기에 놓입니다.
          </p>
        </div>
      )}

      {/* 잇기 모드 배너 */}
      {!readOnly && connectSource && (
        <div
          className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-rule bg-ink-800/90 px-4 py-1.5 font-sans text-xs text-text-hi shadow-lg"
          role="status"
        >
          {hoveredNodeId && hoveredNodeId !== connectSource && isLinked(connectSource, hoveredNodeId)
            ? "이미 이어져 있음 · 다시 누르면 끊어집니다"
            : "잇는 중 · 대상 노드를 클릭하세요 (Esc로 취소)"}
        </div>
      )}

      {/* 노드 선택 툴바 - 달성/잇기/삭제. transform(팬/줌)이 바뀔 때마다 다시
          계산되므로 캔버스를 움직여도 선택된 노드를 계속 따라간다. */}
      {!readOnly && !connectSource && selectedNodeId && nodes[selectedNodeId] && (
        <NodeToolbar
          node={nodes[selectedNodeId]}
          transform={transform}
          containerRef={svgRef}
          onToggleComplete={() => onNodeToggleComplete(selectedNodeId)}
          onStartConnect={() => setConnectSource(selectedNodeId)}
          onDelete={
            onNodeDelete
              ? () => {
                  onNodeDelete(selectedNodeId);
                  setSelectedNodeId(null);
                }
              : undefined
          }
          onDismiss={() => setSelectedNodeId(null)}
        />
      )}

      {readOnly && (
        <div className="pointer-events-none absolute inset-0" aria-hidden />
      )}
    </div>
  );
}

const TOOLBAR_WIDTH = 176;
const TOOLBAR_HEIGHT = 40;
const TOOLBAR_MARGIN = 8;
const TOOLBAR_GAP = 14; // 노드 가장자리와 툴바 사이 여백

interface NodeToolbarProps {
  node: CanvasNode;
  transform: Transform;
  containerRef: RefObject<SVGSVGElement>;
  onToggleComplete: () => void;
  onStartConnect: () => void;
  onDelete?: () => void;
  onDismiss: () => void;
}

/**
 * 선택된 노드 옆에 뜨는 작은 플로팅 툴바(달성/잇기/삭제).
 *
 * 위치는 노드의 world 좌표에 현재 pan/zoom transform을 적용해 화면 좌표로
 * 바꾼 뒤, 컨테이너 경계 안으로 clamp한다 - transform이 리렌더마다 최신값을
 * props로 받으므로 팬/줌을 해도 매 프레임 다시 계산되어 노드를 계속 따라간다.
 * 기본은 노드 위쪽에 뜨고, 위쪽 여백이 부족하면 아래로 뒤집는다.
 */
function NodeToolbar({
  node,
  transform,
  containerRef,
  onToggleComplete,
  onStartConnect,
  onDelete,
  onDismiss,
}: NodeToolbarProps) {
  const rect = containerRef.current?.getBoundingClientRect();
  const width = rect?.width ?? 9999;
  const height = rect?.height ?? 9999;

  const screenX = transform.x + node.position.x * transform.k;
  const screenY = transform.y + node.position.y * transform.k;

  const preferAbove = screenY - TOOLBAR_GAP - TOOLBAR_HEIGHT >= TOOLBAR_MARGIN;
  const top = preferAbove
    ? screenY - TOOLBAR_GAP - TOOLBAR_HEIGHT
    : Math.min(screenY + TOOLBAR_GAP + 24, height - TOOLBAR_MARGIN - TOOLBAR_HEIGHT);
  const left = Math.min(
    Math.max(TOOLBAR_MARGIN, screenX - TOOLBAR_WIDTH / 2),
    Math.max(TOOLBAR_MARGIN, width - TOOLBAR_MARGIN - TOOLBAR_WIDTH)
  );

  const btnClass =
    "rounded px-2 py-1 text-xs font-sans text-text-hi hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b";

  return (
    <div
      role="toolbar"
      aria-label={`${node.label} 작업`}
      className="absolute z-10 flex items-center gap-1 rounded-lg border border-rule bg-ink-800 p-1 shadow-lg"
      style={{ left, top, width: TOOLBAR_WIDTH, minHeight: TOOLBAR_HEIGHT }}
    >
      <button
        type="button"
        className={btnClass}
        aria-pressed={node.isCompleted}
        onClick={onToggleComplete}
      >
        {node.isCompleted ? "✓ 달성 취소" : "✓ 달성"}
      </button>
      <button type="button" className={btnClass} onClick={onStartConnect}>
        {"⧸ 잇기"}
      </button>
      {onDelete && (
        <button type="button" className={btnClass} onClick={onDelete}>
          {"🗑 삭제"}
        </button>
      )}
      <button
        type="button"
        aria-label="닫기"
        className={cn(btnClass, "ml-auto px-1.5 text-text-lo")}
        onClick={onDismiss}
      >
        {"✕"}
      </button>
    </div>
  );
}
