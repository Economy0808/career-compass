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
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import { SpaceBackdrop } from "@/components/SpaceBackdrop";

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
  /** 학정번호 등 식별 코드(현재는 수업만 채워짐). font-mono로 렌더링한다.
   * 과거에는 label에서 정규식으로 잘라냈지만(splitCourseCode), 그건 스키마
   * 공백을 메우던 임시방편이었다 - 이제 이 필드가 있으면 우선한다. */
  code?: string;
  /** 팝오버에 2~3줄로 클램프해 보여주는 설명. 수업은 요람 파싱, 그 외
   * 타입(학회/자격증/대외활동/네트워킹)은 나중에 LLM이 채운다. 없으면 그냥
   * 섹션 자체를 렌더링하지 않는다(빈 박스/플레이스홀더 금지). */
  description?: string;
  /** 이 노드에 달린 노트 개수. undefined면 아직 하나도 없다는 뜻으로
   * "노트 추가"를 보여준다(0개와는 다른 상태). */
  noteCount?: number;
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
  /** 노드 삭제(선택된 노드에서 Delete/Backspace 키). 이 노드를 참조하는 엣지
   * 정리는 상태를 들고 있는 부모(page.tsx)의 책임 - 캔버스는 nodes/edges를
   * 그대로 받아 그리기만 하므로 스스로 정리할 수 없다. */
  onNodeDelete?: (nodeId: string) => void;
  /** 팝오버의 "노트 N개 ›" 행 클릭. 노트 패널 자체는 다음 작업에서 만든다 -
   * 여기서는 훅만 열어 둔다. */
  onOpenNotes?: (nodeId: string) => void;
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
  /** 밖(노트 패널의 [[위키링크]] 클릭 등)에서 특정 노드를 선택시키는 요청.
   * selectedNodeId는 이 컴포넌트의 내부 state라 외부에서 직접 제어할 수
   * 없으므로, "이 노드를 선택하라"는 명령을 token으로 감싸 전달한다 - 같은
   * nodeId를 연속으로 다시 눌러도(토큰이 매번 바뀌므로) 매번 반응한다. */
  focusRequest?: { nodeId: string; token: number } | null;
  className?: string;
}

const NODE_RADIUS = 9;
const HANDLE_RADIUS = 22;
// 달성 노드의 십자 회절 스파이크 크기 - 반지름의 배수로 길이를 정해 큰
// 노드(magT 낮음)와 작은 노드(magT 높음) 모두에서 비례가 자연스럽게 맞는다.
const SPIKE_LENGTH_MULT = 3.5;
const SPIKE_WIDTH = 1.1;
// 호버 시 노드를 도는 위성(달) 궤도 파라미터. 실제 원 궤도(반지름 a)를 각도 i만큼
// 기울여 2D에 투영하면 장반경 a, 단반경 b=a·cos(i)인 타원이 된다(케플러 투영과
// 동일한 원리). φ는 화면상에서 그 타원 자체를 살짝 돌려, "위에서 내려다본 원"이
// 아니라 "비스듬히 본 기울어진 궤도"로 읽히게 한다.
const ORBIT_RADIUS = HANDLE_RADIUS; // a - 확대된 핸들 링 위를 대략 따라 돈다
// i·φ·주기는 더 이상 전역 상수가 아니라 노드마다 다르다 - orbitParamsFor 참고.
// 반지름 a만 핸들 링에 묶여 공통이고, 나머지 세 값은 노드 id로 결정된다.
const SATELLITE_RADIUS = 2.4;
/** 클릭과 드래그를 구분하는 임계값(px, 화면 좌표 기준). 이보다 적게 움직이면 클릭 = 선택(정보 카드 열기). */
const CLICK_THRESHOLD = 4;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;


/** djb2 문자열 해시 - [0,1) 실수로 정규화한다. Math.random 금지: 같은
 * 노드는 항상 같은 궤도를 그려야 한다(호버할 때마다 궤도가 바뀌면 "변주"가
 * 아니라 "글리치"로 읽힌다). suffix로 시드를 갈라 i·φ·주기 세 축이 서로
 * 독립적으로 흩어지게 한다 - 같은 h를 세 축에 그대로 쓰면 서로 상관돼서
 * 옆 노드끼리도 비슷한 모양으로 뭉쳐 보인다. */
function hashNodeId(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return (h >>> 0) / 4294967295;
}

interface OrbitParams {
  inclination: number; // i (라디안) - 50~75도
  screenTilt: number; // φ (라디안) - 0~180도, 타원은 대칭이라 한 바퀴 다 안 씀
  periodMs: number; // 3.5~5.5초 - 이웃 노드끼리 박자가 안 맞게(beat 방지)
}

function orbitParamsFor(nodeId: string): OrbitParams {
  const inclinationDeg = 50 + hashNodeId(`${nodeId}#i`) * (75 - 50);
  const screenTiltDeg = hashNodeId(`${nodeId}#phi`) * 180;
  const periodMs = 3500 + hashNodeId(`${nodeId}#period`) * (5500 - 3500);
  return {
    inclination: (inclinationDeg * Math.PI) / 180,
    screenTilt: (screenTiltDeg * Math.PI) / 180,
    periodMs,
  };
}

/**
 * 호버/포커스된 노드 주위를 도는 위성 - 파라메트릭 방정식으로 실제 위치를
 * 계산한다(CSS 스핀 애니메이션으로 흉내내지 않음). cx/cy/r/opacity를 매
 * 프레임 ref로 직접 DOM에 써서, React state를 프레임마다 갱신하지 않는다 -
 * 7,109개 과목이 실릴 카탈로그에서 호버마다 리렌더가 도는 건 감당이 안 된다.
 * 마운트는 부모가 (isHovered || isFocused)로 제어하므로, 호버가 끝나면 이
 * 컴포넌트가 언마운트되고 아래 useEffect의 cleanup이 rAF 루프를 반드시 끊는다
 * (노드마다 루프가 누적되는 걸 막는 지점).
 *
 * 궤도의 기울기(i)·화면 회전(φ)·주기는 nodeId에서 결정적으로 유도한다(위
 * orbitParamsFor) - 옆에 나란히 뜬 두 위성이 똑같은 모양으로 돌면 "복사-붙여넣기"
 * 처럼 보이므로, 반지름(a, 핸들 링 크기)만 공통으로 두고 나머지를 흩뜨린다.
 */
function OrbitingSatellite({ color, nodeId }: { color: string; nodeId: string }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const { inclination, screenTilt, periodMs } = useMemo(() => orbitParamsFor(nodeId), [nodeId]);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;

    const semiMinor = ORBIT_RADIUS * Math.cos(inclination); // b = a·cos(i)

    const paint = (t: number) => {
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      const x = ORBIT_RADIUS * cosT * Math.cos(screenTilt) - semiMinor * sinT * Math.sin(screenTilt);
      const y = ORBIT_RADIUS * cosT * Math.sin(screenTilt) + semiMinor * sinT * Math.cos(screenTilt);
      // sin(t)의 부호 = 궤도의 앞/뒤 반구. 뒤로 넘어간 순간엔 살짝 작고
      // 흐리게 그려 깊이를 값싸게 흉내낸다("행성" 뒤로 숨는 느낌).
      const isBehind = sinT < 0;
      el.setAttribute("cx", x.toFixed(2));
      el.setAttribute("cy", y.toFixed(2));
      el.setAttribute("r", (isBehind ? SATELLITE_RADIUS * 0.6 : SATELLITE_RADIUS).toFixed(2));
      el.setAttribute("opacity", isBehind ? "0.45" : "0.95");
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      // 모션 최소화 요청 시: 링은 그대로 커진 채 두되, 위성은 고정된 한 점에만
      // 세워두고 절대 움직이지 않는다.
      paint(0);
      return;
    }

    let frameId = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = ((now - start) / periodMs) * Math.PI * 2;
      paint(t);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [inclination, screenTilt, periodMs]);

  return <circle ref={circleRef} r={SATELLITE_RADIUS} fill={color} opacity={0.95} pointerEvents="none" aria-hidden="true" />;
}

/** 라벨 앞에 학정번호(예: "BIZ2101 경영정보시스템")가 붙어 있으면 분리한다.
 * 코드는 식별자이므로 font-mono로 작게, 나머지는 본문 폰트로 렌더링한다.
 * node.code가 있으면 이 함수는 아예 쓰이지 않는다 - 아직 code 필드가 없는
 * 과거 데이터를 위한 하위호환 fallback으로만 남겨둔다. */
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
  onOpenNotes,
  onExternalDrop,
  readOnly = false,
  focusRequest,
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
  // 선택된 노드 - 정보 카드(이름/코드/설명/노트)를 여는 트리거이자 Delete 키
  // 삭제의 대상. 클릭/Enter는 완료를 즉시 토글하지 않고 선택만 한다(아래
  // activateNode 참고) - 완료 토글은 이제 더블클릭 제스처다.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Delete 키 핸들러(window 리스너)가 최신 선택을 갱신 함수 없이 읽기 위한 미러.
  const selectedNodeIdRef = useRef<string | null>(null);
  selectedNodeIdRef.current = selectedNodeId;

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
      // 휠 줌은 배경에 임펄스를 주지 않는다(브리프상 선택 사항) - 줌은 스크롤할
      // 때마다 연타되는 제스처라, 편집 중 방해 금지 제약("너무 과하면 안돼")
      // 아래에서는 계속 자잘하게 흔들리는 배경이 오히려 거슬릴 위험이 더 크다고
      // 판단해 팬만 임펄스를 준다.
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

  // --- 선택 ------------------------------------------------------------------

  // 이미 이어진 쌍인지(방향 무관) 확인 - 핸들 링 드래그로 연결하는 중에 이미
  // 이어진 대상 위에 있으면(놓으면 끊어진다는) 힌트에 쓴다. 실제 토글 실행은
  // 부모(page.tsx)의 onEdgeCreate가 맡는다.
  const isLinked = useCallback(
    (a: string, b: string) =>
      Object.values(edges).some(
        (edge) =>
          (edge.sourceNodeId === a && edge.targetNodeId === b) ||
          (edge.sourceNodeId === b && edge.targetNodeId === a)
      ),
    [edges]
  );

  // 클릭(또는 Enter/Space)은 이제 오직 선택만 한다 - 완료 토글(더블클릭)과
  // 연결(핸들 링 드래그), 삭제(Delete 키)는 전부 다른 제스처로 분리됐다.
  const activateNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Esc는 어디에 포커스가 있든 선택/카드를 닫는다. Delete/Backspace는 "선택된
  // 노드가 있을 때만" 그 노드를 삭제한다 - 이 앱엔 undo가 없으므로, 입력
  // 필드(텍스트 편집 중)에서 눌렸다면 무시해서 실수로 지워지지 않게 막는다.
  // 확인 대화상자는 일부러 안 붙였다(요청받지 않음) - 대신 삭제 전제 조건을
  // "선택 상태"로 좁혀서 아무 데서나 손쉽게 눌리지 않게 한다.
  useEffect(() => {
    if (readOnly) return;
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedNodeId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !isTypingTarget(e.target)) {
        // 갱신 함수 안에서 부모 콜백(onNodeDelete)을 부르면 렌더 중 부모 상태
        // 갱신이 되어 StrictMode 경고가 난다(closeTab에서 잡았던 것과 동일한
        // 안티패턴). ref로 현재 선택을 읽어 갱신 함수 밖에서 호출한다.
        const cur = selectedNodeIdRef.current;
        if (!cur) return;
        setSelectedNodeId(null);
        if (onNodeDelete) onNodeDelete(cur);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, onNodeDelete]);

  // 외부 선택 요청(노트 패널의 [[위키링크]] 클릭) 처리 - token이 바뀔 때마다
  // 한 번 실행되어 selectedNodeId를 그 노드로 옮긴다. 존재하지 않는 nodeId는
  // 조용히 무시한다(방어적 - 위키링크 해석은 호출부에서 이미 검증하지만).
  useEffect(() => {
    if (!focusRequest) return;
    if (!nodes[focusRequest.nodeId]) return;
    setSelectedNodeId(focusRequest.nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.token]);

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
        // 비문증(eye-floater) 배경 훅: 이 프레임의 팬 델타(movementX/Y)만 window에
        // 쏜다. SpaceBackdrop을 직접 import하지 않는 이유는 그 파일이 디자인
        // 외주에서 통째로 스왑될 수 있는 지점이기 때문 - 캔버스는 그 내부를 몰라야
        // 한다(docs/design-handoff-guide.md). 절대 좌표가 아니라 델타만 넘기므로
        // 배경 쪽은 스프링 물리에 얹기만 하면 된다.
        window.dispatchEvent(
          new CustomEvent("ourlab:canvas-pan", { detail: { dx: e.movementX, dy: e.movementY } })
        );
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
          // 빈 캔버스 클릭 - 선택을 닫는다(토글 아님).
          setSelectedNodeId(null);
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
        // 선택인가 토글인가: 클릭과 동일한 의미(선택)로 통일한다. 완료 토글은
        // 이제 더블클릭 제스처로 옮겼으므로, 키보드에서도 Enter/Space는 선택만
        // 하고 달성 토글은 하지 않는다(일관성 유지).
        activateNode(nodeId);
      }
    },
    [readOnly, activateNode]
  );

  // 더블클릭 = 달성 토글. 단일 클릭(선택)과는 별개의 네이티브 dblclick
  // 이벤트로 처리하므로, 클릭-드래그 임계값(CLICK_THRESHOLD) 로직과 서로
  // 간섭하지 않는다 - 첫 클릭의 pointerup에서 이미 선택 처리가 끝난 뒤에
  // 브라우저가 두 번째 클릭까지 보고 나서야 이 이벤트를 한 번 더 얹어 준다.
  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => (e: ReactMouseEvent<Element>) => {
      if (readOnly) return;
      e.stopPropagation();
      onNodeToggleComplete(nodeId);
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
    <div
      className={cn("relative h-full w-full overflow-hidden", className)}
      // bg-ink-900 대신 CSS 변수를 직접 쓴다: 이 저장소의 dev 서버가 Windows에서
      // tailwind.config.ts 변경을 감지 못해(청소커/체크바 이슈로 보임) 캔버스
      // 바탕색이 유틸리티 클래스로는 재빌드 전까지 옛 값(#0B0E1A)에 고정돼
      // 버렸다. globals.css의 --ink-900은 즉시 반영되므로 그걸 직접 참조해
      // Tailwind JIT 캐시 신선도에 기대지 않게 한다. tailwind.config.ts의
      // ink.900도 값은 맞춰 뒀다(다른 페이지의 bg-ink-900 유틸리티용).
      style={{ backgroundColor: "var(--ink-900)" }}
    >
      {/* 배경 레이어 순서(뒤->앞): 컨테이너 바탕색(ink-900, 위 className) ->
          심우주 배경(성운/은하/블랙홀, SpaceBackdrop) -> 적경/적위 격자 -> svg(그래프).
          격자를 컨테이너 자체의 background-image로 두면 항상 자식보다 먼저
          그려지는 걸 이용했던 예전 방식은 SpaceBackdrop을 그 위에 자식으로
          끼워 넣는 순간 격자를 가려버린다 - 그래서 격자도 별도 레이어로 뺐다.
          둘 다 pan/zoom <g> 밖에 있으므로 뷰포트에 고정되고(팬해도 안 움직임),
          pointer-events: none이라 팬/드래그/엣지 연결을 절대 가로채지 않는다. */}
      <SpaceBackdrop />
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden="true" />
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
          {/* 달성 노드의 십자 회절 스파이크용 그라디언트 - stopColor를
              currentColor로 둬서 노드 색(spec-b 등)마다 그라디언트를 새로 만들
              필요 없이, 적용하는 <g>의 style.color 하나로 색을 바꿔 재사용한다.
              중심은 불투명, 양 끝(십자의 끝)은 투명해 "빛번짐"처럼 사그라든다. */}
          <linearGradient id="const-spike-h" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="const-spike-v" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
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
            const isDragEdgeSource = dragEdgeSource === node.id;
            // level(1000~4000)을 겉보기 등급처럼 쓴다: 낮은 학년 과목일수록 더
            // 밝고 큰 별로 읽히게. level이 없으면 중간값(2000)으로 취급해
            // 항상 자연스럽게 보이도록 한다. 은은하게만 - magT는 0~1.
            const magT = Math.min(1, Math.max(0, ((node.level ?? 2000) - 1000) / 3000));
            const r = NODE_RADIUS - magT * 2.4;
            // 색은 이제 완료 여부와 무관하게 처음부터 켜져 있다 - 캔버스를 보는
            // 즉시 "여기 어떤 유형의 원소가 있는지"가 읽혀야 하기 때문(색이
            // 완료의 보상이던 예전 설계는 미완료 캔버스가 거의 텅 비어 보였다).
            // 대신 "밝기"가 아니라 "빛번짐"으로 달성을 표현한다 - 미완료는 보통
            // 밝기의 분광형 별(글로우 없음), 완료는 더 밝아지고(opacity 1)
            // const-glow 발광 + 십자 회절 스파이크(아래 spikeLength)가 붙는다.
            const magOpacity = node.isCompleted ? 1 : 0.82 - magT * 0.08;
            const spikeLength = r * SPIKE_LENGTH_MULT;
            // node.code가 있으면 그걸 그대로 쓰고(라벨은 순수 이름), 없으면
            // 과거처럼 라벨에서 정규식으로 분리한다(하위호환 fallback).
            const fallbackSplit = node.code ? null : splitCourseCode(node.label);
            const code = node.code ?? fallbackSplit?.code ?? null;
            const rest = node.code ? node.label : fallbackSplit?.rest ?? node.label;
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
                onDoubleClick={!readOnly ? handleNodeDoubleClick(node.id) : undefined}
                style={{ cursor: readOnly ? "default" : "pointer", outline: "none" }}
              >
                {/* 엣지 생성용 핸들 링 - 항상 존재하는 히트 영역이지만, 평소에는
                    투명하다가 호버/포커스일 때 뚜렷한 실선 링 + 옅은 채움으로
                    "여기서 끌면 연결된다"는 걸 분명히 announce한다. 예전의
                    가는 점선(strokeOpacity 0.35)은 너무 희미해서 발견이 안 됐던
                    것 - "왜 줄 잇기가 안 되니" 피드백의 원인이었다. 커서도
                    crosshair로 바꿔 손잡이라는 걸 알린다. */}
                {!readOnly && (
                  <circle
                    r={HANDLE_RADIUS}
                    fill={isHovered || isFocused ? "var(--spec-b)" : "transparent"}
                    fillOpacity={isHovered || isFocused ? 0.12 : 0}
                    stroke={isHovered || isFocused ? "var(--spec-b)" : "transparent"}
                    strokeOpacity={isHovered || isFocused ? 0.9 : 0}
                    strokeWidth={2}
                    onPointerDown={beginEdgeDrag(node.id)}
                    style={{ cursor: "crosshair" }}
                  />
                )}

                {/* 호버/포커스된 노드에만 뜨는 궤도 위성 - 달처럼 기울어진 궤도를
                    돈다(파라메트릭 방정식, 아래 OrbitingSatellite 참고). 전체
                    노드가 아니라 이 노드에서만 마운트되므로 rAF 루프는 항상
                    최대 1개만 살아있다. */}
                {(isHovered || isFocused) && <OrbitingSatellite color={color} nodeId={node.id} />}

                {/* 핸들 링 드래그로 연결 중인 출발 노드 표시 - 점선 링. */}
                {isDragEdgeSource && (
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

                {/* 미완료 = 분광형 색으로 채워진 보통 밝기의 별(글로우 없음).
                    완료 = 더 밝아지고(opacity 1) + const-glow 발광 + 아래
                    십자 회절 스파이크까지 붙는다 - "승급"이 밝기 하나가 아니라
                    빛번짐이라는 눈에 띄는 사건으로 읽히게 하는 게 새 디자인의
                    핵심이다. */}
                {/* (과거 버그 메모) 예전엔 미완료 노드가 fill="transparent"였는데,
                    SVG가 fill="none" 영역을 클릭 판정에서 빼버리는 함정 때문에
                    "군집에서 끌어온 요소는 연결이 안 된다"는 버그가 난 적이 있다.
                    지금은 미완료도 항상 분광형 색으로 채워지므로 이 함정 자체가
                    구조적으로 사라졌다 - 그래도 새 원소 타입을 추가할 때 절대
                    fill="none"을 쓰지 말 것(DEFAULT_TYPE_COLOR로 안전 강등되는
                    색도 실제 색이지 none이 아니다). */}
                {/* onDoubleClick은 여기가 아니라 위 <g>에 달려 있다 - 몸통(r≈8)만
                    노렸던 예전 방식은 핸들 링(r=22, 위성 작업으로 확대됨)이 대부분의
                    면적을 덮어버려 살짝만 빗나가도 더블클릭이 엣지 드래그로 새는
                    버그였다. <g>에 달면 몸통이든 링이든 어디를 더블클릭해도(네이티브
                    dblclick 이벤트는 버블링된다) 판정 영역이 r=22 전체로 넓어진다. */}
                {node.isCompleted && (
                  // 십자 회절 스파이크 - 노드 색(currentColor로 상속)의 얇은
                  // 빛줄기 4방향. const-glow로 살짝 더 번지게 하고, 노드마다
                  // 위상/주기를 hashNodeId로 흩어 "다 같이 깜빡"을 피한다.
                  <g
                    aria-hidden="true"
                    pointerEvents="none"
                    filter="url(#const-glow)"
                    style={{
                      color,
                      animation: `spikeBreathe ${(3.2 + hashNodeId(`${node.id}#spikeDur`) * 1.6).toFixed(2)}s ease-in-out ${(hashNodeId(`${node.id}#spikeDelay`) * 3).toFixed(2)}s infinite`,
                    }}
                  >
                    <rect
                      x={-spikeLength}
                      y={-SPIKE_WIDTH / 2}
                      width={spikeLength * 2}
                      height={SPIKE_WIDTH}
                      fill="url(#const-spike-h)"
                    />
                    <rect
                      x={-SPIKE_WIDTH / 2}
                      y={-spikeLength}
                      width={SPIKE_WIDTH}
                      height={spikeLength * 2}
                      fill="url(#const-spike-v)"
                    />
                  </g>
                )}
                <circle
                  r={r}
                  fill={color}
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

      {/* 연결 드래그 배너 - 핸들 링에서 드래그를 시작한 동안만 뜬다. */}
      {!readOnly && dragEdgeSource && (
        <div
          className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full border border-rule bg-ink-800/90 px-4 py-1.5 font-sans text-xs text-text-hi shadow-lg"
          role="status"
        >
          {hoveredNodeId && hoveredNodeId !== dragEdgeSource && isLinked(dragEdgeSource, hoveredNodeId)
            ? "이미 이어져 있음 · 다시 누르면 끊어집니다"
            : "연결하는 중 · 대상 노드에서 놓으세요"}
        </div>
      )}

      {/* 노드 선택 정보 카드 - 이름/코드/설명 + 노트. 달성/연결/삭제는 이제
          제스처(더블클릭/핸들 링 드래그/Delete 키)로 옮겨서 버튼이 없다.
          transform(팬/줌)이 바뀔 때마다 다시 계산되므로 캔버스를 움직여도
          선택된 노드를 계속 따라간다. */}
      {!readOnly && selectedNodeId && nodes[selectedNodeId] && (
        <ElementPopover
          node={nodes[selectedNodeId]}
          transform={transform}
          containerRef={svgRef}
          onOpenNotes={onOpenNotes ? () => onOpenNotes(selectedNodeId) : undefined}
          onDismiss={() => setSelectedNodeId(null)}
        />
      )}

      {readOnly && (
        <div className="pointer-events-none absolute inset-0" aria-hidden />
      )}
    </div>
  );
}

const POPOVER_WIDTH = 256;
// 실제 높이는 콘텐츠(설명 유무, 노트 유무)에 따라 달라지므로 useLayoutEffect로
// 측정한다. 이 값은 측정 전 첫 프레임에만 쓰는 대략치 - 측정 후엔 실제 높이로
// 다시 계산되므로 화면 깜빡임 없이 자리를 잡는다.
const POPOVER_ESTIMATED_HEIGHT = 160;
const POPOVER_MARGIN = 8;
const POPOVER_GAP = 12; // 노드 가장자리와 팝오버 사이 여백

interface ElementPopoverProps {
  node: CanvasNode;
  transform: Transform;
  containerRef: RefObject<SVGSVGElement>;
  onOpenNotes?: () => void;
  onDismiss: () => void;
}

/**
 * 선택된 노드의 아래오른쪽에 뜨는 작은 원소 정보 카드.
 *
 * 달성/연결/삭제는 이제 버튼이 아니라 제스처다(더블클릭 / 핸들 링 드래그 /
 * Delete 키 - ConstellationCanvas 본문 참고). 그래서 이 카드에는 액션 버튼이
 * 하나도 없고 이름·코드·설명·노트 링크만 있는 순수 정보 표면이다.
 * role="toolbar"(버튼 묶음 전용, APG 기준)는 더 이상 맞지 않아 떼어냈고,
 * 대신 aria-label이 붙은 role="dialog"(비모달 - Esc로 닫히는 플로팅 정보
 * 패널)를 골랐다. 표 형태 목록도 아니고 액션 묶음도 아닌, 이름 붙은 보조
 * 패널이라는 뜻에서 "region"보다 "dialog"가 더 정확하다고 판단했다.
 *
 * 위치는 노드의 world 좌표에 현재 pan/zoom transform을 적용해 화면 좌표로
 * 바꾼 뒤, 컨테이너 경계 안으로 clamp한다 - transform이 리렌더마다 최신값을
 * props로 받으므로 팬/줌을 해도 매 프레임 다시 계산되어 노드를 계속 따라간다.
 * 기본은 노드 아래오른쪽에 뜨고, 오른쪽/아래쪽 여백이 부족하면 각 축을 독립적으로
 * 뒤집는다(즉 4개 코너 중 들어맞는 곳으로).
 */
function ElementPopover({
  node,
  transform,
  containerRef,
  onOpenNotes,
  onDismiss,
}: ElementPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    setMeasuredHeight(popoverRef.current?.offsetHeight ?? null);
  }, [node.id, node.description, node.code, node.noteCount, node.isCompleted]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  const rect = containerRef.current?.getBoundingClientRect();
  const containerWidth = rect?.width ?? 9999;
  const containerHeight = rect?.height ?? 9999;
  const height = measuredHeight ?? POPOVER_ESTIMATED_HEIGHT;

  const screenX = transform.x + node.position.x * transform.k;
  const screenY = transform.y + node.position.y * transform.k;

  // 기본은 아래오른쪽. 오른쪽에 다 안 들어가면 왼쪽으로, 아래에 다 안 들어가면
  // 위로 - 두 축을 독립적으로 뒤집어 4개 코너 중 맞는 곳을 고른다.
  const fitsRight = screenX + POPOVER_GAP + POPOVER_WIDTH <= containerWidth - POPOVER_MARGIN;
  const left = fitsRight
    ? screenX + POPOVER_GAP
    : Math.max(POPOVER_MARGIN, screenX - POPOVER_GAP - POPOVER_WIDTH);
  const clampedLeft = Math.min(left, Math.max(POPOVER_MARGIN, containerWidth - POPOVER_MARGIN - POPOVER_WIDTH));

  const fitsBelow = screenY + POPOVER_GAP + height <= containerHeight - POPOVER_MARGIN;
  const top = fitsBelow
    ? screenY + POPOVER_GAP
    : Math.max(POPOVER_MARGIN, screenY - POPOVER_GAP - height);
  const clampedTop = Math.min(top, Math.max(POPOVER_MARGIN, containerHeight - POPOVER_MARGIN - height));

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${node.label} 정보`}
      className="absolute z-10 flex flex-col rounded-lg border border-rule bg-ink-800 shadow-lg"
      style={{ left: clampedLeft, top: clampedTop, width: POPOVER_WIDTH }}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <span className="min-w-0 truncate font-sans text-sm font-medium text-text-hi">{node.label}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {node.code && (
            <span className="font-mono text-[11px] leading-none text-text-lo">{node.code}</span>
          )}
          <button
            type="button"
            aria-label="닫기"
            className="rounded px-1 py-0.5 text-xs text-text-lo hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            onClick={onDismiss}
          >
            {"✕"}
          </button>
        </div>
      </div>

      {/* 설명 - 2~3줄로 클램프. 없으면 섹션째로 생략(빈 박스/플레이스홀더 금지). */}
      {node.description && (
        <p
          className="px-3 pb-1 pt-1 font-sans text-xs leading-relaxed text-text-lo"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {node.description}
        </p>
      )}

      <button
        type="button"
        className="mt-1 flex items-center justify-between rounded-b-lg border-t border-rule px-3 py-1.5 font-sans text-xs text-text-lo hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-spec-b"
        onClick={onOpenNotes}
      >
        <span>{node.noteCount !== undefined ? `노트 ${node.noteCount}개` : "노트 추가"}</span>
        <span aria-hidden>{"›"}</span>
      </button>
    </div>
  );
}
