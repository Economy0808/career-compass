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
} from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import { SpaceBackdrop } from "@/components/SpaceBackdrop";
// 성단(접힌 그룹) 성운 비주얼(안개+입자) - DraftReviewStage의 시안 렌더와
// 이 캔버스가 같은 시각 문법을 쓰도록 시드/입자 생성을 그 파일에서 export해
// 공유한다(복붙 금지 - 프로젝트 관례상 이미 binClusterCenter 등도 이렇게
// 파일 간 공유한다). 역방향 import는 없다(DraftReviewStage는 이 파일의
// CanvasPosition 타입만 가져간다) - 순환 없음.
import { buildNebulaParticles, hashSeed } from "@/components/DraftReviewStage";

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
  /** 사용자 커스텀 색(#RRGGBB, 서버 NodeDto.color). 있으면 유형색보다
   * 우선한다 - 몸통/링/스파이크가 전부 아래 렌더의 단일 color 변수를
   * 소비하므로 폴백은 그 한 곳에서만 처리한다. */
  color?: string;
  /** 이 노드에 달린 노트 개수. undefined면 아직 하나도 없다는 뜻으로
   * "노트 추가"를 보여준다(0개와는 다른 상태). */
  noteCount?: number;
  /** 달성 연출 프리셋 id(서버 NodeDto.glowEffect). GLOW_PRESETS 참고 -
   * 미지정/미지원 id는 기본(spike)으로 강등된다. */
  glowEffect?: string;
}

/** 백엔드 Edge 모델과 1:1로 대응. */
export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 사용자 커스텀 선 색(#RRGGBB, 서버 EdgeDto.color). 미점등/점등 기본색을
   * 모두 이 색으로 대체한다(미지정이면 rule/lit 기본). */
  color?: string;
}

/** 백엔드 Group 모델과 1:1로 대응 - 요소가 많아진 노드들을 하나로 묶는 성단.
 * collapsed=true면 멤버 노드/내부 간선을 숨기고 이 그룹 자리에 성단 하나만
 * 그린다(아래 렌더 로직 참고). position은 접힘/펼침과 무관하게 항상 이
 * 그룹만의 고정 앵커 - 멤버 노드 위치는 절대 바뀌지 않는다. */
export interface CanvasGroup {
  id: string;
  label: string;
  memberNodeIds: string[];
  collapsed: boolean;
  position: CanvasPosition;
}

/** 달성 연출 프리셋 - 팔레트(ColorPaletteBar)와 렌더가 공유하는 단일 목록.
 * 서버는 id 문자열만 저장하고 시각 정의는 전부 여기 있다. */
export const GLOW_PRESETS: { id: string; name: string }[] = [
  { id: "spike", name: "회절 스파이크" },
  { id: "halo", name: "후광" },
  { id: "ring", name: "회절 고리" },
  { id: "beam", name: "빛기둥" },
  { id: "quiet", name: "고요" },
];

export interface ConstellationCanvasProps {
  /** id를 key로 하는 맵. Firestore 점 표기 부분 업데이트와 형태를 맞춘 것이므로 배열로 바꾸지 않는다. */
  nodes: Record<string, CanvasNode>;
  edges: Record<string, CanvasEdge>;
  /** id를 key로 하는 맵(nodes/edges와 동일 관례). 생략하면 성단 없이 기존과
   * 동일하게 그린다. */
  groups?: Record<string, CanvasGroup>;
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
  /** 선택 활성화 지점(activateNode)마다 호출되는 훅 - 부모가 이 노드에 대해
   * 색 팔레트 등 추가 UI를 열 수 있게 한다. 캔버스는 "선택됐다"는 사실만
   * 알리고, 그 선택을 무엇에 쓸지는 부모(page.tsx)의 책임이다. */
  onNodeActivate?: (nodeId: string) => void;
  /** 엣지 단일 클릭 훅 - 편집 모드에서 부모가 넘겨주면 선(엣지)도 클릭해
   * 색 팔레트를 열 수 있다(더블클릭 삭제와는 별개 제스처). */
  onEdgeActivate?: (edgeId: string) => void;
  /** true면 선택 시 뜨는 기본 정보 팝오버(ElementPopover)를 렌더링하지 않는다 -
   * 편집 모드에서 팝오버 대신 색 팔레트 바를 보여줄 때 쓴다. 캔버스 내부
   * selectedNodeId 상태 자체는 그대로 유지된다(팝오버만 숨김). */
  suppressInfoCard?: boolean;
  /** 밖(노트 패널의 [[위키링크]] 클릭 등)에서 특정 노드를 선택시키는 요청.
   * selectedNodeId는 이 컴포넌트의 내부 state라 외부에서 직접 제어할 수
   * 없으므로, "이 노드를 선택하라"는 명령을 token으로 감싸 전달한다 - 같은
   * nodeId를 연속으로 다시 눌러도(토큰이 매번 바뀌므로) 매번 반응한다. */
  focusRequest?: { nodeId: string; token: number } | null;
  /** 밖(시안 확정 등)에서 "지금 그래프 전체가 뷰포트에 들어오도록 다시
   * 맞춰라"는 요청. focusRequest와 같은 token 문법 - 값 자체가 아니라 매번
   * 바뀌는 숫자로 "지금 한 번 더 요청됨"을 알린다(같은 그래프에 다시 요청해도
   * 반응해야 하므로 boolean이 아니라 카운터). */
  fitRequest?: number | null;
  className?: string;
  /** 성단 드래그(위치 이동) - 노드 드래그와 동일한 낙관적 패턴. */
  onGroupDrag?: (groupId: string, position: CanvasPosition) => void;
  /** 성단 클릭(펼치기) / 접기 칩 클릭(접기). */
  onGroupToggleCollapse?: (groupId: string, collapsed: boolean) => void;
  /** 성단 이름 바꾸기 - readOnly에서는 렌더되지 않는 편집 UI 전용. */
  onGroupLabelChange?: (groupId: string, label: string) => void;
  /** 그룹 해제("성단만 삭제, 멤버는 남음") - readOnly에서는 렌더되지 않는다. */
  onGroupUngroup?: (groupId: string) => void;
  /** 성단 다이브인이 완료된 시점(카메라 줌 종료 직후) 1회 호출 - 부모가 그
   * 성단 멤버에 온디맨드로 선수관계를 조회해 채워 넣을 수 있는 훅. 이
   * 캔버스는 선수관계의 의미를 모른다 - "지금 이 성단 속으로 들어왔다"는
   * 사실만 알린다(onGroupToggleCollapse와 같은 역할 분리). */
  onDiveInGroup?: (groupId: string) => void;
}

// 성단(집합 노드)의 시각 반지름 - 멤버 수가 늘어도 log 스케일로만 커지고
// CLUSTER_MAX_RADIUS를 넘지 않는다("은은하게 크게" - 사용자 지시).
const CLUSTER_BASE_RADIUS = 16;
const CLUSTER_RADIUS_SCALE = 5;
const CLUSTER_MAX_RADIUS = 34;

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
// fit-to-content 여백 - 좌측 레일(196px)과 우측 「군집/노트」 패널(md에서
// w-72=288px)이 캔버스 위에 얹히는 오버레이라(SVG 자체 폭은 안 줄어듦) 그냥
// 컨테이너 여백만큼만 맞추면 노드가 패널 밑에 깔린다. 좌우를 더 넉넉히 안쪽으로
// 당겨 시안 확정 직후 패널과 겹치지 않게 한다.
// 섬 크롬 전환 후 좌측 풀높이 레일은 없다 - 좌측은 기본 여백만, 우측은
// 군집 섬(md: w-72+right-4+간격 ≈ 320px)을 통째로 피해서, fit의 "중앙"이
// 화면 중앙이 아니라 **섬을 뺀 하늘 여백의 중앙**이 되게 한다(사용자 지시).
// <md에서는 패널이 하단 시트라 좌우 비대칭이 없다.
const FIT_PADDING_X = 72;
const FIT_RIGHT_PANEL_W = 320;
const FIT_PADDING_Y = 72;
// 자동 맞춤 줌은 아무리 노드가 넓게 퍼져도 이 값을 넘지 않는다("과하게 당기지
// 말 것" - 사용자 지시). 좁게 뭉친 노드 몇 개를 화면 가득 확대하는 것도
// 부자연스럽다.
const FIT_MAX_ZOOM = 1;


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

/** 노드 목록의 바운딩 박스가 rect(뷰포트) 안에 여백을 두고 들어오도록 하는
 * transform을 계산한다. 최초 부트 자동 중앙 정렬과 밖에서 오는 fitRequest가
 * 이 함수 하나를 공유한다 - 두 곳 다 "지금 그래프 전체를 보여줘라"는 같은
 * 요청이기 때문. k는 [MIN_ZOOM, FIT_MAX_ZOOM] 사이로 클램프한다(과하게 당기지
 * 않음 + 너무 멀어지지도 않음). */
function computeFitTransform(
  nodeList: CanvasNode[],
  rect: { width: number; height: number },
  maxZoom: number = FIT_MAX_ZOOM
): Transform {
  const xs = nodeList.map((n) => n.position.x);
  const ys = nodeList.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  // md 이상에서만 우측 군집 섬 폭을 빼고 남은 하늘의 정중앙에 맞춘다.
  const rightPad = rect.width >= 768 ? FIT_PADDING_X + FIT_RIGHT_PANEL_W : FIT_PADDING_X;
  const availW = Math.max(1, rect.width - FIT_PADDING_X - rightPad);
  const availH = Math.max(1, rect.height - FIT_PADDING_Y * 2);
  const k = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.min(availW / bboxW, availH / bboxH)));
  return { x: FIT_PADDING_X + availW / 2 - cx * k, y: rect.height / 2 - cy * k, k };
}

// 다이브인 전용 줌 상한 - 기본 FIT_MAX_ZOOM(1)은 "전체를 과하게 당기지 않기"
// 위한 값이라, 멤버 몇 개가 world 좌표상 서로 가깝게(나선 배치 등) 놓인
// 성단에 그대로 쓰면 화면 한구석에 조그맣게 뭉친 채로 보인다("반영이
// 안 됐다"던 실제 원인의 절반). 다이브인은 "그 안으로 들어간다"는 연출이므로
// 전역 MAX_ZOOM(2.5)까지는 아니어도 더 당겨도 된다.
const DIVE_FIT_MAX_ZOOM = 1.8;
// 멤버 간 이 거리(월드 단위) 밑이면 라벨이 겹칠 만큼 뭉쳐 있다고 보고
// 자동 재배치한다(아래 computeDiveLayout).
const DIVE_MIN_SPACING = 90;
const DIVE_TIER_ROW_GAP = 130;
const DIVE_TIER_COL_GAP = 110;

function minPairDistance(positions: CanvasPosition[]): number {
  let min = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const d = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
      if (d < min) min = d;
    }
  }
  return min;
}

/** 캔버스 간선(source->target)으로 최장경로 rank를 구한다 - DraftReviewStage의
 * interiorLayoutFor(prereqIds 그래프판)와 같은 알고리즘을 CanvasNode/Edge
 * 모양에 맞춰 다시 쓴 것(파일이 다르고 입력 형태도 달라 그 함수를 그대로
 * import할 수 없다 - export도 안 되어 있다. 복붙이 아니라 같은 규칙의
 * 재구현). 순환 방어를 위해 visiting set으로 0을 반환한다. */
function longestPathRank(ids: string[], edges: { source: string; target: string }[]): Map<string, number> {
  const idSet = new Set(ids);
  const parentsOf = new Map<string, string[]>();
  for (const id of ids) parentsOf.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!idSet.has(e.target) || !idSet.has(e.source)) continue;
    parentsOf.get(e.target)!.push(e.source);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function rankOf(id: string): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let maxParent = -1;
    for (const p of parentsOf.get(id) ?? []) {
      const pr = rankOf(p);
      if (pr > maxParent) maxParent = pr;
    }
    visiting.delete(id);
    const r = maxParent + 1;
    memo.set(id, r);
    return r;
  }
  const result = new Map<string, number>();
  for (const id of ids) result.set(id, rankOf(id));
  return result;
}

/** 다이브인 멤버가 서로 너무 뭉쳐 있을 때(minPairDistance < DIVE_MIN_SPACING)
 * 다시 배치한다: 간선이 있으면 위계 층형(rank), 없으면 level 폴백, 그마저
 * 없으면(지원요소류) centroid 둘레 원형. centroid 기준 상대좌표를 절대좌표로
 * 변환해 돌려준다("과목=위계 층형, 아니면 원형" - 사용자 지시). */
function computeDiveLayout(
  members: CanvasNode[],
  edgesAmong: { source: string; target: string }[],
  centroid: CanvasPosition
): Map<string, CanvasPosition> {
  const ids = members.map((m) => m.id);
  const idSet = new Set(ids);
  const anyEdges = edgesAmong.some((e) => idSet.has(e.source) && idSet.has(e.target) && e.source !== e.target);
  const anyLevel = members.some((m) => typeof m.level === "number");
  const positions = new Map<string, CanvasPosition>();

  if (!anyEdges && !anyLevel) {
    const n = members.length;
    const radius = Math.max(DIVE_MIN_SPACING, (n * DIVE_MIN_SPACING) / (2 * Math.PI));
    members.forEach((m, i) => {
      const angle = (i / n) * Math.PI * 2;
      positions.set(m.id, { x: centroid.x + Math.cos(angle) * radius, y: centroid.y + Math.sin(angle) * radius });
    });
    return positions;
  }

  const levelById = new Map(members.map((m) => [m.id, m.level]));
  const ranks = anyEdges
    ? longestPathRank(ids, edgesAmong)
    : new Map(ids.map((id) => [id, Math.floor((levelById.get(id) ?? 2000) / 1000) - 1]));
  const maxRank = Math.max(...Array.from(ranks.values()), 0);
  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = ranks.get(id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }
  byRank.forEach((idsInRank, rank) => {
    const count = idsInRank.length;
    idsInRank.forEach((id, i) => {
      const x = centroid.x + (count === 1 ? 0 : (i - (count - 1) / 2) * DIVE_TIER_COL_GAP);
      const y = centroid.y + (rank - maxRank / 2) * DIVE_TIER_ROW_GAP;
      positions.set(id, { x, y });
    });
  });
  return positions;
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

interface DragGroupState {
  kind: "group";
  groupId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWorld: CanvasPosition;
  moved: boolean;
}

type DragState = DragNodeState | DragPanState | DragEdgeState | DragGroupState | null;

export function ConstellationCanvas({
  nodes,
  edges,
  groups = {},
  onNodeDrag,
  onNodeToggleComplete,
  onEdgeCreate,
  onEdgeDelete,
  onNodeDelete,
  onOpenNotes,
  onExternalDrop,
  readOnly = false,
  onNodeActivate,
  onEdgeActivate,
  suppressInfoCard = false,
  focusRequest,
  fitRequest,
  className,
  onGroupDrag,
  onGroupToggleCollapse,
  onGroupLabelChange,
  onGroupUngroup,
  onDiveInGroup,
}: ConstellationCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>(null);
  const didAutoCenterRef = useRef(false);

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  // 최신 transform을 rAF 루프/이벤트 핸들러가 리렌더 없이 읽기 위한 미러 -
  // selectedNodeIdRef와 같은 관례.
  const transformRef = useRef<Transform>(transform);
  transformRef.current = transform;
  // 성단 다이브인 - 지금 "안에 들어와 있는" 성단 id. null이면 하늘 전체 뷰.
  // 다이브인은 항상 접힌 성단 클릭에서만 시작되므로(펼쳐지면 그 성단은
  // collapsedGroupList에서 빠져 다시 클릭할 수 없다) 중첩을 걱정할 필요가 없다.
  const [diveGroupId, setDiveGroupId] = useState<string | null>(null);
  // 다이브인 진입 직전의 뷰 transform - "성운 밖으로"/Esc에서 여기로 복귀한다.
  const preDiveTransformRef = useRef<Transform | null>(null);
  const diveRafRef = useRef<number | null>(null);
  // readOnly 뷰어 전용 임시 배치 오프셋 - 뭉친 멤버를 다이브인 때 재배치해도
  // 뷰어는 onNodeDrag로 영속화할 수 없으므로(편집 권한 없음) 여기 로컬
  // state로만 덮어써 보여준다. 다이브아웃 시 지운다(positionOf가 원래
  // nodes[id].position으로 되돌아감). 편집 캔버스는 이 state를 쓰지 않고
  // onNodeDrag로 바로 영속화한다(아래 diveIntoGroup).
  const [diveLayoutOverride, setDiveLayoutOverride] = useState<Record<string, CanvasPosition> | null>(null);

  // 언마운트 시 진행 중이던 다이브 애니메이션 루프를 반드시 끊는다(호버 위성과
  // 동일한 정리 규칙).
  useEffect(() => {
    return () => {
      if (diveRafRef.current != null) cancelAnimationFrame(diveRafRef.current);
    };
  }, []);

  // 뷰 transform을 목표까지 rAF로 보간한다(cubic-bezier(.22,1,.36,1)의 근사인
  // easeOutQuint) - 노드별 transform이 아니라 pan/zoom 루트 <g> 하나만
  // 움직이므로 몇 백 개 노드가 있어도 매 프레임 리렌더 비용은 동일하다.
  // 숨겨진 탭에서는 rAF가 거의 멈췄다가 탭이 다시 보일 때 한 번에 몰아
  // 실행되는데, t를 [0,1]로 clamp해 두면 그 몰림 프레임에서 그냥 목표값으로
  // "스냅"될 뿐 값이 튀거나 넘어가지 않는다(별도 스로틀 불필요).
  const animateTransformTo = useCallback((target: Transform, onDone?: () => void) => {
    if (diveRafRef.current != null) cancelAnimationFrame(diveRafRef.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setTransform(target);
      onDone?.();
      return;
    }
    const from = transformRef.current;
    const duration = 450;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 5);
      setTransform({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased,
        k: from.k + (target.k - from.k) * eased,
      });
      if (t < 1) {
        diveRafRef.current = requestAnimationFrame(tick);
      } else {
        diveRafRef.current = null;
        onDone?.();
      }
    };
    diveRafRef.current = requestAnimationFrame(tick);
  }, []);

  // 사용자가 팬/휠줌을 직접 시작하면 진행 중이던 다이브 카메라 애니메이션은
  // 더 이상 맞지 않으므로 끊는다(안 그러면 rAF가 매 프레임 사용자 입력을
  // 덮어써 버벅임으로 보인다).
  const cancelDiveAnimation = useCallback(() => {
    if (diveRafRef.current != null) {
      cancelAnimationFrame(diveRafRef.current);
      diveRafRef.current = null;
    }
  }, []);
  // 드래그 중인 노드 하나만 낙관적으로 덮어쓴다. 부모의 영속화는 디바운스될 수
  // 있으므로, 실제 props가 따라올 때까지 로컬 좌표를 계속 신뢰한다.
  const [dragPosition, setDragPosition] = useState<{ nodeId: string; position: CanvasPosition } | null>(null);
  // 성단 드래그 중 낙관적 위치 - dragPosition(노드)과 같은 패턴이지만 groups
  // 맵을 참조하는 groupPositionOf가 따로 있어 별도 state로 둔다.
  const [dragGroupPosition, setDragGroupPosition] = useState<{ groupId: string; position: CanvasPosition } | null>(null);
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
      if (diveLayoutOverride && diveLayoutOverride[nodeId]) return diveLayoutOverride[nodeId];
      const n = nodes[nodeId];
      return n ? n.position : { x: 0, y: 0 };
    },
    [nodes, dragPosition, diveLayoutOverride]
  );

  const groupPositionOf = useCallback(
    (groupId: string): CanvasPosition => {
      if (dragGroupPosition && dragGroupPosition.groupId === groupId) return dragGroupPosition.position;
      const g = groups[groupId];
      return g ? g.position : { x: 0, y: 0 };
    },
    [groups, dragGroupPosition]
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
    didAutoCenterRef.current = true;
    setTransform(computeFitTransform(nodeList, rect));
  }, [nodes]);

  // 밖에서 오는 fit 요청(시안 확정 등) - 위 부트 자동 중앙 정렬과 달리 매번
  // 다시 발동해야 하므로 한 번만 실행되는 ref 가드를 두지 않는다. focusRequest
  // 효과와 같은 패턴으로 token 값 자체만 의존성으로 둔다.
  useEffect(() => {
    if (fitRequest == null) return;
    const svg = svgRef.current;
    if (!svg) return;
    const nodeList = Object.values(nodes);
    if (nodeList.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    setTransform(computeFitTransform(nodeList, rect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  // --- 팬 & 줌 -------------------------------------------------------------

  // 주의: React의 onWheel은 루트에 passive로 붙어 preventDefault가 무시된다 -
  // 트랙패드 핀치(ctrl+wheel 확대)가 캔버스 줌과 함께 "브라우저 페이지 줌"까지
  // 일으키던 실버그의 원인. 그래서 이 핸들러는 JSX prop이 아니라 아래
  // useEffect에서 네이티브 리스너({ passive: false })로 직접 단다.
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      cancelDiveAnimation();
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
    [cancelDiveAnimation]
  );

  // handleWheel을 non-passive로 등록한다(위 주석 참고). svg가 마운트된 동안만.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const listener = (e: WheelEvent) => handleWheel(e);
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [handleWheel]);

  const handleBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      cancelDiveAnimation();
      dragRef.current = {
        kind: "pan",
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTransform: transform,
      };
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [transform, cancelDiveAnimation]
  );

  // --- 노드 드래그 -----------------------------------------------------------

  // (선언 위치 주의: beginNodeDrag가 readOnly 클릭-선택 경로에서 참조하므로
  //  그보다 먼저 선언되어야 한다 - TS2448.)
  const activateNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      onNodeActivate?.(nodeId);
    },
    [onNodeActivate]
  );

  const beginNodeDrag = useCallback(
    (nodeId: string) => (e: ReactPointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      // 열람(readOnly) 모드: 드래그는 없고 클릭=선택(정보 카드)만. 이동
      // 임계값을 잴 드래그 자체가 없으니 pointerdown에서 바로 선택한다.
      // stopPropagation으로 배경 팬 시작을 막는 것은 편집 모드와 동일.
      if (readOnly) {
        e.stopPropagation();
        activateNode(nodeId);
        return;
      }
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
    [nodes, readOnly, activateNode]
  );

  // --- 성단 다이브인/아웃 ----------------------------------------------------
  // 성단 클릭 = "그 성단 속으로 들어가는 확대 애니메이션"(사용자 지시). 카메라가
  // 멤버 bounds에 맞춰 rAF로 줌인한 뒤에야 실제로 펼친다(collapsed=false) -
  // 순서를 반대로 하면 카메라가 다가가기도 전에 멤버가 팝인해 버려 "성단이
  // 확대된다"는 느낌이 안 산다. collapsed=false 전환은 기존
  // onGroupToggleCollapse 그대로라 저장본 PATCH/뷰어 로컬 분기는 부모가 이미
  // 처리한다(page.tsx handleGroupToggleCollapse / [cid] groupOverrides).
  const diveIntoGroup = useCallback(
    (groupId: string) => {
      if (diveGroupId) return; // 이미 다이브인 상태 - 중첩 없음(항상 접힌 성단에서만 시작되므로 정상 흐름에선 발생 안 함)
      const group = groups[groupId];
      if (!group) return;
      let memberNodes = group.memberNodeIds.map((m) => nodes[m]).filter((n): n is CanvasNode => !!n);
      if (memberNodes.length === 0) return;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      preDiveTransformRef.current = transformRef.current;

      // 멤버가 서로 너무 뭉쳐 있으면(나선 배치 등 - 바깥 성운 미리보기용
      // 좌표라 실제 편집엔 너무 촘촘하다) 다이브인 순간 정리한다. 위계
      // 간선/level이 있으면 층형, 없으면 원형(computeDiveLayout).
      if (memberNodes.length > 1 && minPairDistance(memberNodes.map((n) => n.position)) < DIVE_MIN_SPACING) {
        const centroid = {
          x: memberNodes.reduce((s, n) => s + n.position.x, 0) / memberNodes.length,
          y: memberNodes.reduce((s, n) => s + n.position.y, 0) / memberNodes.length,
        };
        const memberIdSet = new Set(memberNodes.map((n) => n.id));
        const edgesAmong = Object.values(edges)
          .filter((e) => memberIdSet.has(e.sourceNodeId) && memberIdSet.has(e.targetNodeId))
          .map((e) => ({ source: e.sourceNodeId, target: e.targetNodeId }));
        const laidOut = computeDiveLayout(memberNodes, edgesAmong, centroid);
        memberNodes = memberNodes.map((n) => ({ ...n, position: laidOut.get(n.id) ?? n.position }));
        if (readOnly) {
          // 뷰어는 영속화 권한이 없다 - 로컬 오버레이로만 보여준다.
          setDiveLayoutOverride(Object.fromEntries(memberNodes.map((n) => [n.id, n.position])));
        } else {
          // 편집 캔버스는 기존 노드 이동 경로를 그대로 태워 실제로 정리한다.
          for (const n of memberNodes) onNodeDrag(n.id, n.position);
        }
      }

      const target = computeFitTransform(memberNodes, rect, DIVE_FIT_MAX_ZOOM);
      animateTransformTo(target, () => {
        onGroupToggleCollapse?.(groupId, false);
        setDiveGroupId(groupId);
        onDiveInGroup?.(groupId);
      });
    },
    [diveGroupId, groups, nodes, edges, readOnly, onNodeDrag, animateTransformTo, onGroupToggleCollapse, onDiveInGroup]
  );

  // "성운 밖으로"/Esc - 먼저 되접고(collapsed=true), 그다음 진입 전 뷰로 rAF
  // 복귀한다(다이브인의 역순: 여긴 재접힘이 먼저라 카메라가 빠지는 동안
  // 이미 별 하나로 뭉친 성단이 점점 멀어지는 것처럼 보인다).
  const diveOutOfGroup = useCallback(() => {
    if (!diveGroupId) return;
    const groupId = diveGroupId;
    const restoreTarget = preDiveTransformRef.current ?? transformRef.current;
    onGroupToggleCollapse?.(groupId, true);
    setDiveGroupId(null);
    setDiveLayoutOverride(null);
    preDiveTransformRef.current = null;
    animateTransformTo(restoreTarget);
  }, [diveGroupId, onGroupToggleCollapse, animateTransformTo]);

  // 파국 상태 방어 - 다이브인 중 참조 그룹이 그룹 해제(X)로 사라지거나, 외부
  // 경로(되돌리기 등)로 다시 collapsed=true가 되면, 위 격리 필터(diveMemberSet)가
  // 요소를 전부 숨기는데 그 그룹의 칩까지 이미 숨겨진 상태라 "아무것도 안 보이고
  // 나가기 버튼도 없는" 상태에 갇힌다. groups가 바뀔 때마다 다이브 대상이 여전히
  // 살아서 펼쳐져 있는지 확인하고, 아니면 조용히 다이브아웃한다(diveOutOfGroup은
  // 살아있는 그룹을 다시 접는 걸 전제해 groupId가 없어진 경우엔 못 쓴다 - 카메라
  // 복귀만 직접 수행).
  useEffect(() => {
    if (!diveGroupId) return;
    const g = groups[diveGroupId];
    if (g && !g.collapsed) return; // 정상 - 다이브인 유지
    const restoreTarget = preDiveTransformRef.current ?? transformRef.current;
    setDiveGroupId(null);
    setDiveLayoutOverride(null);
    preDiveTransformRef.current = null;
    animateTransformTo(restoreTarget);
  }, [diveGroupId, groups, animateTransformTo]);

  // --- 성단 드래그 -----------------------------------------------------------
  // 열람 모드에서는 드래그가 없다 - pointerdown에서 곧바로 다이브인만 한다(노드
  // 클릭-선택과 동일한 패턴, beginNodeDrag 참고). 편집 모드에서는 이동 임계값
  // 이내(클릭)면 다이브인, 넘으면 드래그로 갈린다(handlePointerUp에서 분기).
  const beginGroupDrag = useCallback(
    (groupId: string) => (e: ReactPointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (readOnly) {
        diveIntoGroup(groupId);
        return;
      }
      const g = groups[groupId];
      if (!g) return;
      dragRef.current = {
        kind: "group",
        groupId,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorld: g.position,
        moved: false,
      };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [readOnly, groups, diveIntoGroup]
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
  // Esc는 어디에 포커스가 있든 선택/카드를 닫는다. Delete/Backspace는 "선택된
  // 노드가 있을 때만" 그 노드를 삭제한다 - 이 앱엔 undo가 없으므로, 입력
  // 필드(텍스트 편집 중)에서 눌렸다면 무시해서 실수로 지워지지 않게 막는다.
  // 확인 대화상자는 일부러 안 붙였다(요청받지 않음) - 대신 삭제 전제 조건을
  // "선택 상태"로 좁혀서 아무 데서나 손쉽게 눌리지 않게 한다.
  useEffect(() => {
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
      // 열람 모드에선 Esc(카드 닫기)만 허용 - 삭제는 편집 제스처다.
      if (readOnly) return;
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

  // 다이브인 상태에서만 Esc를 가로채 "성운 밖으로"와 동일하게 나간다. 이
  // 리스너는 diveGroupId가 있을 때만 등록되므로(effect deps), 위 카드/선택
  // 닫기 리스너나 palette(ColorPaletteBar)·노트 패널의 각자 Esc 리스너와
  // 경합하지 않는다 - 다들 stopPropagation 없이 독립적으로 자기 몫만 처리하는
  // 기존 관례를 그대로 따른 것뿐이라(같은 Esc 한 번에 선택 카드도 닫히고
  // 다이브아웃도 되는 것은 정상 동작), 별도 우선순위 스택을 새로 만들지 않았다.
  useEffect(() => {
    if (!diveGroupId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") diveOutOfGroup();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diveGroupId, diveOutOfGroup]);

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
      } else if (drag.kind === "group") {
        if (e.pointerId !== drag.pointerId) return;
        const dxScreen = e.clientX - drag.startClientX;
        const dyScreen = e.clientY - drag.startClientY;
        if (Math.hypot(dxScreen, dyScreen) > CLICK_THRESHOLD) drag.moved = true;
        const world = clientToWorld(e.clientX, e.clientY);
        setDragGroupPosition({ groupId: drag.groupId, position: world });
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
      } else if (drag.kind === "group") {
        if (drag.moved) {
          const world = clientToWorld(e.clientX, e.clientY);
          onGroupDrag?.(drag.groupId, world);
        } else {
          // 임계값 이내 = 클릭 -> 다이브인(사용자 지시: "성운 하나 클릭하면 그
          // 성운 속으로 들어가는 확대 애니메이션"). 접기는 펼침 상태의 칩 전용 제스처.
          diveIntoGroup(drag.groupId);
        }
        setDragGroupPosition(null);
      }
      // pan의 transform 자체는 별도 처리 불필요 - 이미 최신 상태.
    },
    [activateNode, clientToWorld, findNodeNear, onEdgeCreate, onNodeDrag, onGroupDrag, diveIntoGroup]
  );

  const handleNodeKeyDown = useCallback(
    (nodeId: string) => (e: ReactKeyboardEvent<SVGGElement>) => {
      // 열람 모드에서도 Enter/Space로 정보 카드는 연다(키보드 동등성).
      if (readOnly) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateNode(nodeId);
        }
        return;
      }
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
      // 드로우온 방향 판정용 - 이 노드가 "방금 달성된 쪽"이라는 힌트.
      lastToggledNodeRef.current = nodeId;
      onNodeToggleComplete(nodeId);
    },
    [readOnly, onNodeToggleComplete]
  );

  // --- 엣지 드로우온(달성 순간 연출) ---------------------------------------
  // 엣지가 "막 켜진"(unlit -> lit) 순간, 이미 켜져 있던 별에서 방금 달성한
  // 별 쪽으로 선이 스윽 그어지는 1회성 애니메이션을 얹는다(사용자 지시).
  // litEdgesRef가 직전 렌더의 lit 집합, drawingEdges가 지금 그려지는 중인
  // 엣지들(값 = 방금 달성한 쪽이 target인지)이다. 애니메이션이 끝나면 일반
  // lit 스타일로 승격된다. prefers-reduced-motion이면 전역 규칙이 duration을
  // 0으로 만들어 즉시 켜진다.
  const lastToggledNodeRef = useRef<string | null>(null);
  const litEdgesRef = useRef<Set<string>>(new Set());
  const [drawingEdges, setDrawingEdges] = useState<Record<string, { towardTarget: boolean }>>({});

  useEffect(() => {
    const prevLit = litEdgesRef.current;
    const nextLit = new Set<string>();
    const newlyLit: Record<string, { towardTarget: boolean }> = {};
    for (const edge of Object.values(edges)) {
      const s = nodes[edge.sourceNodeId];
      const t = nodes[edge.targetNodeId];
      if (!s || !t || !s.isCompleted || !t.isCompleted) continue;
      nextLit.add(edge.id);
      if (!prevLit.has(edge.id)) {
        // 방금 달성한 노드가 target이면 source->target 방향으로 긋는다.
        newlyLit[edge.id] = { towardTarget: lastToggledNodeRef.current !== edge.sourceNodeId };
      }
    }
    litEdgesRef.current = nextLit;
    if (Object.keys(newlyLit).length > 0) {
      setDrawingEdges((cur) => ({ ...cur, ...newlyLit }));
    }
    // 꺼진 엣지는 그리는 중 목록에서도 정리한다(달성 취소 직후 재달성 대비).
    setDrawingEdges((cur) => {
      const kept = Object.entries(cur).filter(([id]) => nextLit.has(id));
      return kept.length === Object.keys(cur).length ? cur : Object.fromEntries(kept);
    });
  }, [nodes, edges]);

  const finishEdgeDraw = useCallback((edgeId: string) => {
    setDrawingEdges((cur) => {
      if (!(edgeId in cur)) return cur;
      const next = { ...cur };
      delete next[edgeId];
      return next;
    });
  }, []);

  // --- 파생 데이터 ----------------------------------------------------------

  // 존재하지 않는 노드를 가리키는 엣지는 조용히 건너뛴다 (노드 삭제 직후
  // 엣지 정리가 아직 안 된 과도기 상태 - 백엔드 prune_orphan_edges와 동일한 방어 규칙).
  const validEdges = useMemo(
    () =>
      Object.values(edges).filter((edge) => nodes[edge.sourceNodeId] && nodes[edge.targetNodeId]),
    [edges, nodes]
  );

  // --- 성단(그룹) 파생 데이터 -------------------------------------------------
  // 접힌 그룹만 멤버를 숨긴다 - 펼친 그룹은 멤버 노드가 자기 자리에 그대로
  // 보통 노드처럼 그려진다("전개/접기에 노드 위치는 불변" - 사용자 지시).
  const collapsedGroupList = useMemo(() => Object.values(groups).filter((g) => g.collapsed), [groups]);
  // 성단 성운 비주얼용 "가벼운" 서명 - 위치(position)는 일부러 뺀다. 노드
  // 드래그는 매 프레임 nodes를 갈아치우지만 성운 입자는 유형/완료 여부/멤버
  // 구성에만 좌우돼야 하므로(아래 groupNebula), 이 서명이 안 바뀌면 무거운
  // buildNebulaParticles 재계산도 건너뛴다.
  const groupMemberSignature = useMemo(
    () =>
      collapsedGroupList
        .map(
          (g) =>
            `${g.id}:${g.memberNodeIds.map((m) => `${m}=${nodes[m]?.type}=${nodes[m]?.isCompleted}`).join(",")}`
        )
        .join("|"),
    [collapsedGroupList, nodes]
  );
  // 성단 성운 비주얼(안개 색/반지름/입자) - group.id -> 파생값. groups는
  // Record라 순회 순서가 안정적이지 않으므로(DraftReviewStage의 bins 배열
  // index와 달리) 입자 시드는 hashSeed(group.id)로 잡는다(리렌더·그룹 순서
  // 변화에도 자리가 안 흔들리게). groupMemberSignature(그룹 id·멤버 구성)에만
  // 의존해 멤버 드래그 중 매 프레임 재계산되지 않는다.
  const groupNebula = useMemo(() => {
    const map = new Map<
      string,
      {
        color: string;
        radius: number;
        allCompleted: boolean;
        memberCount: number;
        particles: ReturnType<typeof buildNebulaParticles>;
      }
    >();
    for (const group of collapsedGroupList) {
      const memberNodes = group.memberNodeIds.map((m) => nodes[m]).filter((n): n is CanvasNode => !!n);
      if (memberNodes.length === 0) continue;
      const firstType = memberNodes[0].type;
      const color = memberNodes.every((n) => n.type === firstType) ? colorForType(firstType) : "var(--text-hi)";
      const allCompleted = memberNodes.every((n) => n.isCompleted);
      const radius = Math.min(
        CLUSTER_MAX_RADIUS,
        CLUSTER_BASE_RADIUS + Math.log2(memberNodes.length + 1) * CLUSTER_RADIUS_SCALE
      );
      const particles = buildNebulaParticles(hashSeed(group.id), memberNodes, radius * 2, color);
      map.set(group.id, { color, radius, allCompleted, memberCount: memberNodes.length, particles });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupMemberSignature]);
  // 숨겨진 멤버 nodeId -> 그 그룹 id. 존재하지 않는 노드는 매핑하지 않는다(정합 방어).
  const memberGroupId = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of collapsedGroupList) {
      for (const m of g.memberNodeIds) if (nodes[m]) map.set(m, g.id);
    }
    return map;
  }, [collapsedGroupList, nodes]);
  const hiddenNodeIds = useMemo(() => new Set(memberGroupId.keys()), [memberGroupId]);
  // 다이브인 격리 - 지금 들어와 있는 성단의 멤버만 보여준다(그 외 노드·간선·
  // 다른 성단은 전부 숨김). null이면 격리 없음(하늘 전체 뷰).
  const diveMemberIds = useMemo(
    () => (diveGroupId ? new Set(groups[diveGroupId]?.memberNodeIds ?? []) : null),
    [diveGroupId, groups]
  );

  interface EdgeEndpoint {
    key: string;
    position: CanvasPosition;
    isCompleted: boolean;
  }
  // 엣지 끝점 하나를 해석한다 - 접힌 그룹의 멤버를 가리키면 그 그룹으로
  // 대체한다(성단↔외부 간선의 "대표 연결"). 그룹의 완료 여부는 멤버 전원
  // 완료일 때만 true로 쳐서, 다 이룬 성단으로 이어진 엣지도 계속 발광한다.
  const resolveEndpoint = useCallback(
    (nodeId: string): EdgeEndpoint | null => {
      const groupId = memberGroupId.get(nodeId);
      if (groupId) {
        const g = groups[groupId];
        if (!g) return null;
        const members = g.memberNodeIds.filter((m) => nodes[m]);
        const isCompleted = members.length > 0 && members.every((m) => nodes[m].isCompleted);
        return { key: `group:${groupId}`, position: groupPositionOf(groupId), isCompleted };
      }
      const n = nodes[nodeId];
      if (!n) return null;
      return { key: nodeId, position: positionOf(nodeId), isCompleted: n.isCompleted };
    },
    [memberGroupId, groups, nodes, groupPositionOf, positionOf]
  );

  // 표시용 엣지 - 그룹으로 대체된 끝점끼리 중복되는 쌍은 하나로 합친다(같은
  // 그룹을 향하는 여러 멤버 간선이 전부 "성단↔외부" 한 줄로 보이게).
  const displayEdgeList = useMemo(() => {
    const seen = new Map<string, { edge: CanvasEdge; source: EdgeEndpoint; target: EdgeEndpoint }>();
    for (const edge of validEdges) {
      // 다이브인 중이면 두 끝점 모두 이 성단의 멤버일 때만 그린다(외부로
      // 나가는 간선까지 보이면 격리가 깨진다).
      if (diveMemberIds && (!diveMemberIds.has(edge.sourceNodeId) || !diveMemberIds.has(edge.targetNodeId))) {
        continue;
      }
      const source = resolveEndpoint(edge.sourceNodeId);
      const target = resolveEndpoint(edge.targetNodeId);
      if (!source || !target || source.key === target.key) continue; // 그룹 내부 간선은 완전히 숨긴다
      const key = source.key < target.key ? `${source.key}|${target.key}` : `${target.key}|${source.key}`;
      if (!seen.has(key)) seen.set(key, { edge, source, target });
    }
    return Array.from(seen.values());
  }, [validEdges, resolveEndpoint, diveMemberIds]);

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
        style={{ cursor: readOnly ? "default" : "grab", touchAction: "none" }}
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
          {/* 성단(접힌 그룹) 성운 안개 - DraftReviewStage 시안의
              `radial-gradient(circle, color-mix(... 75%) 0%, color-mix(... 30%) 55%,
              transparent 78%)`와 같은 스탑을 SVG 페인트 서버로 옮긴 것(SVG fill은
              CSS radial-gradient() 함수를 직접 못 받아 <radialGradient> 참조가
              필요하다). const-spike-h/v와 같은 이유로 currentColor를 써서 성단마다
              그라디언트를 새로 만들 필요 없이 적용하는 <g>의 style.color 하나로
              색만 바꿔 재사용한다. */}
          <radialGradient id="const-nebula">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.75" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="78%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* 배경 격자는 SVG가 아니라 컨테이너의 .bg-radec-grid(적경/적위 좌표선,
            globals.css)로 깐다 - "차트 위에 찍는 중"이라는 인상만 아주 옅게. */}

        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
          {/* 엣지 - 접힌 그룹의 멤버를 가리키는 끝점은 성단으로 대체된다
              (displayEdgeList, 위 성단 파생 데이터 참고). */}
          {displayEdgeList.map(({ edge, source, target }) => {
            const sp = source.position;
            const tp = target.position;
            // 인접 발광 규칙: 양 끝(노드 또는 성단)이 모두 완료일 때만 "빛나는" 스타일.
            // backend/app/domain/constellation.py의 is_edge_lit과 동일한 규칙.
            const lit = source.isCompleted && target.isCompleted;
            const drawing = lit ? drawingEdges[edge.id] : undefined;
            // 커스텀 선 색은 점등/미점등 기본색을 모두 대체한다(미점등일 땐
            // 같은 색을 흐리게) - "색을 골랐는데 미점등이라 안 보임"을 피한다.
            const litStroke = edge.color ?? "var(--lit)";
            const unlitStroke = edge.color ?? "var(--rule)";
            const edgeInteractive = !readOnly && (onEdgeActivate || onEdgeDelete);
            return (
              <g key={edge.id}>
                <line
                  x1={sp.x}
                  y1={sp.y}
                  x2={tp.x}
                  y2={tp.y}
                  // 드로우온 중에는 바닥 선을 미점등 스타일로 깔아 두고, 아래
                  // 오버레이 선이 그 위를 "그어" 나간다 - 끝나면 이 선이 그대로
                  // 점등 스타일로 승격된다.
                  stroke={lit && !drawing ? litStroke : unlitStroke}
                  strokeWidth={lit && !drawing ? 2 : 1}
                  opacity={lit && !drawing ? 1 : edge.color ? 0.55 : 0.8}
                  filter={lit && !drawing ? "url(#const-glow)" : undefined}
                  style={lit && !drawing ? { animation: "edgeGlowPulse 3.2s ease-in-out infinite" } : undefined}
                  onClick={
                    !readOnly && onEdgeActivate
                      ? (e) => {
                          e.stopPropagation();
                          onEdgeActivate(edge.id);
                        }
                      : undefined
                  }
                  onDoubleClick={
                    !readOnly && onEdgeDelete ? () => onEdgeDelete(edge.id) : undefined
                  }
                  className={edgeInteractive ? "cursor-pointer" : undefined}
                />
                {/* 클릭 판정 확장용 투명 히트 영역 - 1~2px 선은 정확히 맞추기
                    어렵다. 시각 선과 같은 좌표에 굵은 투명 선을 겹친다. */}
                {edgeInteractive && (
                  <line
                    x1={sp.x}
                    y1={sp.y}
                    x2={tp.x}
                    y2={tp.y}
                    stroke="transparent"
                    strokeWidth={10}
                    onClick={
                      onEdgeActivate
                        ? (e) => {
                            e.stopPropagation();
                            onEdgeActivate(edge.id);
                          }
                        : undefined
                    }
                    onDoubleClick={onEdgeDelete ? () => onEdgeDelete(edge.id) : undefined}
                    className="cursor-pointer"
                  />
                )}
                {drawing && (
                  <line
                    // 이미 켜져 있던 별(시작점) -> 방금 달성한 별(끝점) 방향.
                    x1={drawing.towardTarget ? sp.x : tp.x}
                    y1={drawing.towardTarget ? sp.y : tp.y}
                    x2={drawing.towardTarget ? tp.x : sp.x}
                    y2={drawing.towardTarget ? tp.y : sp.y}
                    pathLength={1}
                    strokeDasharray="1"
                    stroke={litStroke}
                    strokeWidth={2}
                    filter="url(#const-glow)"
                    style={{ animation: "edgeDrawOn 550ms cubic-bezier(.22,1,.36,1) forwards" }}
                    onAnimationEnd={() => finishEdgeDraw(edge.id)}
                    pointerEvents="none"
                  />
                )}
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

          {/* 노드 - 접힌 그룹의 멤버는 숨긴다(대신 아래 성단 하나로 대표된다).
              다이브인 중이면 그 성단 멤버가 아닌 노드도 전부 숨긴다(격리). */}
          {Object.values(nodes)
            .filter((node) => !hiddenNodeIds.has(node.id) && (!diveMemberIds || diveMemberIds.has(node.id)))
            .map((node) => {
            const pos = positionOf(node.id);
            const color = node.color ?? colorForType(node.type);
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
                tabIndex={0}
                role="button"
                aria-label={node.label}
                // readOnly(열람)에서는 토글 시맨틱이 없다 - 클릭해도 완료
                // 상태가 안 바뀌므로 aria-pressed 자체를 생략한다(undefined,
                // role="button"은 유지).
                aria-pressed={readOnly ? undefined : node.isCompleted}
                onKeyDown={handleNodeKeyDown(node.id)}
                onFocus={() => setFocusedNodeId(node.id)}
                onBlur={() => setFocusedNodeId((cur) => (cur === node.id ? null : cur))}
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId((cur) => (cur === node.id ? null : cur))}
                onPointerDown={beginNodeDrag(node.id)}
                onDoubleClick={!readOnly ? handleNodeDoubleClick(node.id) : undefined}
                style={{ cursor: "pointer", outline: "none" }}
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
                {node.isCompleted && node.glowEffect !== "quiet" && (
                  // 달성 연출 - GLOW_PRESETS의 id별 변주. 공통: 노드 색을
                  // currentColor로 상속, const-glow로 번짐, spikeBreathe(opacity
                  // 전용)로 숨쉬기. 노드마다 위상/주기를 hashNodeId로 흩어
                  // "다 같이 깜빡"을 피한다. delay 음수 = 마운트 툭 튐 방지.
                  <g
                    aria-hidden="true"
                    pointerEvents="none"
                    filter="url(#const-glow)"
                    style={{
                      color,
                      animation: `spikeBreathe ${(3.2 + hashNodeId(`${node.id}#spikeDur`) * 1.6).toFixed(2)}s ease-in-out -${(hashNodeId(`${node.id}#spikeDelay`) * 3).toFixed(2)}s infinite`,
                    }}
                  >
                    {(() => {
                      const glow = node.glowEffect ?? "spike";
                      if (glow === "halo") {
                        // 부드러운 원형 후광 두 겹.
                        return (
                          <>
                            <circle r={r * 2.1} fill="currentColor" opacity={0.16} />
                            <circle r={r * 3.1} fill="currentColor" opacity={0.08} />
                          </>
                        );
                      }
                      if (glow === "ring") {
                        // 얇은 회절 고리 두 개.
                        return (
                          <>
                            <circle r={r * 1.9} fill="transparent" stroke="currentColor" strokeWidth={0.9} opacity={0.55} />
                            <circle r={r * 2.7} fill="transparent" stroke="currentColor" strokeWidth={0.6} opacity={0.3} />
                          </>
                        );
                      }
                      // spike(기본)와 beam(더 길고 가는 빛기둥)은 같은 렉트 구조.
                      const len = glow === "beam" ? spikeLength * 1.8 : spikeLength;
                      const w = glow === "beam" ? SPIKE_WIDTH * 0.8 : SPIKE_WIDTH;
                      return (
                        <>
                          <rect x={-len} y={-w / 2} width={len * 2} height={w} fill="url(#const-spike-h)" />
                          <rect x={-w / 2} y={-len} width={w} height={len * 2} fill="url(#const-spike-v)" />
                        </>
                      );
                    })()}
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

          {/* 성단(접힌 그룹) - 요소가 많아진 노드 묶음을 별 하나로 요약해
              그린다. 클릭(드래그 아님)하면 펼쳐진다(handlePointerUp). 펼쳐진
              그룹은 여기 그려지지 않는다 - 멤버 노드가 각자 자기 자리에
              보통 노드로 그려지고, 대신 "성단 접기" 칩이 뜬다(아래 GroupChip). */}
          {/* 다이브인 중에는 다른(접힌) 성단도 전부 숨긴다 - 격리. */}
          {!diveGroupId && collapsedGroupList.map((group) => {
            const nebula = groupNebula.get(group.id);
            if (!nebula) return null; // 멤버가 전부 사라진 빈 그룹 - 방어적으로 숨긴다
            const pos = groupPositionOf(group.id);
            const { color, radius, allCompleted, memberCount, particles } = nebula;
            return (
              <g
                key={`group:${group.id}`}
                transform={`translate(${pos.x} ${pos.y})`}
                tabIndex={0}
                role="button"
                aria-label={`${group.label} 성단, 요소 ${memberCount}개 - 펼치려면 Enter`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    diveIntoGroup(group.id);
                  }
                }}
                onPointerDown={beginGroupDrag(group.id)}
                style={{ cursor: "pointer", outline: "none" }}
              >
                {/* sprout 등장 애니메이션은 반드시 이 안쪽 <g>에만 건다 - 바깥
                    <g>는 위치(translate) attribute를 갖고 있는데, SVG에서
                    CSS transform(애니메이션 포함)은 attribute transform을
                    "합성"이 아니라 통째로 덮어써 버린다. sprout가 바깥 <g>에
                    있으면 애니메이션이 끝난 뒤(fill-mode both)에도
                    transform: scale(1)이 attribute의 translate를 영구히
                    대체해 모든 성단이 원점(0,0)에 겹쳐 그려진다(실측 버그).
                    안쪽 <g>는 자기 transform이 없으므로 scale 애니메이션이
                    부모의 위치 위에 얹힐 뿐 아무것도 지우지 않는다. style.color는
                    #const-nebula 그라디언트의 currentColor를 이 성단 색으로
                    입힌다(const-spike-h/v와 같은 관례). */}
                <g style={{ animation: "sprout 420ms cubic-bezier(.22,1,.36,1) both", color }}>
                  {/* 성운 안개 - DraftReviewStage 시안과 같은 시각 문법
                      (opacity 0.9/0.4 = 시안의 isCore 대응). */}
                  <circle
                    r={radius}
                    fill="url(#const-nebula)"
                    opacity={allCompleted ? 0.9 : 0.4}
                    filter={allCompleted ? "url(#const-glow)" : undefined}
                  />
                  <circle r={radius} fill="transparent" stroke="var(--rule)" strokeWidth={1} opacity={0.7} />
                  {/* 자글자글한 성운 입자 - hashSeed(group.id) 결정론, Math.random
                      없음(리렌더·드래그마다 자리가 안 흔들린다). */}
                  {particles.map((p, pi) => (
                    <circle
                      key={pi}
                      aria-hidden="true"
                      cx={p.x}
                      cy={p.y}
                      r={p.size}
                      fill={p.color}
                      style={{
                        animation: `starTwinkle ${p.twinkleDur.toFixed(2)}s ease-in-out -${p.twinkleDelay.toFixed(2)}s infinite`,
                        ["--twinkle-lo" as string]: p.twinkleLo,
                        ["--twinkle-hi" as string]: p.twinkleHi,
                      }}
                    />
                  ))}
                  {/* 멤버 수 배지 - 숫자이므로 font-mono(한글 아님, No-Korean-Mono 규칙과 무관). */}
                  <circle cx={radius * 0.6} cy={-radius * 0.6} r={8.5} fill="var(--ink-800)" stroke="var(--rule)" strokeWidth={1} />
                  <text
                    x={radius * 0.6}
                    y={-radius * 0.6 + 3.5}
                    textAnchor="middle"
                    fontSize={9}
                    className="font-mono"
                    fill="var(--text-hi)"
                  >
                    {memberCount}
                  </text>
                  <text
                    x={0}
                    y={radius + 16}
                    textAnchor="middle"
                    fontSize={12}
                    className="font-serif"
                    fill="var(--text-hi)"
                    style={{ paintOrder: "stroke", stroke: "var(--ink-900)", strokeWidth: 3, strokeOpacity: 0.75 }}
                  >
                    {group.label}
                  </text>
                </g>
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
      {/* 정보 카드는 열람 모드에서도 뜬다("구경과 인터랙션만" - 사용자 원문).
          단 노트 진입점은 편집 화면 전용이라 readOnly에선 잇지 않는다. */}
      {!suppressInfoCard && selectedNodeId && nodes[selectedNodeId] && (
        <ElementPopover
          node={nodes[selectedNodeId]}
          transform={transform}
          containerRef={svgRef}
          onOpenNotes={!readOnly && onOpenNotes ? () => onOpenNotes(selectedNodeId) : undefined}
          onDismiss={() => setSelectedNodeId(null)}
        />
      )}

      {readOnly && (
        <div className="pointer-events-none absolute inset-0" aria-hidden />
      )}

      {/* 펼쳐진 그룹마다 뜨는 "성단 접기" 칩 - group.position(접힘/펼침과 무관한
          고정 앵커)에 뜬다. 이 칩이 곧 그룹의 유일한 선택 표면이라 이름 바꾸기/
          해제도 여기서 한다(readOnly에서는 접기만 남기고 숨김). 다이브인 중에는
          요소들 위에 라벨/편집/해제 칩이 떠 있으면 안 된다(사용자 지시) - 이름
          표기는 우하단 표시 전용 칩이 맡고, 해제(X)가 다이브 중 그룹을 지워버리면
          격리 필터가 전부 숨겨지는 파국 상태로 이어지므로 diveGroupId가 있는 동안은
          완전히 숨긴다. 이름 변경/해제는 다이브아웃 후에 하면 된다. */}
      {Object.values(groups)
        .filter((g) => !g.collapsed && !diveGroupId)
        .map((group) => (
          <GroupChip
            key={group.id}
            group={group}
            transform={transform}
            readOnly={readOnly}
            onToggleCollapse={(collapsed) => onGroupToggleCollapse?.(group.id, collapsed)}
            onLabelChange={onGroupLabelChange ? (label) => onGroupLabelChange(group.id, label) : undefined}
            onUngroup={onGroupUngroup ? () => onGroupUngroup(group.id) : undefined}
          />
        ))}

      {/* 다이브인 내부 상태 상단 배너 - 밖으로 나가기(클릭 또는 Esc, 위
          diveOutOfGroup 이펙트)만 남는다. 성운 이름은 우하단 칩(아래)으로
          옮겼다(사용자 지시) - 상단 배너는 복귀 동작 전용. readOnly에서도
          뜬다(뷰어도 다이브인/아웃은 가능 - 로컬 토글만, PATCH 없음). */}
      {diveGroupId && groups[diveGroupId] && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-rule bg-ink-800/90 px-3 py-1.5 font-sans text-xs text-text-hi shadow-lg">
            <button
              type="button"
              className="flex items-center gap-1 hover:text-spec-b focus-visible:outline focus-visible:outline-2 focus-visible:outline-spec-b"
              onClick={diveOutOfGroup}
            >
              <span aria-hidden>{"←"}</span>
              성운 밖으로
            </button>
          </div>
        </div>
      )}

      {/* 다이브인 중 우하단 성운 이름 칩 - "지금 어느 성운 안에 들어와 있는지"만
          알려주는 표시 전용 칩(사용자 지시: 우하단에 "OOO 성운"). GroupChip과
          같은 종이 크롬(pill)이지만 world 좌표에 묶이지 않고 화면에 고정되며,
          클릭해도 아무 동작이 없다 - 복귀는 위 상단 배너 버튼이나 Esc의 몫이라
          이 칩까지 인터랙티브하게 만들 이유가 없다(제스처 하나에 출구 하나만).
          readOnly에서도 뜬다(상단 배너와 동일 조건). */}
      {diveGroupId && groups[diveGroupId] && (
        // md+ 우측 320px대 「군집/노트」 섬 패널(위 FIT_RIGHT_PANEL_W 주석 참고),
        // 그 왼쪽 "별자리 띄우기" 플로팅 버튼, 모바일 하단 바텀시트(항상 펼침
        // 유지)까지 page.tsx의 뜨는 크롬은 전부 z-20이고 이 캔버스보다 나중에
        // DOM에 와 위에 깔린다 - 패널 접힘/모바일 등 어떤 조합에서도 안 가려지게
        // z-30으로 그 위에 고정한다(pointer-events-none이라 아래 버튼 클릭은
        // 그대로 통과). md:right-[324px]는 패널이 펼쳐진 기본값 기준 위치일 뿐,
        // 실제 겹침 방지는 z-index가 보장한다. 라벨이 길면 말줄임.
        <div className="pointer-events-none absolute bottom-20 right-4 z-30 max-w-[calc(100vw-2rem)] md:right-[324px]">
          <div className="max-w-[16rem] truncate rounded-full border border-rule bg-ink-800/90 px-3 py-1.5 font-serif text-xs text-text-hi shadow-lg">
            {groups[diveGroupId].label} 성운
          </div>
        </div>
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

interface GroupChipProps {
  group: CanvasGroup;
  transform: Transform;
  readOnly: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  onLabelChange?: (label: string) => void;
  onUngroup?: () => void;
}

/**
 * 펼쳐진 성단 옆에 뜨는 작은 라벨 칩 - 접기 컨트롤이자 그룹의 유일한 편집
 * 표면(이름 바꾸기/해제). 접힌 성단은 캔버스 <g>로 그려지지만(위 성단 렌더
 * 참고) 펼치면 그 자리엔 멤버 노드들만 남으므로, 그룹 자체를 계속 가리키고
 * 조작할 대상이 필요해서 이 칩을 별도 HTML 오버레이로 띄운다 - ElementPopover와
 * 같은 방식(world 좌표 -> transform 적용 -> 화면 좌표)이지만, 노드 개수만큼
 * 늘어나는 팝오버가 아니라 "펼쳐진 그룹당 하나"라 화면 클램프는 생략했다
 * (ponytail: 화면 밖으로 나가는 극단적 케이스는 팬으로 되돌아오면 그만).
 */
function GroupChip({ group, transform, readOnly, onToggleCollapse, onLabelChange, onUngroup }: GroupChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);

  useEffect(() => {
    setDraft(group.label);
  }, [group.label]);

  function commitLabel() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== group.label) onLabelChange?.(next);
    else setDraft(group.label);
  }

  const screenX = transform.x + group.position.x * transform.k;
  const screenY = transform.y + group.position.y * transform.k;

  return (
    <div
      className="absolute z-10 flex items-center gap-1.5 rounded-full border border-rule bg-ink-800/90 px-2.5 py-1 font-sans text-xs text-text-hi shadow-lg"
      style={{ left: screenX + 16, top: screenY - 14 }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitLabel();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(group.label);
              setEditing(false);
            }
          }}
          className="w-28 rounded bg-ink-900 px-1.5 py-0.5 font-serif text-xs text-text-hi outline-none focus-visible:ring-1 focus-visible:ring-spec-b"
        />
      ) : (
        <button
          type="button"
          className="font-serif hover:text-spec-b"
          title="성단 접기"
          onClick={() => onToggleCollapse(true)}
        >
          {group.label}
        </button>
      )}
      {!readOnly && !editing && (
        <>
          <button
            type="button"
            aria-label="성단 이름 바꾸기"
            className="text-text-lo hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-spec-b"
            onClick={() => setEditing(true)}
          >
            {"✎"}
          </button>
          {onUngroup && (
            <button
              type="button"
              aria-label="그룹 해제"
              title="그룹 해제 - 멤버는 그대로 남습니다"
              className="text-text-lo hover:text-spec-m focus-visible:outline focus-visible:outline-2 focus-visible:outline-spec-b"
              onClick={onUngroup}
            >
              {"✕"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
