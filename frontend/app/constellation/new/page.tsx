"use client";

/**
 * 별자리 만들기 화면 - 원소 보관함(오른쪽)에서 칩을 캔버스(가운데)로 끌어와
 * 놓고 연결해 별자리를 완성하는 화면.
 *
 * 백엔드 연동 전 데모 화면이라, 그래프는 전부 로컬 React state로만 존재하고
 * 새로고침하면 사라진다. 영속화/네비게이션 연결은 이후 단계에서 붙인다.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { SideRail } from "@/components/shell/SideRail";
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
  },
  "club-activity": {
    id: "club-activity",
    label: "경영학회 활동",
    type: "activity",
    isCompleted: true,
    position: { x: -120, y: 90 },
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

  const handleEdgeCreate = useCallback((sourceNodeId: string, targetNodeId: string) => {
    if (sourceNodeId === targetNodeId) return;
    setEdges((prev) => {
      const alreadyLinked = Object.values(prev).some(
        (e) =>
          (e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId) ||
          (e.sourceNodeId === targetNodeId && e.targetNodeId === sourceNodeId)
      );
      if (alreadyLinked) return prev;
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
    <div className="flex h-dvh w-full overflow-hidden bg-earth-base">
      <SideRail />
      <main className="min-w-0 flex-1">
        <ConstellationCanvas
          nodes={nodes}
          edges={edges}
          onNodeDrag={handleNodeDrag}
          onNodeToggleComplete={handleNodeToggleComplete}
          onEdgeCreate={handleEdgeCreate}
          onEdgeDelete={handleEdgeDelete}
          onExternalDrop={handleExternalDrop}
        />
      </main>
      <ElementBinPanel bins={bins} onItemDragToCanvas={placeItem} onCreateBin={handleCreateBin} placedItemIds={placedItemIds} />
    </div>
  );
}
