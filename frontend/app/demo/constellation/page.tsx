"use client";

/*
 * 별자리 잇기 데모 - 기존 ConstellationCanvas를 그대로 재사용하되, 상태는
 * 전부 이 컴포넌트의 로컬 React state에만 있다. 서버 호출 0(핵심 제약).
 *
 * 실제 화면(app/constellation/new/page.tsx)의 handleNodeDrag/
 * handleEdgeCreate/handleNodeToggleComplete와 같은 규칙을 그대로 재구현한다
 * (enqueueMutation 등 영속화 호출만 제거) - 간선 잇기는 이미 이어진 쌍이면
 * 끊고, 아니면 새로 잇는 토글이다(실제 화면과 동일 UX).
 */

import { useCallback, useMemo, useState } from "react";
import {
  ConstellationCanvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPosition,
} from "@/components/ConstellationCanvas";
import { DEMO_SEED_EDGES, DEMO_SEED_NODES } from "@/lib/demo-fixtures";
import { SignupPrompt } from "../SignupPrompt";

let localEdgeCounter = 0;

export default function DemoConstellationPage() {
  const [nodes, setNodes] = useState<Record<string, CanvasNode>>(() =>
    Object.fromEntries(DEMO_SEED_NODES.map((n) => [n.id, n]))
  );
  const [edges, setEdges] = useState<Record<string, CanvasEdge>>(() =>
    Object.fromEntries(DEMO_SEED_EDGES.map((e) => [e.id, e]))
  );
  const [promptOpen, setPromptOpen] = useState(false);

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
      const existing = Object.values(prev).find(
        (e) =>
          (e.sourceNodeId === sourceNodeId && e.targetNodeId === targetNodeId) ||
          (e.sourceNodeId === targetNodeId && e.targetNodeId === sourceNodeId)
      );
      if (existing) {
        const next = { ...prev };
        delete next[existing.id];
        return next;
      }
      localEdgeCounter += 1;
      const id = `demo-edge-${localEdgeCounter}`;
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

  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const completedCount = useMemo(() => nodeList.filter((n) => n.isCompleted).length, [nodeList]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-text-lo">
          <span className="font-sans">노드를 드래그해 옮기고, 더블클릭으로 완료를 토글하고, 가장자리 링을
          드래그해 선을 이어보세요.</span>
        </p>
        <button
          type="button"
          onClick={() => setPromptOpen(true)}
          className="min-h-11 shrink-0 rounded-md border border-transparent bg-spec-b px-4 py-2 text-caption font-bold text-ink-900 transition-[filter] duration-150 hover:brightness-110"
        >
          발행하기
        </button>
      </div>

      <div className="relative h-[560px] w-full overflow-hidden rounded-lg border border-rule bg-ink-900">
        <ConstellationCanvas
          nodes={nodes}
          edges={edges}
          onNodeDrag={handleNodeDrag}
          onNodeToggleComplete={handleNodeToggleComplete}
          onEdgeCreate={handleEdgeCreate}
          onEdgeDelete={handleEdgeDelete}
        />

        {/* 실제 화면은 대화형 AI 초안 생성이 핵심이지만, 데모는 서버(LLM) 호출이
            없으므로 그 사실을 안내만 하고 비활성화한다. */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-md border border-rule bg-ink-800/85 px-3.5 py-2 text-micro text-text-lo backdrop-blur-md md:right-auto md:max-w-sm">
          실제로는 대화를 통해 AI가 초안을 그려줘요 — 이 데모는 미리 채워둔 예시예요
        </div>
      </div>

      <p className="text-micro text-text-lo">
        완료 <span className="font-mono text-text-hi">{completedCount}</span> / {nodeList.length}
      </p>

      <SignupPrompt open={promptOpen} onClose={() => setPromptOpen(false)} action="발행" />
    </div>
  );
}
