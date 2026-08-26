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
import { ElementBinPanel, type Bin, type BinItem } from "@/components/ElementBinPanel";

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
  "course-accounting-1": {
    id: "course-accounting-1",
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

export default function NewConstellationPage() {
  const [bins, setBins] = useState<Bin[]>(INITIAL_BINS);
  const [nodes, setNodes] = useState<Record<string, CanvasNode>>(INITIAL_NODES);
  const [edges, setEdges] = useState<Record<string, CanvasEdge>>(INITIAL_EDGES);
  const fillTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

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
      let parsed: BinItem;
      try {
        parsed = JSON.parse(data) as BinItem;
      } catch {
        return;
      }
      if (!parsed?.id || !parsed?.label) return;
      placeItem(parsed, position);
    },
    [placeItem]
  );

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

  // "노트 N개 ›" 클릭 - 노트 패널은 다음 작업에서 만든다. 지금은 콘솔 로그만
  // 남기는 스텁으로, 프로토콜(prop이 실제로 호출되는지)만 확인 가능하게 해 둔다.
  const handleOpenNotes = useCallback((nodeId: string) => {
    console.log("[stub] open notes panel for", nodeId);
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
        nodes={nodes}
        edges={edges}
        onNodeDrag={handleNodeDrag}
        onNodeToggleComplete={handleNodeToggleComplete}
        onEdgeCreate={handleEdgeCreate}
        onEdgeDelete={handleEdgeDelete}
        onNodeDelete={handleNodeDelete}
        onOpenNotes={handleOpenNotes}
        onExternalDrop={handleExternalDrop}
      />
      <ElementBinPanel bins={bins} onItemDragToCanvas={placeItem} onCreateBin={handleCreateBin} placedItemIds={placedItemIds} />
    </div>
  );
}
