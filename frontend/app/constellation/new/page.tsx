"use client";

/**
 * 별자리 만들기 화면 - 원소 보관함(오른쪽)에서 칩을 캔버스(가운데)로 끌어와
 * 놓고 연결해 별자리를 완성하는 화면.
 *
 * 백엔드 연동 전 데모 화면이라, 그래프는 전부 로컬 React state로만 존재하고
 * 새로고침하면 사라진다. 영속화/네비게이션 연결은 이후 단계에서 붙인다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ConstellationCanvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPosition,
} from "@/components/ConstellationCanvas";
import { ElementBinPanel, type Bin, type BinItem, type BinDropPayload } from "@/components/ElementBinPanel";
import { ElementNotesPanel, type ElementNote } from "@/components/ElementNotesPanel";
import { ConstellationIntakeChat } from "@/components/ConstellationIntakeChat";
import { DraftReviewStage } from "@/components/DraftReviewStage";
import { ColorPaletteBar } from "@/components/ColorPaletteBar";
import { LaunchModal, type LaunchInput } from "@/components/LaunchModal";
import { Modal } from "@/components/ui/Modal";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import type { ResolveWikiLink } from "@/lib/markdown";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { makeId } from "@/lib/ids";
import { ApiError } from "@/lib/api";
import { createMutationQueue } from "@/lib/use-mutation-queue";
import {
  addEdge,
  addNode,
  createConstellation,
  createNote,
  deleteEdge,
  deleteNode,
  deleteNote,
  getBinJob,
  listConstellations,
  listNotes,
  patchNodeColor,
  patchNodeCompletion,
  patchNodePosition,
  patchNote,
  patchPublish,
  putBins,
  startBinFillJob,
  type BinDto,
  type BinItemDto,
  type DraftDto,
  type EdgeCreateInput,
  type NodeCreateInput,
} from "@/lib/constellation-api";
// 로컬 볼트(옵시디언처럼 로컬 폴더=원본) - 노트 CRUD를 서버 대신 여기로
// 분기시키는 게 이 파일의 "브리지" 부분(각 분기 지점에 "볼트=원본, 서버=유료
// 동기화 예정" 주석을 달아 둔다).
import {
  connectVault,
  deleteVaultNote,
  disconnectVault,
  isVaultSupported,
  listVaultNotes,
  requestVaultPermission,
  restoreVault,
  writeVaultNote,
  type VaultHandle,
} from "@/lib/local-vault";

/** 편집 모드 진입 버튼의 연필 아이콘. 다른 파일(components/ui/icons.tsx)을
 * 건드리지 않기 위해 이 화면 안에서만 쓰는 작은 SVG로 둔다. */
function EditPencilIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 원소를 캔버스에 놓을 때 만드는 노드의 id는 항상 `element:{binItem.id}` 형태로
// 고정한다. 같은 원소를 두 번 드롭/Enter해도 이미 그 id의 노드가 있으면
// 새로 만들지 않고 조용히 무시한다 - "칩 하나는 캔버스에서 항상 노드 하나"
// 라는 불변식을 지키기 위한 규칙(위치를 옮기지는 않음, 그냥 무시).
function nodeIdForItem(itemId: string): string {
  return `element:${itemId}`;
}

const INITIAL_BINS: Bin[] = [
  {
    id: "bin-business",
    label: "경영 기초",
    origin: "llm",
    items: [
      { id: "course-accounting-1", label: "회계원리(1)", type: "course", level: 1000, subtitle: "전공 기초" },
      { id: "course-org-behavior", label: "조직행동론", type: "course", level: 2000 },
      { id: "course-marketing", label: "마케팅원론", type: "course", level: 2000 },
    ],
  },
  {
    id: "bin-certs",
    label: "자격증",
    origin: "llm",
    items: [
      { id: "cert-invest-manager", label: "투자자산운용사", type: "certification", subtitle: "금융투자협회 시험" },
    ],
  },
];

const INITIAL_NODES: Record<string, CanvasNode> = {
  "goal-root": {
    id: "goal-root",
    label: "경영학 복수전공",
    type: "organization",
    isCompleted: true,
    position: { x: 0, y: -40 },
    description: "경영학 복수전공 이수를 위한 전체 로드맵의 최종 목표.",
    noteCount: 2,
  },
  "club-activity": {
    id: "club-activity",
    label: "경영학회 활동",
    type: "activity",
    isCompleted: true,
    position: { x: -120, y: 90 },
    description: "학회 활동을 통해 실무 감각과 네트워크를 쌓는다.",
  },
  "element:course-accounting-1": {
    id: "element:course-accounting-1",
    label: "회계원리(1)",
    type: "course",
    isCompleted: false,
    position: { x: 130, y: 60 },
    level: 1000,
    code: "BIZ1101",
    description: "복식부기의 원리와 재무제표(재무상태표·손익계산서) 작성 과정을 익히는 전공 기초 과목. 기업의 재무상태와 경영성과를 숫자로 읽는 법을 배운다.",
    noteCount: 3,
  },
};

const INITIAL_EDGES: Record<string, CanvasEdge> = {
  "edge-root-club": { id: "edge-root-club", sourceNodeId: "goal-root", targetNodeId: "club-activity" },
};

let userItemCounter = 0;

// 저장 상태 배지 문구 - 뮤테이션 큐의 진행 중 개수(pendingMutationsRef)가
// 구동한다. "다시 시도"는 자동 재시도가 아니라 문구일 뿐 - 다음 편집이
// 다시 큐를 타면 자연히 saved로 돌아온다.
const SAVE_STATE_LABEL: Record<"unsaved" | "saving" | "saved" | "error", string> = {
  unsaved: "저장 안 됨",
  saving: "저장 중…",
  saved: "저장됨",
  error: "저장 오류 — 다시 시도",
};

// "모두 추가"/보관함 드래그로 통째로 놓을 때 쓰는 나선형 배치 - level(학정번호
// 앞자리) 오름차순으로 정렬한 뒤 index가 늘수록 반지름도 커지는 황금각 나선을
// 그린다. ElementBinPanel의 spiralPosition과 같은 규칙(기초 원소가 안쪽)을
// page.tsx 쪽 드래그 경로에서도 그대로 재현한다.
const GOLDEN_ANGLE_RAD = 137.5 * (Math.PI / 180);
function spiralOffset(index: number, base: CanvasPosition): CanvasPosition {
  const angle = index * GOLDEN_ANGLE_RAD;
  const radius = 46 + index * 28;
  return {
    x: Math.round(base.x + Math.cos(angle) * radius),
    y: Math.round(base.y + Math.sin(angle) * radius),
  };
}

function isBinDropPayload(value: unknown): value is BinDropPayload {
  return (
    !!value &&
    typeof value === "object" &&
    (value as Record<string, unknown>).kind === "bin" &&
    typeof (value as Record<string, unknown>).binId === "string"
  );
}

// BinDto/BinItemDto <-> Bin/BinItem 매핑. 두 쪽 모양이 거의 1:1이라(id/label/
// origin/advice/items, level/subtitle/description 전부 optional) 그냥 필드를
// 그대로 옮기면 된다 - isLoading은 서버 쪽 개념이 아니므로 항상 지운다(로드 시엔
// false 취급, 저장 시엔 payload에서 아예 뺀다).
function mapBinItemDtoToBinItem(dto: BinItemDto): BinItem {
  return { id: dto.id, label: dto.label, type: dto.type, level: dto.level, subtitle: dto.subtitle, description: dto.description };
}

function mapBinDtoToBin(dto: BinDto): Bin {
  return { id: dto.id, label: dto.label, origin: dto.origin, advice: dto.advice, items: dto.items.map(mapBinItemDtoToBinItem) };
}

function mapBinToBinDto(bin: Bin): BinDto {
  return {
    id: bin.id,
    label: bin.label,
    origin: bin.origin,
    advice: bin.advice,
    items: bin.items.map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      level: item.level ?? undefined,
      subtitle: item.subtitle,
      description: item.description,
    })),
  };
}

// 수업 원소의 id는 항상 "course:{학정번호}" 형태이고(백엔드 bin_suggestion.py의
// _course_item 참고), 라벨은 "학정번호 과목명"으로 코드가 앞에 붙어 온다.
// 캔버스 노드는 code 필드가 있으면 label을 "코드+이름"이 아니라 순수 이름으로
// 렌더링하는 것을 전제하므로(ConstellationCanvas의 fallbackSplit 로직 참고),
// code를 뽑아낼 때는 라벨에서도 그 코드 접두어를 함께 잘라내야 한다 - 안 그러면
// 칩 위에 코드가 두 번(코드 배지 + 라벨 안) 나타난다.
const COURSE_CODE_PREFIX_RE = /^[A-Z]{2,6}\d{3,5}\s+/;
function deriveNodeCodeAndLabel(item: BinItem): { code?: string; label: string } {
  if (item.id.startsWith("course:")) {
    return { code: item.id.slice(7), label: item.label.replace(COURSE_CODE_PREFIX_RE, "") };
  }
  return { label: item.label };
}

// bins 전체를 뒤져 원소 하나를 id로 찾는다 - 초안(draft)의 itemIds는 어느
// 보관함 소속인지 모르는 상태로 온다.
function findBinItemAcrossBins(bins: Bin[], itemId: string): BinItem | undefined {
  for (const bin of bins) {
    const item = bin.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return undefined;
}

// 초안 하나를 캔버스 그래프로 편다 - 지그재그 배치는 요구사항의 "단순하지만
// 보기 좋은 흩뿌림"을 만족하는 가장 짧은 공식일 뿐이라 다른 의미는 없다
// (사용자가 어차피 드래그로 다시 배치한다).
function draftItemPosition(index: number): CanvasPosition {
  return {
    x: 220 + index * 170 + (index % 2) * 40,
    y: 420 + (index % 2 ? 130 : -60) + ((index * 53) % 3) * 35,
  };
}

function buildDraftGraph(
  draft: DraftDto,
  bins: Bin[]
): { nodes: Record<string, CanvasNode>; edges: Record<string, CanvasEdge> } {
  const nodes: Record<string, CanvasNode> = {};
  draft.itemIds.forEach((itemId, index) => {
    const item = findBinItemAcrossBins(bins, itemId);
    if (!item) return; // 보관함에서 사라진 항목 - 조용히 건너뛴다.
    const nodeId = nodeIdForItem(itemId);
    const { code, label } = deriveNodeCodeAndLabel(item);
    nodes[nodeId] = {
      id: nodeId,
      label,
      type: item.type,
      isCompleted: false,
      position: draftItemPosition(index),
      level: item.level ?? null,
      code,
      description: item.description,
    };
  });
  const edges: Record<string, CanvasEdge> = {};
  draft.edges.forEach(([fromId, toId], index) => {
    const sourceNodeId = nodeIdForItem(fromId);
    const targetNodeId = nodeIdForItem(toId);
    if (!nodes[sourceNodeId] || !nodes[targetNodeId]) return; // 끝점이 없는 엣지는 버린다.
    const id = `edge-draft-${index}`;
    edges[id] = { id, sourceNodeId, targetNodeId };
  });
  return { nodes, edges };
}

// 회계원리(1)에 미리 채워 둔 데모 노트 - 시드 노드가 이미 "노트 3개"라고
// 주장하므로(INITIAL_NODES 참고) 실제로 3개를 만들어 패널이 바로 시연 가능하게
// 한다. 하나는 비공개, 하나는 공개로 섞어 배지 차이도 눈에 보이게 했다.
const SEED_TIME = Date.UTC(2026, 7, 20, 9, 0, 0);
const INITIAL_NOTES: Record<string, ElementNote> = {
  "note-seed-1": {
    id: "note-seed-1",
    nodeId: "element:course-accounting-1",
    title: "복식부기 핵심",
    body:
      "**차변/대변**은 결국 하나의 거래를 두 번 기록하는 것.\n\n" +
      "- 자산 증가 -> 차변\n- 부채/자본 증가 -> 대변\n\n" +
      "`재무상태표`와 `손익계산서`가 어떻게 이어지는지는 [[경영학회 활동]]에서 실습으로 다시 확인.",
    isPublic: false,
    attachments: [],
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  },
  "note-seed-2": {
    id: "note-seed-2",
    nodeId: "element:course-accounting-1",
    title: "감가상각 정리",
    body:
      "> 정액법: (취득원가 - 잔존가치) / 내용연수\n\n감가상각비는 비용이지만 현금 유출이 없다는 점이 헷갈렸음.",
    isPublic: false,
    attachments: [],
    createdAt: SEED_TIME + 1000 * 60 * 60,
    updatedAt: SEED_TIME + 1000 * 60 * 60 * 5,
  },
  "note-seed-3": {
    id: "note-seed-3",
    nodeId: "element:course-accounting-1",
    title: "스터디 공유용 요약",
    body: "1. 거래의 이중성\n2. 계정과목 5대 분류\n3. 시산표 작성 순서\n\n다음 스터디에서 [[투자자산운용사]] 준비랑 연결해서 볼 것.",
    isPublic: true,
    attachments: [],
    createdAt: SEED_TIME + 1000 * 60 * 60 * 24,
    updatedAt: SEED_TIME + 1000 * 60 * 60 * 24,
  },
};

// 오른쪽 패널이 지금 무엇을 보여주는지 - 「군집」(원소 보관함) 또는 「노트」
// (선택된 원소 하나의 노트). 새 영역이 아니라 같은 자리를 스왑하는 상태다.
// 상단 탭이 이 상태 하나만 조작하는 유일한 진입점이고, "어느 원소의 노트인지"는
// 별도 state(notesNodeId)로 둬 탭을 오가도 마지막 선택이 남아있게 한다.
type PanelMode = "bins" | "notes";

export default function NewConstellationPage() {
  const [bins, setBins] = useState<Bin[]>(INITIAL_BINS);
  const [nodes, setNodes] = useState<Record<string, CanvasNode>>(INITIAL_NODES);
  const [edges, setEdges] = useState<Record<string, CanvasEdge>>(INITIAL_EDGES);
  const [notes, setNotes] = useState<Record<string, ElementNote>>(INITIAL_NOTES);
  // --- 로컬 볼트(노트 원본) ------------------------------------------------
  // 연결되면 이 handle이 노트의 "원본"이 된다 - 서버·볼트 동시 쓰기는 하지
  // 않는다. vaultSupported는 SSR/CSR 불일치(hydration mismatch)를 피하려고
  // 마운트 이펙트에서만 채운다(서버 렌더 시점엔 window가 없어 항상 false).
  const [vaultSupported, setVaultSupported] = useState(false);
  const [vaultHandle, setVaultHandle] = useState<VaultHandle | null>(null);
  const [vaultNeedsPermission, setVaultNeedsPermission] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("bins");
  // 우측 군집/노트 패널 접기(섬화) - md 이상에서만 의미가 있다. 접으면 섬
  // 아이콘 칩 하나만 남고, 다시 누르면 같은 자리에서 패널이 펼쳐진다. 모바일
  // 바텀시트는 이 상태와 무관하게 항상 펼쳐진 채로 보인다(아래 aside
  // className의 md: 전용 분기 참고). 기본은 펼침.
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [notesNodeId, setNotesNodeId] = useState<string | null>(null);
  // notesNodeId를 같은 값으로 다시 세팅해도(같은 원소를 카드에서 또 클릭 등)
  // 노트 패널이 "펼치고 스크롤"을 다시 수행해야 하므로, nodeId 자체가 아니라
  // 매번 증가하는 이 토큰으로 "펼침 요청"을 전달한다.
  const [notesExpandToken, setNotesExpandToken] = useState(0);
  // "크게 보기" - 열린 노트 편집기를 레일 경계까지 넓힌다. 노트 패널을 벗어나면
  // (탭 전환 등) 의미가 없으므로 여기 최상위에서 관리하되, 실제 리셋은
  // ElementNotesPanel이 activeNoteKey 변화에 맞춰 호출해 준다.
  const [isNoteExpanded, setIsNoteExpanded] = useState(false);

  // --- 편집 모드(F3: 색 커스터마이징) -------------------------------------
  // editMode에서는 노드를 클릭해도 기본 정보 팝오버 대신 색 팔레트 바가
  // 뜬다(캔버스의 suppressInfoCard). paletteNodeId는 지금 팔레트가 열려 있는
  // 노드 - editMode를 끄거나 다른 노드를 고르면 갱신/초기화된다.
  const [editMode, setEditMode] = useState(false);
  const [paletteNodeId, setPaletteNodeId] = useState<string | null>(null);

  // --- 별자리 띄우기(F4) ---------------------------------------------------
  // description/contributors는 저장 버튼의 titleModal(제목만 다룸)과 별개로
  // 이 모달이 전담하는 발행 메타데이터라 여기 최상위에서 들고 있다가 모달을
  // 다시 열 때 기본값으로 넘긴다(직전에 입력한 값을 계속 보여주기 위함).
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [launchDescription, setLaunchDescription] = useState("");
  const [launchContributors, setLaunchContributors] = useState<string[]>([]);
  // 띄우기 직후 잠깐 켜지는 별빛 발광 - window.alert 클라이맥스를 대신한다
  // (사용자 지시: 세계관 내 확인). 저장 툴바의 "발행됨" 칩에 shadow-glow-bloom을
  // 잠깐 얹었다 스스로 꺼진다. prefers-reduced-motion은 globals.css의 전역
  // transition-duration 킬스위치가 처리하므로 여기서 따로 분기하지 않는다.
  const [justPublished, setJustPublished] = useState(false);

  // --- 부팅 상태 + Intake 오버레이 ---------------------------------------
  // "loading"(인증 확인 중) -> "empty"(로그인했는데 별자리가 하나도 없음, 대화
  // 오버레이를 띄운다) 또는 "loaded"(데모 시드 또는 실제 별자리를 보여줄 준비
  // 완료) 중 하나로만 정착한다. 비로그인도 "empty"로 정착해 대화 오버레이를 탄다
  // (렌즈->대화->추천 체인은 인증과 무관 - 제한은 저장 시점).
  // bootState가 풀리는 모든 지점(아래 boot effect의 empty/loaded/에러 경로 전부)이
  // 같은 동기 블록에서 setIntakeOpen(true)도 함께 호출한다 - React가 같은 커밋으로
  // 배칭해 캔버스와 대화 오버레이가 한 프레임에 같이 나타난다(따로 effect를 두면
  // bootState 커밋 이후 한 프레임 캔버스만 노출됐다 대화가 뜨는 번쩍임이 생김).
  // "loading" 동안은 아래 JSX의 전면 베일이 화면을 가린다.
  const [bootState, setBootState] = useState<"loading" | "empty" | "loaded">("loading");
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  // Intake가 초안(draft)까지 함께 돌려준 경우 - 사용자가 셋 중 하나를 고르거나
  // "직접 그릴래요"로 빠져나갈 때까지 캔버스는 이 상태가 가리키는 초안의
  // 미리보기만 보여준다(로컬 전용 - 서버 뮤테이션 없음, 아래 handleIntakeComplete 참고).
  const [draftOffer, setDraftOffer] = useState<{ drafts: DraftDto[]; selected: number } | null>(null);
  // Intake 대화가 다듬어 준 목표 원문 - "보관함 채우기" 잡을 새로 돌릴 때(예:
  // 사용자가 직접 보관함을 하나 더 만들 때) 매번 다시 물어보지 않고 재사용한다.
  // 기존 별자리를 불러온 경우엔 대화를 거치지 않았으므로 그 별자리의 제목으로
  // 대신한다(constellationTitleRef).
  const goalTextRef = useRef<string | null>(null);
  const constellationTitleRef = useRef<string | null>(null);
  // "보관함 채우기" 잡 폴링 - 보관함 id별로 활성 인터벌 하나씩. 언마운트 시
  // 전부 정리해야 리크가 없다(아래 effect 참고).
  const fillPollsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  useEffect(() => {
    const polls = fillPollsRef.current;
    return () => {
      polls.forEach((interval) => clearInterval(interval));
      polls.clear();
    };
  }, []);

  // --- 영속화 -----------------------------------------------------------
  // 로그인된 유저면 이 화면은 더 이상 순수 데모가 아니라 실제 별자리를
  // 편집하는 화면이다. 로컬 state(nodes/edges/notes)가 항상 진실이고, 서버
  // 뮤테이션은 fire-and-forget으로 흘려보낸다(응답으로 state를 덮어쓰지
  // 않음) - 서버 응답은 최초 로드/최초 저장에서만 state를 채운다.
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [constellationId, setConstellationId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"unsaved" | "saving" | "saved" | "error">("unsaved");
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titleInput, setTitleInput] = useState("");

  // 최신 state를 동기적으로 읽기 위한 미러 - 드래그/토글/연결 핸들러가 useCallback의
  // 의존성 배열을 늘리지 않고도(재생성 최소화) 항상 최신 값을 참조할 수 있게 한다.
  // ConstellationCanvas의 selectedNodeIdRef와 같은 패턴.
  const constellationIdRef = useRef<string | null>(null);
  useEffect(() => {
    constellationIdRef.current = constellationId;
  }, [constellationId]);
  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const edgesRef = useRef(edges);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);
  const binsRef = useRef(bins);
  useEffect(() => {
    binsRef.current = bins;
  }, [bins]);
  const vaultHandleRef = useRef<VaultHandle | null>(null);
  useEffect(() => {
    vaultHandleRef.current = vaultHandle;
  }, [vaultHandle]);

  // 이전 세션에서 연결해 둔 볼트를 복원한다(로그인 여부와 무관 - 볼트는 이
  // 브라우저 로컬 기능). requestPermission은 사용자 제스처가 필요해 여기서
  // 자동 호출하지 않고, needsPermission으로만 알려서 상태 줄의 버튼이
  // 담당하게 한다. 권한이 이미 granted면 바로 하이드레이트한다 - 아래 서버
  // 로드 이펙트가 vaultHandleRef를 보고 자기 쪽 setNotes를 건너뛴다.
  // ponytail: 두 이펙트가 병렬로 도는 레이스라 이론상 서버 응답이 이 로컬
  // IndexedDB 조회보다 먼저 끝나면 서버 노트로 잠깐 덮일 수 있음 - 실사용에서
  // 문제되면 두 이펙트를 하나로 합쳐 순서를 강제할 것.
  useEffect(() => {
    const supported = isVaultSupported();
    setVaultSupported(supported);
    if (!supported) return;
    let cancelled = false;
    (async () => {
      const restored = await restoreVault();
      if (cancelled || !restored) return;
      setVaultHandle(restored.handle);
      vaultHandleRef.current = restored.handle;
      setVaultNeedsPermission(restored.needsPermission);
      if (!restored.needsPermission) {
        try {
          const vaultNotes = await listVaultNotes(restored.handle);
          if (cancelled) return;
          const map: Record<string, ElementNote> = {};
          for (const n of vaultNotes) map[n.id] = n;
          setNotes(map);
        } catch (err) {
          console.error("[vault] 노트 목록 읽기 실패", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 서버 뮤테이션 직렬 큐 하나 - 컴포넌트 생애 동안 단 한 번만 만든다(재렌더마다
  // 새 큐를 만들면 체이닝이 끊긴다). 큐 자체의 에러 로깅과는 별개로, 여기서는
  // "지금 몇 개가 아직 안 끝났는지"만 세어 saveState 배지를 구동한다.
  const pendingMutationsRef = useRef(0);
  const [mutationQueue] = useState(() =>
    createMutationQueue(() => {
      pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
      setSaveState("error");
    })
  );
  const enqueueMutation = useCallback(
    (fn: () => Promise<unknown>) => {
      pendingMutationsRef.current += 1;
      setSaveState("saving");
      mutationQueue.enqueue(async () => {
        await fn();
        pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
        if (pendingMutationsRef.current === 0) setSaveState("saved");
      });
    },
    [mutationQueue]
  );

  // 보관함 전체를 서버에 밀어넣는다 - bins state에 useEffect를 걸지 않고(그러면
  // 초기 로드가 끝난 직후 방금 서버에서 받아온 값을 그대로 되돌려 보내는 낭비
  // 왕복이 생긴다) 실제로 사용자가 보관함을 바꾼 지점(Intake 완료/채우기 잡
  // 완료/직접 추가/새 보관함 생성)에서만 명시적으로 호출한다. 별자리가 아직
  // 서버에 없으면(cid 없음) 조용히 아무 것도 하지 않는다 - 그 경우 보관함은
  // 첫 저장(handleConfirmTitle) payload에 함께 실려 나간다.
  const persistBins = useCallback(
    (nextBins: Bin[]) => {
      const cid = constellationIdRef.current;
      if (!cid) return;
      const payload = nextBins.map(mapBinToBinDto);
      enqueueMutation(() => putBins(cid, payload));
    },
    [enqueueMutation]
  );

  // 마운트 시: 로그인된 유저의 가장 최근 별자리를 불러온다. 하나도 없으면
  // 데모 시드를 그대로 유지한다(비로그인과 동일하게 로컬에서 시작). 로그인
  // 안 됐으면(또는 아직 로딩 중이면) 아무 것도 하지 않는다 - 화면은 완전히
  // 로컬 데모로만 굴러간다.
  useEffect(() => {
    if (authLoading) return; // 로딩 중엔 아무 것도 정착시키지 않는다.
    if (!user) {
      // 비로그인도 렌즈->대화->추천 시안 체인을 그대로 탄다(사용자 결정 - 제한은
      // 저장 시점에 건다). 대화를 닫으면 데모 시드가 남는다.
      setBootState("empty");
      setIntakeOpen(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listConstellations();
        if (cancelled) return;
        // 플로우 규칙(사용자 확정): "띄우기 이전(작업 중)" 별자리가 있을 때만
        // 대화·추천 시안을 건너뛰고 바로 캔버스로 온다. 별자리가 하나도 없거나
        // 전부 띄운(발행된) 상태면 새 별자리를 위해 대화부터 다시 거친다 -
        // 발행본은 프로필/피드에 그대로 남고, 완료 핸들러가 항상 새 문서로
        // 시작하므로 덮어쓸 위험은 없다.
        const inProgress = list
          .filter((c) => !c.isPublished)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!inProgress) {
          setBootState("empty");
          setIntakeOpen(true);
          return;
        }
        const latest = inProgress;
        const noteDtos = await listNotes(latest.id);
        if (cancelled) return;

        const loadedNodes: Record<string, CanvasNode> = {};
        for (const dto of Object.values(latest.nodes)) {
          loadedNodes[dto.id] = {
            id: dto.id,
            label: dto.label,
            type: dto.type,
            isCompleted: dto.isCompleted,
            position: dto.position,
            level: dto.level,
            code: dto.code,
            description: dto.description,
            color: dto.color,
          };
        }
        const loadedEdges: Record<string, CanvasEdge> = {};
        for (const dto of Object.values(latest.edges)) {
          loadedEdges[dto.id] = { id: dto.id, sourceNodeId: dto.sourceNodeId, targetNodeId: dto.targetNodeId };
        }
        const loadedNotes: Record<string, ElementNote> = {};
        for (const dto of noteDtos) {
          loadedNotes[dto.id] = {
            id: dto.id,
            nodeId: dto.nodeId,
            title: dto.title,
            body: dto.body,
            isPublic: dto.isPublic,
            attachments: dto.attachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, url: a.url })),
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt,
          };
        }

        setNodes(loadedNodes);
        setEdges(loadedEdges);
        // 볼트=원본, 서버=유료 동기화 예정 - 볼트가 이미 연결/하이드레이트됐으면
        // (위 볼트 복원 이펙트) 서버에서 받은 노트로 덮어쓰지 않는다.
        if (!vaultHandleRef.current) setNotes(loadedNotes);
        if (latest.bins) setBins(latest.bins.map(mapBinDtoToBin));
        setConstellationId(latest.id);
        setIsPublished(latest.isPublished);
        setLaunchDescription(latest.description ?? "");
        setLaunchContributors(latest.contributors ?? []);
        constellationTitleRef.current = latest.title;
        setSaveState("saved");
        setBootState("loaded");
        // 기존 별자리가 있으면 대화를 다시 시키지 않는다(사용자 지시: "이미
        // 만들고 있었으면 처음부터 다시 대화하게 하면 안 된다"). 바로 이어서
        // 편집하고, 새로 시작하고 싶을 때만 보관함의 "새 별자리 만들기"로
        // 대화를 연다.
        setIntakeOpen(false);
      } catch (err) {
        // 초기 로드 실패는 조용히 데모 상태로 남긴다 - 화면이 죽으면 안 된다.
        // 기존 별자리가 있는 사용자일 수 있으므로 대화를 강제로 띄우지 않는다
        // (일시 오류 때마다 처음부터 대화하게 되는 역효과 방지).
        console.error("[constellation] 초기 로드 실패", err);
        setBootState("loaded");
        setIntakeOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // Intake 대화 오버레이는 위 boot effect의 각 정착 지점(empty/loaded/에러)이
  // setBootState와 같은 동기 블록에서 직접 연다(사용자 지시: "/constellation/new은
  // 항상 대화부터" - 이미 저장된 별자리가 있어도 예외 없음). 기존 별자리가 있으면
  // 대화 화면 우상단에 안내 배지가 뜨고, 그걸 눌러 닫으면(onDismiss) 불러온
  // 별자리가 그대로 드러난다.

  function nodeToCreateInput(node: CanvasNode): NodeCreateInput {
    return {
      id: node.id,
      label: node.label,
      type: node.type,
      position: node.position,
      code: node.code,
      description: node.description,
      level: node.level ?? undefined,
      color: node.color,
    };
  }

  // 저장 버튼 - 비로그인이면 로그인으로 안내, 이미 별자리가 있으면(자동으로
  // 계속 저장되는 중이므로) 할 일이 없고, 아직 한 번도 저장 안 됐으면 제목
  // 모달을 연다.
  const handleSaveClick = useCallback(() => {
    if (!user) {
      window.alert("로그인 후 저장할 수 있어요.");
      router.push("/login");
      return;
    }
    if (constellationId) return;
    // Intake 대화에서 다듬어진 목표가 있으면 기본 제목으로 미리 채워 준다 -
    // 사용자가 굳이 똑같은 말을 다시 타이핑하지 않아도 되게.
    setTitleInput(goalTextRef.current ?? "");
    setTitleModalOpen(true);
  }, [user, constellationId, router]);

  // 첫 저장(별자리 생성) - 지금까지 로컬에만 있던 노드/엣지/보관함을 통째로
  // 실어 보낸 뒤, 완료 표시된 노드(NodeCreateIn엔 isCompleted가 없다)와 기존
  // 로컬 노트들을 뮤테이션 큐에 태워 순서대로 뒤따라 보낸다.
  const handleConfirmTitle = useCallback(async () => {
    const title = titleInput.trim() || "제목 없는 별자리";
    setTitleModalOpen(false);
    setSaveState("saving");
    try {
      const nodeInputs = Object.values(nodesRef.current).map(nodeToCreateInput);
      const edgeInputs: EdgeCreateInput[] = Object.values(edgesRef.current).map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
      }));
      const binInputs: BinDto[] = binsRef.current.map(mapBinToBinDto);
      const created = await createConstellation({
        title,
        goalRawText: title,
        nodes: nodeInputs,
        edges: edgeInputs,
        bins: binInputs,
      });
      constellationTitleRef.current = title;
      setConstellationId(created.id);

      let anyEnqueued = false;
      for (const node of Object.values(nodesRef.current)) {
        if (node.isCompleted) {
          anyEnqueued = true;
          enqueueMutation(() => patchNodeCompletion(created.id, node.id, true));
        }
      }
      for (const note of Object.values(notesRef.current)) {
        anyEnqueued = true;
        enqueueMutation(() =>
          createNote(created.id, {
            id: note.id,
            nodeId: note.nodeId,
            title: note.title,
            body: note.body,
            isPublic: note.isPublic,
            attachments: [],
          })
        );
      }
      if (!anyEnqueued) setSaveState("saved");
    } catch (err) {
      console.error("[constellation] 별자리 생성 실패", err);
      setSaveState("error");
    }
  }, [titleInput, enqueueMutation]);

  // 발행 행위 자체는 이제 "별자리 띄우기" 모달(handleLaunchSubmit)로
  // 일원화됐다 - 좌상단 툴바에는 발행 상태를 보여주는 칩만 남는다(사용자 지시).

  // 색 팔레트에서 스와치를 고른 결과 - 낙관적 로컬 갱신 후, 저장된 별자리면
  // 뮤테이션 큐로 흘려보낸다(기존 handleNodeDrag 등과 동일한 패턴). 미저장
  // (익명 포함)이면 로컬 state만 바뀌고, 이후 저장 시 nodeToCreateInput이
  // node.color를 그대로 실어 나른다.
  const handleNodeColorChange = useCallback(
    (nodeId: string, color: string) => {
      setNodes((prev) => (prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], color } } : prev));
      const cid = constellationIdRef.current;
      if (cid) enqueueMutation(() => patchNodeColor(cid, nodeId, color));
    },
    [enqueueMutation]
  );

  // 편집 모드 진입/이탈 - 진입 시 열려 있던 정보 카드는 캔버스의
  // suppressInfoCard가 가려주므로 여기서는 팔레트만 확실히 닫아 둔다(이전
  // 세션에서 열려 있던 팔레트가 다음 편집 모드에 이어지지 않게).
  const handleToggleEditMode = useCallback(() => {
    setEditMode((prev) => !prev);
    setPaletteNodeId(null);
  }, []);

  // 캔버스의 선택 활성화 지점(activateNode)마다 호출된다 - 편집 모드가 아니면
  // 아무 것도 하지 않는다(일반 모드는 기본 정보 팝오버가 그대로 담당).
  const handleNodeActivate = useCallback(
    (nodeId: string) => {
      if (!editMode) return;
      setPaletteNodeId(nodeId);
    },
    [editMode]
  );

  // "별자리 띄우기" 제출 - 로그인 + 미저장이면 모달의 이름으로 먼저 생성한
  // 뒤(기존 handleConfirmTitle과 같은 payload 구성) 발행 패치까지 이어서
  // 보낸다. 이미 저장된 별자리면 발행 패치 하나만 보낸다. 에러는 그대로
  // 던져 LaunchModal이 인라인 에러를 보여주게 한다.
  const handleLaunchSubmit = useCallback(
    async (input: LaunchInput) => {
      let cid = constellationIdRef.current;
      if (!cid) {
        const nodeInputs = Object.values(nodesRef.current).map(nodeToCreateInput);
        const edgeInputs: EdgeCreateInput[] = Object.values(edgesRef.current).map((e) => ({
          id: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
        }));
        const binInputs: BinDto[] = binsRef.current.map(mapBinToBinDto);
        const created = await createConstellation({
          title: input.title,
          goalRawText: input.title,
          nodes: nodeInputs,
          edges: edgeInputs,
          bins: binInputs,
        });
        cid = created.id;
        constellationTitleRef.current = input.title;
        setConstellationId(cid);

        let anyEnqueued = false;
        for (const node of Object.values(nodesRef.current)) {
          if (node.isCompleted) {
            anyEnqueued = true;
            enqueueMutation(() => patchNodeCompletion(created.id, node.id, true));
          }
        }
        for (const note of Object.values(notesRef.current)) {
          anyEnqueued = true;
          enqueueMutation(() =>
            createNote(created.id, {
              id: note.id,
              nodeId: note.nodeId,
              title: note.title,
              body: note.body,
              isPublic: note.isPublic,
              attachments: [],
            })
          );
        }
        if (!anyEnqueued) setSaveState("saved");
      }

      const updated = await patchPublish(cid, {
        isPublished: input.isPublished,
        title: input.title,
        description: input.description,
        contributors: input.contributors,
      });
      constellationTitleRef.current = input.title;
      setIsPublished(updated.isPublished);
      setLaunchDescription(input.description);
      setLaunchContributors(input.contributors);
      setLaunchModalOpen(false);
      if (input.isPublished) {
        // 발행 칩("발행됨")이 이미 위 setIsPublished로 전환됐으니, 그 칩에
        // 잠깐 별빛 발광을 얹어 "띄워졌다"는 걸 알린다 - alert 대신.
        setJustPublished(true);
        setTimeout(() => setJustPublished(false), 2600);
      }
    },
    [enqueueMutation]
  );

  // "새 별자리 만들기" - 지금 편집 중인 별자리(서버에 있든 로컬 데모든)를
  // 완전히 접고 빈 캔버스 + Intake 대화로 되돌아간다. INITIAL_* 시드는 다시
  // 쓰지 않는다(진짜 빈 캔버스에서 새로 시작). 노트 첨부의 blob: URL은
  // handleDeleteNote/handleNodeDelete와 같은 이유로 여기서도 회수해야 한다 -
  // 안 그러면 별자리를 여러 번 새로 만들 때마다 계속 샌다.
  const handleStartNewConstellation = useCallback(() => {
    Object.values(notesRef.current).forEach((note) => {
      note.attachments.forEach((att) => URL.revokeObjectURL(att.url));
    });
    fillPollsRef.current.forEach((interval) => clearInterval(interval));
    fillPollsRef.current.clear();
    setConstellationId(null);
    setNodes({});
    setEdges({});
    setNotes({});
    setBins([]);
    setDraftOffer(null);
    setSaveState("unsaved");
    setPanelMode("bins");
    setNotesNodeId(null);
    setIsPublished(false);
    setLaunchDescription("");
    setLaunchContributors([]);
    pendingMutationsRef.current = 0;
    goalTextRef.current = null;
    constellationTitleRef.current = null;
    setIntakeOpen(true);
  }, []);

  // Intake 대화가 끝나(구간 잡까지 완료) 넘겨준 보관함으로 캔버스를 채운다.
  // 캔버스 노드/엣지는 건드리지 않는다 - 원소를 캔버스에 놓는 건 항상 사용자의
  // 드래그/Enter로만 일어난다(placeItem). 여기서 만든 보관함은 아직 서버
  // 별자리가 없으면(cid 없음) persistBins가 조용히 아무 것도 안 하고, 첫
  // 저장(handleConfirmTitle) payload에 함께 실려 나간다.
  const handleIntakeComplete = useCallback(
    (dtoBins: BinDto[], goalText: string, drafts?: DraftDto[]) => {
      // 대화 완료는 항상 "새 별자리 시작"이다 - 로그인 유저가 기존 별자리를
      // 불러온 채로(우상단 "별자리가 이미 있어요" 배지를 무시하고) 대화까지
      // 끝냈다면, 그 초안이 기존 별자리를 덮어쓰면 안 되므로 여기서
      // handleStartNewConstellation과 같은 리셋을 먼저 수행한다(첨부 URL 회수
      // 포함). constellationIdRef는 setConstellationId(null)이 반영되기 전에
      // 바로 아래 persistBins가 읽으므로, state와 별개로 동기적으로도 지운다.
      Object.values(notesRef.current).forEach((note) => {
        note.attachments.forEach((att) => URL.revokeObjectURL(att.url));
      });
      fillPollsRef.current.forEach((interval) => clearInterval(interval));
      fillPollsRef.current.clear();
      constellationIdRef.current = null;
      setConstellationId(null);
      setNotes({});
      setSaveState("unsaved");
      setIsPublished(false);
      setLaunchDescription("");
      setLaunchContributors([]);
      pendingMutationsRef.current = 0;
      constellationTitleRef.current = null;

      goalTextRef.current = goalText;
      const mapped = dtoBins.map(mapBinDtoToBin);
      setBins(mapped);
      // cid가 이제 없으므로 조용히 no-op - bins는 첫 저장(handleConfirmTitle)
      // payload에 함께 실려 나간다. 그래도 호출은 그대로 둔다 - 이 화면이
      // 나중에 로그인 유저의 "빈 별자리를 먼저 만들어 두고 시작" 흐름으로
      // 바뀌면 이 한 줄만으로 다시 살아난다.
      persistBins(mapped);
      setIntakeOpen(false);
      if (drafts && drafts.length > 0) {
        // 초안 미리보기 단계로 진입 - 첫 안을 캔버스 그래프 state에 그려 둔다.
        // 실제 화면 표시는 DraftReviewStage 전용 무대가 맡고, 확정 전까지는
        // 메인 캔버스에 노출되지 않는다.
        const { nodes: draftNodes, edges: draftEdges } = buildDraftGraph(drafts[0], mapped);
        setNodes(draftNodes);
        setEdges(draftEdges);
        setDraftOffer({ drafts, selected: 0 });
      } else {
        // 초안이 없어도 "새 별자리 시작"이라는 원칙은 같다 - 이전 그래프를
        // 캔버스에 남겨두지 않는다.
        setNodes({});
        setEdges({});
        setDraftOffer(null);
      }
    },
    [persistBins]
  );

  // "추천 별자리" 패널에서 다른 안을 고르면 캔버스 전체를 그 안의 그래프로
  // 교체한다(현재 작업 그래프를 대체 - 초안 미리보기 단계에선 nodes/edges가
  // 곧 "지금 보여줄 안"이라는 뜻이므로 별도 프리뷰 state를 두지 않는다).
  const handleSelectDraft = useCallback(
    (index: number) => {
      setDraftOffer((prev) => {
        if (!prev || !prev.drafts[index]) return prev;
        const { nodes: draftNodes, edges: draftEdges } = buildDraftGraph(prev.drafts[index], binsRef.current);
        setNodes(draftNodes);
        setEdges(draftEdges);
        return { ...prev, selected: index };
      });
    },
    []
  );

  // "이 별자리로 시작" - 지금 캔버스에 그려진 선택된 안을 그대로 작업 그래프로
  // 확정한다(nodes/edges는 이미 그 안이므로 딱히 손댈 게 없다). 저장은 여전히
  // 사용자가 저장 버튼을 눌러야 일어난다(기존 흐름 그대로).
  const handleAcceptDraft = useCallback(() => {
    setDraftOffer(null);
    fitTokenRef.current += 1;
    setFitRequest(fitTokenRef.current);
  }, []);

  // "직접 그릴래요" - 초안 미리보기를 버리고 완전히 빈 캔버스로 돌아간다.
  // 보관함(bins)은 그대로 남아 있어 사용자가 거기서부터 손으로 채울 수 있다.
  const handleRejectDrafts = useCallback(() => {
    setNodes({});
    setEdges({});
    setDraftOffer(null);
  }, []);

  // 노트를 nodeId별로 묶는다. 이 그룹의 length가 카드의 "노트 N개"를 결정하는
  // 유일한 진실 - INITIAL_NODES에 박아 둔 정적 noteCount는 초기 렌더 한 번을
  // 위한 시드값일 뿐, 실제로 보이는 값은 항상 아래 nodesWithNoteCounts에서
  // notes state로부터 다시 계산한 값으로 덮어쓴다.
  const notesByNode = useMemo(() => {
    const map = new Map<string, ElementNote[]>();
    for (const note of Object.values(notes)) {
      const list = map.get(note.nodeId) ?? [];
      list.push(note);
      map.set(note.nodeId, list);
    }
    return map;
  }, [notes]);

  // 카드에 보여줄 노드 - noteCount만 notes state 기준 실측치로 교체한다.
  // 0개면 undefined로 되돌려 "노트 추가"(0개와는 다른 빈 상태 문구)가 뜨게 한다.
  const nodesWithNoteCounts = useMemo(() => {
    let changed = false;
    const next: Record<string, CanvasNode> = { ...nodes };
    for (const id of Object.keys(nodes)) {
      const count = notesByNode.get(id)?.length;
      const truthfulCount = count && count > 0 ? count : undefined;
      if (nodes[id].noteCount !== truthfulCount) {
        next[id] = { ...nodes[id], noteCount: truthfulCount };
        changed = true;
      }
    }
    return changed ? next : nodes;
  }, [nodes, notesByNode]);

  // 라벨로 노드를 찾는 인덱스 - [[위키링크]] 해석용. 라벨 중복은 데모 데이터
  // 범위에서 고려하지 않고, 먼저 찾은 것을 쓴다(케이스 정확 일치만).
  const nodeByLabel = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const n of Object.values(nodes)) {
      if (!map.has(n.label)) map.set(n.label, n);
    }
    return map;
  }, [nodes]);

  const resolveWikiLink: ResolveWikiLink = useCallback(
    (label: string) => {
      const target = nodeByLabel.get(label);
      return target ? { nodeId: target.id } : undefined;
    },
    [nodeByLabel]
  );

  const placedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of Object.keys(nodes)) {
      if (id.startsWith("element:")) ids.add(id.slice("element:".length));
    }
    return ids;
  }, [nodes]);

  const placeItem = useCallback(
    (item: BinItem, position: CanvasPosition) => {
      const nodeId = nodeIdForItem(item.id);
      if (nodesRef.current[nodeId]) return; // 중복 드롭 - 무시
      const { code, label } = deriveNodeCodeAndLabel(item);
      const newNode: CanvasNode = {
        id: nodeId,
        label,
        type: item.type,
        isCompleted: false,
        position,
        level: item.level ?? null,
        code,
        description: item.description,
      };
      setNodes((prev) => (prev[nodeId] ? prev : { ...prev, [nodeId]: newNode }));
      const cid = constellationIdRef.current;
      if (cid) enqueueMutation(() => addNode(cid, nodeToCreateInput(newNode)));
    },
    [enqueueMutation]
  );

  const handleExternalDrop = useCallback(
    (data: string, position: CanvasPosition) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      // 보관함 헤더를 통째로 끌어놓은 경우 - 보관함 하나를 찾아 아직 캔버스에
      // 없는 원소만 나선형으로 펼쳐 놓는다(단일 원소 placeItem과 동일하게
      // 중복은 조용히 무시).
      if (isBinDropPayload(parsed)) {
        const bin = bins.find((b) => b.id === parsed.binId);
        if (!bin) return;
        const unplaced = [...bin.items]
          .sort((a, b) => {
            const la = typeof a.level === "number" ? a.level : Number.POSITIVE_INFINITY;
            const lb = typeof b.level === "number" ? b.level : Number.POSITIVE_INFINITY;
            return la - lb;
          })
          .filter((item) => !nodes[nodeIdForItem(item.id)]);
        unplaced.forEach((item, i) => placeItem(item, spiralOffset(i, position)));
        return;
      }
      const item = parsed as BinItem;
      if (!item?.id || !item?.label) return;
      placeItem(item, position);
    },
    [placeItem, bins, nodes]
  );

  // 보관함에 사용자가 직접 원소를 추가한다(모든 보관함에서 허용 - LLM이 놓친
  // 과목/자격증 등을 손으로 채울 수 있어야 하므로 origin이 "llm"이어도 막지
  // 않는다). id는 여기서 생성해 항상 유일함을 보장한다.
  const handleAddItem = useCallback(
    (binId: string, item: Omit<BinItem, "id">) => {
      userItemCounter += 1;
      const id = `item-user-${userItemCounter}`;
      setBins((prev) => {
        const next = prev.map((bin) =>
          bin.id === binId ? { ...bin, items: [...bin.items, { id, ...item }] } : bin
        );
        persistBins(next);
        return next;
      });
    },
    [persistBins]
  );

  const handleNodeDrag = useCallback(
    (nodeId: string, position: CanvasPosition) => {
      setNodes((prev) => (prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], position } } : prev));
      const cid = constellationIdRef.current;
      // 드래그는 이미 drag-end에서 한 번만 발화하므로(ConstellationCanvas 참고)
      // 별도 디바운스 없이 그대로 큐에 태운다.
      if (cid) enqueueMutation(() => patchNodePosition(cid, nodeId, position));
    },
    [enqueueMutation]
  );

  const handleNodeToggleComplete = useCallback(
    (nodeId: string) => {
      const current = nodesRef.current[nodeId];
      if (!current) return;
      const nextCompleted = !current.isCompleted;
      setNodes((prev) =>
        prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], isCompleted: nextCompleted } } : prev
      );
      const cid = constellationIdRef.current;
      if (cid) enqueueMutation(() => patchNodeCompletion(cid, nodeId, nextCompleted));
    },
    [enqueueMutation]
  );

  // 잇기는 토글이다: 이미 이어진 쌍(방향 무관)을 다시 이으면 끊어지고, 아니면
  // 새로 이어진다 - 절대 같은 쌍에 두 번째 엣지를 만들지 않는다. 캔버스는
  // drag-to-connect와 툴바의 "잇기" 양쪽 모두 이 콜백 하나로 들어오므로, 토글
  // 규칙을 캔버스가 아니라 그래프 상태를 들고 있는 여기 한 곳에만 둔다 -
  // 캔버스의 props API(연결 "생성"이라는 이름)는 그대로 유지된다.
  const handleEdgeCreate = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      if (sourceNodeId === targetNodeId) return;
      const existing = Object.values(edgesRef.current).find(
        (e) =>
          (e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId) ||
          (e.sourceNodeId === targetNodeId && e.targetNodeId === sourceNodeId)
      );
      const cid = constellationIdRef.current;
      if (existing) {
        const existingId = existing.id;
        setEdges((prev) => {
          const next = { ...prev };
          delete next[existingId];
          return next;
        });
        if (cid) enqueueMutation(() => deleteEdge(cid, existingId));
        return;
      }
      const id = makeId("edge-local");
      setEdges((prev) => ({ ...prev, [id]: { id, sourceNodeId, targetNodeId } }));
      if (cid) enqueueMutation(() => addEdge(cid, { id, sourceNodeId, targetNodeId }));
    },
    [enqueueMutation]
  );

  const handleEdgeDelete = useCallback(
    (edgeId: string) => {
      setEdges((prev) => {
        const next = { ...prev };
        delete next[edgeId];
        return next;
      });
      const cid = constellationIdRef.current;
      if (cid) enqueueMutation(() => deleteEdge(cid, edgeId));
    },
    [enqueueMutation]
  );

  // 노드 삭제(툴바 "삭제") - 노드 자체, 그 노드를 참조하는 엣지, 그리고 그
  // 노드에 달린 노트까지 함께 정리한다. 노트를 남겨두면 ElementNotesPanel의
  // 탭 바에 "고스트 탭"(제목만 남고 다시 열면 아무것도 안 뜨는 죽은 탭)이
  // 생기고, 그 노트가 물고 있던 첨부 object URL도 회수되지 않아 새는 것과
  // 같아진다 - handleDeleteNote가 개별 삭제 때 하는 정리를 여기서도 그대로
  // 반복한다.
  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      const existed = !!nodesRef.current[nodeId];
      setNodes((prev) => {
        if (!prev[nodeId]) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setEdges((prev) => {
        const next: Record<string, CanvasEdge> = {};
        let changed = false;
        for (const [id, edge] of Object.entries(prev)) {
          if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
            changed = true;
            continue;
          }
          next[id] = edge;
        }
        return changed ? next : prev;
      });
      setNotes((prev) => {
        const next: Record<string, ElementNote> = {};
        let changed = false;
        // 볼트=원본, 서버=유료 동기화 예정 - 볼트 모드 노트는 서버 cascade가
        // 모르는 파일이므로(애초에 서버로 보낸 적 없음) 여기서 직접 지운다.
        const vh = vaultHandleRef.current;
        for (const [id, note] of Object.entries(prev)) {
          if (note.nodeId === nodeId) {
            changed = true;
            note.attachments.forEach((att) => URL.revokeObjectURL(att.url));
            if (vh) {
              deleteVaultNote(vh, id).catch((err) =>
                console.error("[vault] 노드 삭제 연쇄 - 노트 삭제 실패", err)
              );
            }
            continue;
          }
          next[id] = note;
        }
        return changed ? next : prev;
      });
      // 서버는 노드 삭제 시 그 노드에 달린 엣지/노트까지 함께 정리한다(cascade) -
      // 로컬에서 이미 위에서 정리한 것과 같은 결과이므로(볼트 노트는 위에서
      // 직접 지웠고, 서버 노트는 서버가 cascade) 별도 엣지/노트 삭제 호출은
      // 필요 없다. 노드/엣지 자체는 볼트 브리지 범위 밖이라 그대로 서버로 간다.
      const cid = constellationIdRef.current;
      if (existed && cid) enqueueMutation(() => deleteNode(cid, nodeId));
    },
    [enqueueMutation]
  );

  // "노트 N개 ›" 클릭 - 오른쪽 패널을 「군집」에서 「노트」로 스왑한다(새 영역을
  // 여는 게 아니라 같은 자리를 교체) + 상단 탭 선택도 「노트」로 옮긴다.
  const handleOpenNotes = useCallback((nodeId: string) => {
    setNotesNodeId(nodeId);
    setNotesExpandToken((t) => t + 1);
    setPanelMode("notes");
  }, []);

  // 상단 탭 클릭 - 유일한 모드 전환 지점. 「노트」를 눌러도 notesNodeId는
  // 건드리지 않는다(마지막으로 보던 원소의 노트를 그대로 보여주는 게 자연스럽고,
  // 선택된 적이 없으면 패널이 알아서 빈 상태를 보여준다).
  const handleTabChange = useCallback((mode: PanelMode) => {
    setPanelMode(mode);
    // 노트 패널을 벗어나면 확대 오버레이(body 포털)도 함께 닫는다 - 안 그러면
    // 세그먼트를 「군집」으로 바꿔도 확대된 편집기가 화면에 그대로 남는다.
    if (mode !== "notes") setIsNoteExpanded(false);
  }, []);

  // 상태 줄의 "로컬 볼트 연결" 버튼 - 사용자가 폴더를 고르면 그 즉시 그
  // 폴더의 notes/*.md로 notes state를 하이드레이트한다(볼트=원본, 서버=유료
  // 동기화 예정).
  const handleConnectVault = useCallback(async () => {
    const handle = await connectVault();
    if (!handle) return; // 사용자가 선택기를 취소함
    setVaultHandle(handle);
    setVaultNeedsPermission(false);
    try {
      const vaultNotes = await listVaultNotes(handle);
      const map: Record<string, ElementNote> = {};
      for (const n of vaultNotes) map[n.id] = n;
      setNotes(map);
    } catch (err) {
      console.error("[vault] 노트 목록 읽기 실패", err);
    }
  }, []);

  // 상태 줄의 "해제" 버튼 - IndexedDB의 핸들만 지운다. 화면에 이미 떠 있는
  // notes state는 그대로 두고(방금까지 보던 내용이 갑자기 사라지면 당황스럽다),
  // 이후 노트 편집은 다시 서버 경로로 흐른다.
  const handleDisconnectVault = useCallback(async () => {
    await disconnectVault();
    setVaultHandle(null);
    setVaultNeedsPermission(false);
  }, []);

  // 상태 줄의 "권한 다시 허용" 버튼 - requestPermission은 사용자 제스처
  // 안에서만 통하므로 반드시 클릭 핸들러에서 호출해야 한다.
  const handleRequestVaultPermission = useCallback(async () => {
    if (!vaultHandle) return;
    const granted = await requestVaultPermission(vaultHandle);
    if (!granted) return;
    setVaultNeedsPermission(false);
    try {
      const vaultNotes = await listVaultNotes(vaultHandle);
      const map: Record<string, ElementNote> = {};
      for (const n of vaultNotes) map[n.id] = n;
      setNotes(map);
    } catch (err) {
      console.error("[vault] 노트 목록 읽기 실패", err);
    }
  }, [vaultHandle]);

  const handleCreateNote = useCallback(
    (nodeId: string, input: { title: string; body: string; isPublic: boolean; attachments: ElementNote["attachments"] }) => {
      const id = makeId("note-local");
      const now = Date.now();
      setNotes((prev) => ({
        ...prev,
        [id]: {
          id,
          nodeId,
          title: input.title,
          body: input.body,
          isPublic: input.isPublic,
          attachments: input.attachments,
          createdAt: now,
          updatedAt: now,
        },
      }));
      // 볼트=원본, 서버=유료 동기화 예정 - 볼트 연결 시 노트는 로컬 .md 파일에만
      // 쓰고 서버로는 보내지 않는다(이중 원본 금지).
      const vh = vaultHandleRef.current;
      if (vh) {
        const nodeLabel = nodesRef.current[nodeId]?.label ?? "";
        writeVaultNote(
          vh,
          { id, nodeId, title: input.title, body: input.body, isPublic: input.isPublic, attachments: [], createdAt: now, updatedAt: now },
          nodeLabel
        ).catch((err) => console.error("[vault] 노트 저장 실패", err));
      } else {
        const cid = constellationIdRef.current;
        if (cid) {
          // 첨부는 아직 blob: URL이라 새로고침에 못 살아남는다(Storage 업로드는
          // 이후 단계) - 서버에는 빈 배열로 보내 로컬 UX만 유지한다.
          enqueueMutation(() =>
            createNote(cid, {
              id,
              nodeId,
              title: input.title,
              body: input.body,
              isPublic: input.isPublic,
              attachments: [],
            })
          );
        }
      }
      // 자동저장: 새 노트 편집기가 첫 유의미한 입력에서 이 id로 노트를 만들고,
      // 이후 타이핑은 이 id로 onUpdateNote를 호출해야 하므로 id를 돌려준다.
      return id;
    },
    [enqueueMutation]
  );

  const handleUpdateNote = useCallback(
    (noteId: string, patch: { title: string; body: string; isPublic: boolean; attachments: ElementNote["attachments"] }) => {
      const now = Date.now();
      // patch 이전(직전 렌더 기준) 노트 - nodeId/createdAt은 patch에 없으므로
      // 볼트에 쓸 때 여기서 이어받는다.
      const prevNote = notesRef.current[noteId];
      setNotes((prev) =>
        prev[noteId] ? { ...prev, [noteId]: { ...prev[noteId], ...patch, updatedAt: now } } : prev
      );
      // 볼트=원본, 서버=유료 동기화 예정.
      const vh = vaultHandleRef.current;
      if (vh && prevNote) {
        const nodeLabel = nodesRef.current[prevNote.nodeId]?.label ?? "";
        writeVaultNote(
          vh,
          {
            id: noteId,
            nodeId: prevNote.nodeId,
            title: patch.title,
            body: patch.body,
            isPublic: patch.isPublic,
            attachments: [],
            createdAt: prevNote.createdAt,
            updatedAt: now,
          },
          nodeLabel
        ).catch((err) => console.error("[vault] 노트 갱신 실패", err));
      } else if (!vh) {
        const cid = constellationIdRef.current;
        if (cid) {
          enqueueMutation(() =>
            patchNote(cid, noteId, {
              title: patch.title,
              body: patch.body,
              isPublic: patch.isPublic,
              attachments: [],
            })
          );
        }
      }
    },
    [enqueueMutation]
  );

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      const existed = !!notesRef.current[noteId];
      setNotes((prev) => {
        if (!prev[noteId]) return prev;
        // 이 노트가 물고 있던 첨부 object URL도 함께 회수한다 - 노트가
        // 사라지면 그 이미지들을 다시 볼 방법이 없으므로 계속 들고 있을 이유가 없다.
        prev[noteId].attachments.forEach((att) => URL.revokeObjectURL(att.url));
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
      // 볼트=원본, 서버=유료 동기화 예정.
      const vh = vaultHandleRef.current;
      if (vh) {
        if (existed) deleteVaultNote(vh, noteId).catch((err) => console.error("[vault] 노트 삭제 실패", err));
      } else {
        const cid = constellationIdRef.current;
        if (existed && cid) enqueueMutation(() => deleteNote(cid, noteId));
      }
    },
    [enqueueMutation]
  );

  // 노트 본문 안의 [[위키링크]] 클릭 - 그 원소를 캔버스에서 선택하고, 노트
  // 패널도 그 원소로 전환한다. 캔버스는 selectedNodeId를 내부 state로만
  // 들고 있어 밖에서 직접 선택시킬 수 없으므로, "이 노드를 선택하라"는 요청을
  // ConstellationCanvas의 focusNodeId prop으로 전달한다(아래 렌더 참고).
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  // 시안 확정("이 별자리로 시작") 직후 캔버스가 화면 밖에 걸리는 문제 - 확정
  // 시점에 이 카운터를 올려 ConstellationCanvas의 fit-to-content를 1회
  // 발동시킨다(값 자체가 아니라 매번 바뀌는 숫자가 신호 - focusRequest와 같은
  // token 문법).
  const [fitRequest, setFitRequest] = useState<number | null>(null);
  const fitTokenRef = useRef(0);
  const handleNoteLinkClick = useCallback((nodeId: string) => {
    focusTokenRef.current += 1;
    setFocusRequest({ nodeId, token: focusTokenRef.current });
    setNotesNodeId(nodeId);
    setNotesExpandToken((t) => t + 1);
    setPanelMode("notes");
  }, []);

  // 이 보관함의 폴링을 끝낸다(성공/실패/만료 무관 공통 정리) - 인터벌 정리 +
  // 로딩 상태 해제. items는 건드리지 않는다(실패 시 그냥 빈 채로 남는다).
  const finishBinFill = useCallback((binId: string, patch?: { items: BinItem[]; advice?: string }) => {
    const interval = fillPollsRef.current.get(binId);
    if (interval) {
      clearInterval(interval);
      fillPollsRef.current.delete(binId);
    }
    setBins((prev) => {
      const next = prev.map((bin) =>
        bin.id === binId ? { ...bin, isLoading: false, ...(patch ?? {}) } : bin
      );
      if (patch) persistBins(next); // 실패 시엔 바뀐 게 없으니 다시 저장할 필요 없다.
      return next;
    });
  }, [persistBins]);

  // 사용자가 직접 만든 보관함 - LLM에게 실제로 채워 달라고 요청한다(구간 생성과
  // 같은 잡 폴링 패턴, ConstellationIntakeChat 참고). goalText는 Intake 대화가
  // 다듬어 준 원문을 최우선으로 쓰고, 없으면(대화 없이 기존 별자리를 불러온
  // 경우) 별자리 제목, 그마저 없으면 보관함 이름 자체로 대신한다.
  const handleCreateBin = useCallback(
    (label: string) => {
      const id = makeId("bin-user");
      setBins((prev) => {
        const next: Bin[] = [...prev, { id, label, origin: "user" as const, items: [], isLoading: true }];
        persistBins(next);
        return next;
      });

      const goal = goalTextRef.current ?? constellationTitleRef.current ?? label;
      startBinFillJob(goal, label)
        .then(({ jobId }) => {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts += 1;
            if (attempts > 120) {
              console.error("[constellation] 보관함 채우기 작업 시간 초과", { binId: id });
              finishBinFill(id);
              return;
            }
            getBinJob(jobId)
              .then((status) => {
                if (status.status === "done") {
                  const resultBin = status.result?.bins?.[0];
                  finishBinFill(
                    id,
                    resultBin
                      ? { items: resultBin.items.map(mapBinItemDtoToBinItem), advice: resultBin.advice }
                      : { items: [] }
                  );
                  return;
                }
                if (status.status === "error") {
                  console.error("[constellation] 보관함 채우기 실패", status.detail);
                  finishBinFill(id);
                }
                // pending/running이면 다음 tick에서 계속 폴링한다.
              })
              .catch((err: unknown) => {
                if (err instanceof ApiError && err.status === 404) {
                  // 잡이 인메모리라 서버 재시작 시 사라질 수 있다 - 만료로 취급.
                  console.error("[constellation] 보관함 채우기 작업 만료", err);
                  finishBinFill(id);
                  return;
                }
                // 그 외 일시적 오류는 다음 폴링 tick에서 다시 시도한다.
              });
          }, 1500);
          fillPollsRef.current.set(id, interval);
        })
        .catch((err: unknown) => {
          console.error("[constellation] 보관함 채우기 시작 실패", err);
          finishBinFill(id);
        });
    },
    [persistBins, finishBinFill]
  );

  // 팔레트가 실제로 화면에 뜰지 - ColorPaletteBar의 렌더 조건과 정확히
  // 같은 식이어야 한다(아래 세 곳에서 재사용). 모바일에서 팔레트는 항상
  // 거의 전체 폭(92vw)으로 뜨므로, 열려 있는 동안은 편집/띄우기 버튼을
  // <md에서 숨겨 겹침 자체를 없앤다.
  const paletteOpen = editMode && !!paletteNodeId && !!nodes[paletteNodeId];

  return (
    // 그래프뷰 자체가 페이지의 배경 - 카드도 컬럼도 아니라 뷰포트를 꽉 채우는
    // 바닥이다. 레일/보관함 패널은 이 위에 뜨는 반투명 판(오버레이)일 뿐,
    // 캔버스의 폭을 나눠 갖지 않는다. 패닝/줌은 패널 마진 아래를 포함해
    // 화면 전체에서 동작해야 하므로 캔버스는 항상 inset-0.
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      <ConstellationCanvas
        nodes={nodesWithNoteCounts}
        edges={edges}
        onNodeDrag={handleNodeDrag}
        onNodeToggleComplete={handleNodeToggleComplete}
        onEdgeCreate={handleEdgeCreate}
        onEdgeDelete={handleEdgeDelete}
        onNodeDelete={handleNodeDelete}
        onOpenNotes={handleOpenNotes}
        onExternalDrop={handleExternalDrop}
        onNodeActivate={handleNodeActivate}
        suppressInfoCard={editMode}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
      />

      {/* 편집 모드 토글 - 우상단, 군집 패널과 안 겹치는 하늘 영역. 패널이
          접히면(아이콘 칩만 남음) 그만큼 안쪽으로 당겨 자리를 좁힌다.
          진입 시 버튼 자체가 "완성"으로 바뀌어 같은 자리에서 되돌아간다. */}
      <button
        type="button"
        aria-pressed={editMode}
        aria-label={editMode ? "편집 완료" : "요소 색상 편집 모드"}
        onClick={handleToggleEditMode}
        className={cn(
          "paper-surface fixed z-20 flex items-center gap-1.5 rounded-lg border border-paper-line bg-paper-soft/95 px-3 py-2 font-sans text-xs font-medium text-paper-ink shadow-panel backdrop-blur-md transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
          "right-3 top-3",
          isPanelCollapsed ? "md:right-[68px] md:top-4" : "md:right-[304px] md:top-3",
          paletteOpen && "max-md:hidden"
        )}
      >
        <EditPencilIcon />
        {editMode ? "완성" : "편집"}
      </button>

      {/* "별자리 띄우기" - 우하단, 군집 패널·네비 섬과 안 겹치는 자리. 접힘
          상태에서는 편집 버튼과 같은 규칙으로 안쪽으로 당긴다. 팔레트가 열린
          동안은 <md에서 숨긴다 - 팔레트가 92vw 폭이라 이 CTA를 그대로
          덮었었다(2026-08-28 검수). */}
      <div
        className={cn(
          "paper-surface fixed z-20",
          "right-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+46vh+24px)]",
          isPanelCollapsed ? "md:right-[68px] md:bottom-4" : "md:right-[304px] md:bottom-4",
          paletteOpen && "max-md:hidden"
        )}
      >
        <button
          type="button"
          onClick={() => setLaunchModalOpen(true)}
          className="cta-ink rounded-lg bg-paper-ink px-4 py-2.5 font-sans text-sm font-medium text-paper shadow-panel backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
        >
          별자리 띄우기
        </button>
      </div>

      {editMode && paletteNodeId && nodes[paletteNodeId] && (
        <ColorPaletteBar
          node={nodes[paletteNodeId]}
          onSelectColor={(color) => handleNodeColorChange(paletteNodeId, color)}
          onClose={() => setPaletteNodeId(null)}
        />
      )}

      <LaunchModal
        open={launchModalOpen}
        onClose={() => setLaunchModalOpen(false)}
        isLoggedIn={!!user}
        defaultTitle={constellationTitleRef.current ?? goalTextRef.current ?? ""}
        defaultDescription={launchDescription}
        defaultIsPublished={isPublished}
        defaultContributors={launchContributors}
        onLaunch={handleLaunchSubmit}
        onGoLogin={() => {
          setLaunchModalOpen(false);
          router.push("/login");
        }}
      />

      {/* 저장 버튼 + 상태 배지 - 좌상단에 뜨는 작은 오버레이. 별도 상단 툴바가
          없는 화면이라 아래 aside 패널과 같은 시각 언어(테두리/배경/블러)로
          새로 만들었다. 실제 저장은 항상 뮤테이션 큐가 알아서 흘려보내므로,
          버튼은 "아직 서버에 존재하지 않는 별자리"를 처음 만들 때만 의미가
          있다(제목 모달을 연다) - 이미 있으면 그냥 아무 것도 하지 않는다. */}
      {/* 섬 크롬 전환 이후 좌상단은 OurLab 로고 자리다(AppShell.tsx) - 툴바가
          겹치지 않도록 상단 중앙으로 옮겼다. 더 이상 풀높이 레일이 없으므로
          레일 폭을 피하던 옛 left-[208px] 계산은 필요 없다. */}
      <div className="paper-surface fixed left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-paper-line bg-paper-soft/95 px-3 py-2 shadow-panel backdrop-blur-md">
        <button
          type="button"
          onClick={handleSaveClick}
          className="cta-ink rounded-md bg-paper-ink px-3 py-1.5 font-sans text-xs font-medium text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
        >
          저장
        </button>
        <span className="font-sans text-xs text-paper-lo">{SAVE_STATE_LABEL[saveState]}</span>

        {/* 발행 상태 칩 - 발행 행위 자체는 "별자리 띄우기" 모달로 옮겼고,
            여기는 지금 발행 상태가 무엇인지만 보여준다(사용자 지시). */}
        <span className="mx-0.5 h-4 w-px bg-paper-line" aria-hidden />
        <span
          className={cn(
            "font-sans text-xs transition-shadow duration-700",
            // lit(별빛)은 종이 위에서 거의 안 보이는 대비라(둘 다 밝은 색조)
            // 어두운 잉크 칩 위에 얹어 별빛이 실제로 빛나 보이게 한다.
            isPublished
              ? "rounded-full bg-paper-ink px-1.5 py-0.5 font-semibold text-lit"
              : "text-paper-lo",
            // 방금 띄운 순간 - shadow-glow-bloom을 잠깐 얹었다 스스로 꺼진다
            // (handleLaunchSubmit의 justPublished 타이머 참고). window.alert
            // 클라이맥스를 대신하는 세계관 내 확인.
            justPublished && "shadow-glow-bloom"
          )}
        >
          {isPublished ? "발행됨" : "비공개"}
        </span>
      </div>

      {/* 로딩 베일 - bootState가 정착하기 전까지 캔버스/저장 툴바를 완전히
          가린다. 정착과 동시에(위 boot effect) intakeOpen도 true가 되므로
          베일이 걷히는 프레임에 곧장 대화 오버레이가 뜬다 - 메인 캔버스가
          먼저 노출됐다 대화가 뒤늦게 덮는 번쩍임을 막는 목적. z-[70]은 이
          파일 안의 다른 오버레이(z-20)와 인테이크/초안 무대(z-40)보다 위. */}
      {bootState === "loading" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900">
          <p className="animate-pulse font-serif text-sm text-text-lo">관측 준비 중…</p>
        </div>
      )}

      {intakeOpen && (
        <ConstellationIntakeChat
          onComplete={handleIntakeComplete}
          onDismiss={() => setIntakeOpen(false)}
          // 이 시점에 constellationId가 있으면(로그인 유저가 이미 별자리를 저장해
          // 둔 상태) 대화를 열기 전부터 있던 별자리라는 뜻이다 - 대화 완료 시엔
          // handleIntakeComplete가 이 값을 null로 리셋하므로, 대화 도중에는 이
          // 배지가 계속 "기존 별자리로 돌아갈 수 있다"는 뜻으로만 유효하다.
          existingNotice={constellationId ? "별자리가 이미 있어요" : undefined}
        />
      )}

      {/* 초안 검토 - 확정("이 별자리로 시작")/거절("직접 그릴래요") 전까지는
          메인 캔버스가 아니라 이 전용 무대만 보여준다(사용자 지시). 확정되면
          onConfirm이 draftOffer를 지워 이 무대가 닫히고, 이미 그려둔
          nodes/edges(handleAcceptDraft는 손대지 않음)가 그대로 메인 캔버스에
          드러난다 - 그게 곧 "메인 페이지로 이관"이다. */}
      {draftOffer && !intakeOpen && (
        <DraftReviewStage
          drafts={draftOffer.drafts}
          selected={draftOffer.selected}
          bins={bins}
          nodes={nodes}
          edges={edges}
          onSelect={handleSelectDraft}
          onConfirm={handleAcceptDraft}
          onReject={handleRejectDrafts}
        />
      )}

      <Modal open={titleModalOpen} onClose={() => setTitleModalOpen(false)} title="별자리 이름" size="sm">
        <div className="space-y-3">
          <input
            type="text"
            autoFocus
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirmTitle();
            }}
            placeholder="예: 경영학 복수전공 로드맵"
            className="w-full rounded-md border border-rule bg-ink-900 px-3 py-2 font-sans text-sm text-text-hi placeholder:text-text-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTitleModalOpen(false)}
              className="rounded-md px-3 py-1.5 font-sans text-sm text-text-lo hover:text-text-hi"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmTitle()}
              className="rounded-md bg-spec-b px-3 py-1.5 font-sans text-sm font-medium text-ink-900 hover:opacity-90"
            >
              만들기
            </button>
          </div>
        </div>
      </Modal>

      {/* 접힌 섬 아이콘 칩 - md 이상에서만 의미가 있다(모바일 바텀시트는 항상
          펼쳐진 채로 유지). 아래 aside와 같은 자리(우상단)에 떠 있다가, 누르면
          같은 코너에서 패널이 확장돼 나온다(transform-origin 우측). */}
      {isPanelCollapsed && (
        <button
          type="button"
          aria-expanded={false}
          aria-label="군집·노트 패널 펼치기"
          onClick={() => setIsPanelCollapsed(false)}
          className="paper-surface fixed right-4 top-4 z-20 hidden h-11 w-11 items-center justify-center rounded-full border border-paper-line bg-paper-soft/95 text-paper-ink shadow-panel backdrop-blur-md transition-colors hover:bg-paper md:flex"
        >
          <ChevronLeftIcon size={20} />
        </button>
      )}

      <aside
        className={cn(
          "paper-surface fixed z-20 flex flex-col overflow-hidden rounded-xl border border-paper-line bg-paper-soft/95 shadow-panel backdrop-blur-md",
          "inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] max-h-[46vh]",
          "md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:h-auto md:max-h-none md:w-72 md:origin-right",
          isPanelCollapsed && "md:hidden",
          !isPanelCollapsed && "md:animate-[islandExpand_220ms_cubic-bezier(.22,1,.36,1)]"
        )}
      >
        <PanelTabs
          mode={panelMode}
          onChange={handleTabChange}
          onToggleCollapse={() => setIsPanelCollapsed(true)}
        />
        {/* 두 패널을 항상 마운트해 두고 CSS로만 숨긴다(조건부 렌더로 언마운트하지
            않음) - ElementNotesPanel이 로컬로 들고 있는 "확대된 노트 탭들" 상태가
            상단 탭을 「군집」으로 옮겼다 「노트」로 되돌아와도 그대로 남아있어야
            하기 때문. 확대된 편집기 자체는 어차피 document.body로 포탈되어
            그린다(아래 참고). */}
        <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", panelMode !== "bins" && "hidden")}>
          <ElementBinPanel
            bins={bins}
            onItemDragToCanvas={placeItem}
            onCreateBin={handleCreateBin}
            onAddItem={handleAddItem}
            placedItemIds={placedItemIds}
            onStartNewConstellation={handleStartNewConstellation}
          />
        </div>
        <ElementNotesPanel
          className={panelMode !== "notes" ? "hidden" : undefined}
          nodes={Object.values(nodesWithNoteCounts)}
          notesByNode={notesByNode}
          expandNodeId={notesNodeId}
          expandToken={notesExpandToken}
          onCreateNote={handleCreateNote}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          resolveLink={resolveWikiLink}
          onLinkClick={handleNoteLinkClick}
          isNoteExpanded={isNoteExpanded}
          onNoteExpandedChange={setIsNoteExpanded}
        />
      </aside>
    </div>
  );
}

const PANEL_TABS: { mode: PanelMode; label: string }[] = [
  { mode: "bins", label: "군집" },
  { mode: "notes", label: "노트" },
];

// 오른쪽 패널 맨 위에 상시 떠 있는 세그먼트 탭 - 「군집」/「노트」 둘 다 항상
// 한 번의 클릭 거리에 있게 하고, 지금 보고 있는 쪽을 aria-selected로 알린다.
// role="tablist"/"tab" + 방향키 이동을 갖춘 표준 탭 패턴(버튼 2개 + 컨테이너
// 하나 - 커스텀 위젯을 새로 만들지 않는다). onToggleCollapse가 있으면(md
// 이상에서만) 탭 옆에 접기 버튼을 함께 그린다 - 모바일 바텀시트에는 접는
// 개념이 없으므로 hidden md:flex로 그 쪽에서만 노출한다.
function PanelTabs({
  mode,
  onChange,
  onToggleCollapse,
}: {
  mode: PanelMode;
  onChange: (mode: PanelMode) => void;
  onToggleCollapse?: () => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number) => {
    const wrapped = (index + PANEL_TABS.length) % PANEL_TABS.length;
    onChange(PANEL_TABS[wrapped].mode);
    tabRefs.current[wrapped]?.focus();
  };

  return (
    <div className="flex items-center gap-1.5 border-b border-paper-line p-2">
      <div role="tablist" aria-label="오른쪽 패널 전환" className="flex flex-1 gap-1 rounded-lg bg-paper-soft p-1">
        {PANEL_TABS.map((tab, index) => {
          const selected = tab.mode === mode;
          return (
            <button
              key={tab.mode}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.mode}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.mode}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.mode)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  focusAndSelect(index + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  focusAndSelect(index - 1);
                }
              }}
              className={cn(
                "flex-1 rounded-md px-2.5 py-1.5 font-sans text-xs font-medium transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
                selected ? "bg-paper text-paper-ink" : "text-paper-lo hover:text-paper-ink"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {onToggleCollapse && (
        <button
          type="button"
          aria-expanded={true}
          aria-label="패널 접기"
          onClick={onToggleCollapse}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-paper-lo transition-colors hover:bg-paper hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink md:flex"
        >
          <ChevronRightIcon size={16} />
        </button>
      )}
    </div>
  );
}

// 초안 검토 무대(배너 + "추천 별자리" 패널)는 이제 components/DraftReviewStage.tsx로
// 옮겼다 - 확정 전까지 메인 캔버스에 아무 것도 그리지 않기 위해 전용 풀스크린
// 컴포넌트로 분리했다(위 draftOffer 렌더 분기 참고).
