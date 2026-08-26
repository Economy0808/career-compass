"use client";

/**
 * 별자리 만들기 화면 - 원소 보관함(오른쪽)에서 칩을 캔버스(가운데)로 끌어와
 * 놓고 연결해 별자리를 완성하는 화면.
 *
 * 백엔드 연동 전 데모 화면이라, 그래프는 전부 로컬 React state로만 존재하고
 * 새로고침하면 사라진다. 영속화/네비게이션 연결은 이후 단계에서 붙인다.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ConstellationCanvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPosition,
} from "@/components/ConstellationCanvas";
import { ElementBinPanel, type Bin, type BinItem, type BinDropPayload } from "@/components/ElementBinPanel";
import { ElementNotesPanel, type ElementNote } from "@/components/ElementNotesPanel";
import type { ResolveWikiLink } from "@/lib/markdown";

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

let edgeCounter = 0;
let noteCounter = 0;
let userItemCounter = 0;

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
    createdAt: SEED_TIME + 1000 * 60 * 60,
    updatedAt: SEED_TIME + 1000 * 60 * 60 * 5,
  },
  "note-seed-3": {
    id: "note-seed-3",
    nodeId: "element:course-accounting-1",
    title: "스터디 공유용 요약",
    body: "1. 거래의 이중성\n2. 계정과목 5대 분류\n3. 시산표 작성 순서\n\n다음 스터디에서 [[투자자산운용사]] 준비랑 연결해서 볼 것.",
    isPublic: true,
    createdAt: SEED_TIME + 1000 * 60 * 60 * 24,
    updatedAt: SEED_TIME + 1000 * 60 * 60 * 24,
  },
};

// 오른쪽 패널이 지금 무엇을 보여주는지 - 「군집」(원소 보관함) 또는 「노트」
// (선택된 원소 하나의 노트). 새 영역이 아니라 같은 자리를 스왑하는 상태다.
type RightPanelState = { mode: "bins" } | { mode: "notes"; nodeId: string };

export default function NewConstellationPage() {
  const [bins, setBins] = useState<Bin[]>(INITIAL_BINS);
  const [nodes, setNodes] = useState<Record<string, CanvasNode>>(INITIAL_NODES);
  const [edges, setEdges] = useState<Record<string, CanvasEdge>>(INITIAL_EDGES);
  const [notes, setNotes] = useState<Record<string, ElementNote>>(INITIAL_NOTES);
  const [rightPanel, setRightPanel] = useState<RightPanelState>({ mode: "bins" });
  const fillTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

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

  const placeItem = useCallback((item: BinItem, position: CanvasPosition) => {
    const nodeId = nodeIdForItem(item.id);
    setNodes((prev) => {
      if (prev[nodeId]) return prev; // 중복 드롭 - 무시
      return {
        ...prev,
        [nodeId]: {
          id: nodeId,
          label: item.label,
          type: item.type,
          isCompleted: false,
          position,
          level: item.level ?? null,
        },
      };
    });
  }, []);

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
  const handleAddItem = useCallback((binId: string, item: Omit<BinItem, "id">) => {
    userItemCounter += 1;
    const id = `item-user-${userItemCounter}`;
    setBins((prev) =>
      prev.map((bin) => (bin.id === binId ? { ...bin, items: [...bin.items, { id, ...item }] } : bin))
    );
  }, []);

  const handleNodeDrag = useCallback((nodeId: string, position: CanvasPosition) => {
    setNodes((prev) => (prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], position } } : prev));
  }, []);

  const handleNodeToggleComplete = useCallback((nodeId: string) => {
    setNodes((prev) =>
      prev[nodeId] ? { ...prev, [nodeId]: { ...prev[nodeId], isCompleted: !prev[nodeId].isCompleted } } : prev
    );
  }, []);

  // 잇기는 토글이다: 이미 이어진 쌍(방향 무관)을 다시 이으면 끊어지고, 아니면
  // 새로 이어진다 - 절대 같은 쌍에 두 번째 엣지를 만들지 않는다. 캔버스는
  // drag-to-connect와 툴바의 "잇기" 양쪽 모두 이 콜백 하나로 들어오므로, 토글
  // 규칙을 캔버스가 아니라 그래프 상태를 들고 있는 여기 한 곳에만 둔다 -
  // 캔버스의 props API(연결 "생성"이라는 이름)는 그대로 유지된다.
  const handleEdgeCreate = useCallback((sourceNodeId: string, targetNodeId: string) => {
    if (sourceNodeId === targetNodeId) return;
    setEdges((prev) => {
      const existingId = Object.keys(prev).find((id) => {
        const e = prev[id];
        return (
          (e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId) ||
          (e.sourceNodeId === targetNodeId && e.targetNodeId === sourceNodeId)
        );
      });
      if (existingId) {
        const next = { ...prev };
        delete next[existingId];
        return next;
      }
      edgeCounter += 1;
      const id = `edge-local-${edgeCounter}`;
      return { ...prev, [id]: { id, sourceNodeId, targetNodeId } };
    });
  }, []);

  const handleEdgeDelete = useCallback((edgeId: string) => {
    setEdges((prev) => {
      const next = { ...prev };
      delete next[edgeId];
      return next;
    });
  }, []);

  // 노드 삭제(툴바 "삭제") - 노드 자체와 그 노드를 참조하는 엣지를 함께
  // 정리한다. 캔버스는 존재하지 않는 노드의 엣지를 그리지 않도록 방어하지만,
  // 상태에 고아 엣지를 남겨두는 건 지저분하므로 여기서 바로 없앤다.
  const handleNodeDelete = useCallback((nodeId: string) => {
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
  }, []);

  // "노트 N개 ›" 클릭 - 오른쪽 패널을 「군집」에서 「노트」로 스왑한다(새 영역을
  // 여는 게 아니라 같은 자리를 교체).
  const handleOpenNotes = useCallback((nodeId: string) => {
    setRightPanel({ mode: "notes", nodeId });
  }, []);

  const handleBackToBins = useCallback(() => {
    setRightPanel({ mode: "bins" });
  }, []);

  const handleCreateNote = useCallback(
    (nodeId: string, input: { title: string; body: string; isPublic: boolean }) => {
      noteCounter += 1;
      const id = `note-local-${noteCounter}`;
      const now = Date.now();
      setNotes((prev) => ({
        ...prev,
        [id]: { id, nodeId, title: input.title, body: input.body, isPublic: input.isPublic, createdAt: now, updatedAt: now },
      }));
    },
    []
  );

  const handleUpdateNote = useCallback(
    (noteId: string, patch: { title: string; body: string; isPublic: boolean }) => {
      setNotes((prev) =>
        prev[noteId]
          ? { ...prev, [noteId]: { ...prev[noteId], ...patch, updatedAt: Date.now() } }
          : prev
      );
    },
    []
  );

  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes((prev) => {
      if (!prev[noteId]) return prev;
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }, []);

  // 노트 본문 안의 [[위키링크]] 클릭 - 그 원소를 캔버스에서 선택하고, 노트
  // 패널도 그 원소로 전환한다. 캔버스는 selectedNodeId를 내부 state로만
  // 들고 있어 밖에서 직접 선택시킬 수 없으므로, "이 노드를 선택하라"는 요청을
  // ConstellationCanvas의 focusNodeId prop으로 전달한다(아래 렌더 참고).
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  const handleNoteLinkClick = useCallback((nodeId: string) => {
    focusTokenRef.current += 1;
    setFocusRequest({ nodeId, token: focusTokenRef.current });
    setRightPanel({ mode: "notes", nodeId });
  }, []);

  const handleCreateBin = useCallback((label: string) => {
    const id = `bin-user-${Date.now()}`;
    setBins((prev) => [...prev, { id, label, origin: "user", items: [], isLoading: true }]);
    // 백엔드가 없으므로 LLM이 채우는 과정을 데모용으로 흉내낸다: 잠시 뒤
    // 로딩 상태를 풀고 그럴듯한 항목 2개를 채워 넣는다.
    const timer = setTimeout(() => {
      setBins((prev) =>
        prev.map((bin) =>
          bin.id === id
            ? {
                ...bin,
                isLoading: false,
                items: [
                  { id: `${id}-item-1`, label: `${label} 활동 A`, type: "activity" },
                  { id: `${id}-item-2`, label: `${label} 활동 B`, type: "activity" },
                ],
              }
            : bin
        )
      );
      fillTimers.current.delete(timer);
    }, 900);
    fillTimers.current.add(timer);
  }, []);

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
        focusRequest={focusRequest}
      />
      {rightPanel.mode === "bins" ? (
        <ElementBinPanel
          bins={bins}
          onItemDragToCanvas={placeItem}
          onCreateBin={handleCreateBin}
          onAddItem={handleAddItem}
          placedItemIds={placedItemIds}
        />
      ) : nodesWithNoteCounts[rightPanel.nodeId] ? (
        <ElementNotesPanel
          node={nodesWithNoteCounts[rightPanel.nodeId]}
          notes={notesByNode.get(rightPanel.nodeId) ?? []}
          onBack={handleBackToBins}
          onCreateNote={(input) => handleCreateNote(rightPanel.nodeId, input)}
          onUpdateNote={handleUpdateNote}
          onDeleteNote={handleDeleteNote}
          resolveLink={resolveWikiLink}
          onLinkClick={handleNoteLinkClick}
        />
      ) : null}
    </div>
  );
}
