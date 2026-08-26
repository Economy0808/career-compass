"use client";

/**
 * 원소 보관함 패널 - 화면 오른쪽에서 별자리 캔버스로 드래그해 넣는 "재료함".
 *
 * 보관함(bin) 목록은 고정 카테고리가 아니다. 목표에 따라 LLM이 매번 다른
 * 보관함 구성을 만들어 주고("수업"/"학회" 또는 "공모전"/"포트폴리오"/"어학"
 * 등), 사용자가 직접 새 보관함을 만들면 LLM이 그 안을 채운다. 그래서 이
 * 컴포넌트는 절대 보관함 이름을 하드코딩하지 않고 항상 `bins` prop에서
 * 렌더링한다.
 */

import { useState, type DragEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { CanvasPosition } from "@/components/ConstellationCanvas";

export interface BinItem {
  id: string;
  label: string;
  type: string;
  level?: number | null;
  subtitle?: string;
}

export interface Bin {
  id: string;
  label: string;
  origin: "llm" | "user";
  items: BinItem[];
  /** 방금 사용자가 만든 보관함이라 LLM이 아직 채우는 중일 때. */
  isLoading?: boolean;
}

export interface ElementBinPanelProps {
  bins: Bin[];
  /** 키보드/클릭 경로용 - 드래그 없이도 기본 위치에 노드를 놓을 수 있어야 한다. */
  onItemDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
  onCreateBin: (label: string) => void;
  /** 이미 캔버스에 배치된 원소는 흐리게 + 체크 표시로 구분한다. */
  placedItemIds?: Set<string>;
  className?: string;
}

// ConstellationCanvas.tsx의 TYPE_COLOR와 시각적으로 맞춘 값. 캔버스 컴포넌트는
// 이 매핑을 export하지 않으므로(내부 렌더링 전용 상수), 보관함 칩의 점 색이
// 캔버스에 놓인 뒤의 노드 색과 어긋나지 않도록 여기서 최소한만 복제해 둔다.
const TYPE_DOT: Record<string, string> = {
  course: "#7CC4F0",
  organization: "#E2B94F",
  certification: "#5DB35B",
  activity: "#D8B078",
  networking: "#8FDC8A",
};
const DEFAULT_DOT = "#9FB6AD";

/** 키보드로 놓을 때 쓰는 기본 캔버스 좌표. 매번 조금씩 어긋나게 흩뿌려 겹치지 않게 한다. */
function defaultDropPosition(seed: number): CanvasPosition {
  const angle = (seed * 47) % 360;
  const radius = 60 + (seed % 5) * 24;
  const rad = (angle * Math.PI) / 180;
  return { x: Math.round(Math.cos(rad) * radius), y: Math.round(Math.sin(rad) * radius) };
}

let dropSeed = 0;

function ItemChip({
  item,
  placed,
  onDragToCanvas,
}: {
  item: BinItem;
  placed: boolean;
  onDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
}) {
  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (placed) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify(item));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (placed) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dropSeed += 1;
      onDragToCanvas(item, defaultDropPosition(dropSeed));
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!placed}
      aria-disabled={placed}
      aria-label={placed ? `${item.label} - 이미 캔버스에 있음` : `${item.label} - Enter로 캔버스에 놓기`}
      title={item.subtitle}
      onDragStart={handleDragStart}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold",
        "transition-colors select-none",
        placed
          ? "cursor-default border-line text-content-muted opacity-45"
          : "cursor-grab border-line text-content-secondary hover:border-line-strong hover:bg-white/6 active:cursor-grabbing"
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: placed ? "#7D968C" : (TYPE_DOT[item.type] ?? DEFAULT_DOT) }}
      />
      <span className="truncate">{item.label}</span>
      {placed && (
        <span aria-hidden className="text-growth-bright">
          ✓
        </span>
      )}
    </div>
  );
}

function BinSection({
  bin,
  placedItemIds,
  onItemDragToCanvas,
}: {
  bin: Bin;
  placedItemIds: Set<string>;
  onItemDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
}) {
  return (
    <section className="border-b border-line/60 px-4 py-3.5 last:border-b-0">
      <header className="mb-2 flex items-center gap-1.5">
        <h3 className="text-caption font-bold tracking-[.02em] text-content-primary">{bin.label}</h3>
        {bin.origin === "user" && (
          <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-micro font-semibold text-content-muted">
            내가 만든 보관함
          </span>
        )}
        {!bin.isLoading && (
          <span className="ml-auto text-micro text-content-muted">{bin.items.length}</span>
        )}
      </header>

      {bin.isLoading ? (
        <div className="flex flex-wrap gap-1.5" aria-live="polite" aria-busy="true">
          <span className="sr-only">AI가 {bin.label} 보관함을 채우는 중</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="h-6 animate-pulse rounded-full bg-white/6"
              style={{ width: 52 + i * 18 }}
            />
          ))}
        </div>
      ) : bin.items.length === 0 ? (
        <p className="text-micro text-content-muted">아직 원소가 없어요.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {bin.items.map((item) => (
            <ItemChip
              key={item.id}
              item={item}
              placed={placedItemIds.has(item.id)}
              onDragToCanvas={onItemDragToCanvas}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ElementBinPanel({
  bins,
  onItemDragToCanvas,
  onCreateBin,
  placedItemIds,
  className,
}: ElementBinPanelProps) {
  const [newBinLabel, setNewBinLabel] = useState("");
  const resolvedPlaced = placedItemIds ?? new Set<string>();

  function handleCreateBin() {
    const label = newBinLabel.trim();
    if (!label) return;
    onCreateBin(label);
    setNewBinLabel("");
  }

  return (
    <aside
      className={cn(
        "flex h-full w-72 shrink-0 flex-col border-l border-line bg-surface-overlay backdrop-blur-md",
        className
      )}
      aria-label="원소 보관함"
    >
      <div className="border-b border-line px-4 py-3.5">
        <div className="text-body-sm font-bold text-content-primary">원소 보관함</div>
        <p className="mt-0.5 text-micro text-content-muted">
          칩을 캔버스로 끌어놓거나, 칩에 포커스한 뒤 Enter를 누르세요.
        </p>
      </div>

      <div className="canvas-scroll min-h-0 flex-1 overflow-y-auto">
        {bins.length === 0 ? (
          <p className="px-4 py-6 text-body-sm text-content-muted">아직 보관함이 없어요.</p>
        ) : (
          bins.map((bin) => (
            <BinSection
              key={bin.id}
              bin={bin}
              placedItemIds={resolvedPlaced}
              onItemDragToCanvas={onItemDragToCanvas}
            />
          ))
        )}
      </div>

      <form
        className="flex items-center gap-1.5 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreateBin();
        }}
      >
        <input
          value={newBinLabel}
          onChange={(e) => setNewBinLabel(e.target.value)}
          placeholder="새 보관함 이름"
          aria-label="새 보관함 이름"
          className="min-w-0 flex-1 rounded-sm border border-line bg-transparent px-2.5 py-1.5 text-caption text-content-primary placeholder:text-content-muted focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={!newBinLabel.trim()}
          className="shrink-0 rounded-sm bg-goal/18 px-2.5 py-1.5 text-caption font-semibold text-goal-bright transition-colors hover:bg-goal/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          추가
        </button>
      </form>
    </aside>
  );
}
