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

import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
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

// ConstellationCanvas.tsx의 TYPE_COLOR(항성 분광형 악센트)와 시각적으로 맞춘
// 값. 캔버스 컴포넌트는 이 매핑을 export하지 않으므로(내부 렌더링 전용 상수),
// 보관함 칩의 점 색이 캔버스에 놓인 뒤의 노드 색과 어긋나지 않도록 여기서
// 최소한만 복제해 둔다.
const TYPE_DOT: Record<string, string> = {
  course: "var(--spec-b)",
  certification: "var(--spec-a)",
  organization: "var(--spec-g)",
  activity: "var(--spec-k)",
  networking: "var(--spec-m)",
};
const DEFAULT_DOT = "var(--text-lo)";

const COURSE_CODE_RE = /^([A-Z]{2,6}\d{3,5})\s+(.+)$/;
function splitCourseCode(label: string): { code: string | null; rest: string } {
  const m = COURSE_CODE_RE.exec(label);
  return m ? { code: m[1], rest: m[2] } : { code: null, rest: label };
}

/** 연세대 학정번호 앞자리(1000~4000)를 학년 표기로. 범위를 벗어나면 (대학원
 * 과목 등) 뭉뚱그려 보여준다 - 하드코딩된 카테고리가 아니라 순수 숫자 변환. */
function tierLabel(level: number): string {
  const year = Math.floor(level / 1000);
  if (year <= 1) return "1학년 · 기초";
  if (year >= 5) return "대학원/고급";
  return `${year}학년`;
}

interface LevelGroup {
  level: number | null;
  items: BinItem[];
}

/** 원소를 학년 tier로 묶는다. level이 없는 원소(사용자가 직접 추가한 항목 등,
 * 실제 카탈로그의 ~96%도 마찬가지)는 억지로 학년을 추측하지 않고 별도
 * 그룹으로 맨 아래에 모은다. */
function groupByLevel(items: BinItem[]): LevelGroup[] {
  const withLevel = new Map<number, BinItem[]>();
  const withoutLevel: BinItem[] = [];
  for (const item of items) {
    if (typeof item.level === "number") {
      const bucket = Math.floor(item.level / 1000) * 1000;
      if (!withLevel.has(bucket)) withLevel.set(bucket, []);
      withLevel.get(bucket)!.push(item);
    } else {
      withoutLevel.push(item);
    }
  }
  const groups: LevelGroup[] = Array.from(withLevel.entries())
    .sort(([a], [b]) => a - b)
    .map(([level, groupItems]) => ({ level, items: groupItems }));
  if (withoutLevel.length > 0) groups.push({ level: null, items: withoutLevel });
  return groups;
}

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

  const { code, rest } = splitCourseCode(item.label);
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
        "group flex items-center gap-1.5 rounded-sm border px-2 py-1 text-caption font-semibold",
        "transition-colors select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-800",
        placed
          ? "cursor-default border-rule text-text-lo opacity-45"
          : "cursor-grab border-rule text-text-hi hover:border-spec-b/60 hover:bg-ink-700 active:cursor-grabbing"
      )}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: placed ? "var(--text-lo)" : (TYPE_DOT[item.type] ?? DEFAULT_DOT) }}
      />
      {code && <span className="font-mono text-micro text-text-lo">{code}</span>}
      <span className="truncate">{rest}</span>
      {placed && (
        <span aria-hidden className="text-lit">
          ✓
        </span>
      )}
    </div>
  );
}

// 보관함 하나 = 섬 하나. Obsidian 그래프뷰처럼 절제된 톤 - 진한 채도나 그림자
// 대신 얇은 rule 헤어라인 하나로 다른 섬과 분리한다.
function BinSection({
  bin,
  placedItemIds,
  onItemDragToCanvas,
}: {
  bin: Bin;
  placedItemIds: Set<string>;
  onItemDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
}) {
  const groups = useMemo(() => groupByLevel(bin.items), [bin.items]);

  return (
    <section className="rounded-lg border border-rule bg-ink-700/50 px-3 py-2.5">
      <header className="mb-2 flex items-center gap-1.5">
        <h3 className="text-caption font-bold tracking-[.02em] text-text-hi">{bin.label}</h3>
        {bin.origin === "user" && (
          <span className="rounded-sm bg-ink-800 px-1.5 py-0.5 text-micro font-semibold text-text-lo">
            내가 만든 보관함
          </span>
        )}
        {!bin.isLoading && (
          <span className="ml-auto font-mono text-micro text-text-lo">{bin.items.length}</span>
        )}
      </header>

      {bin.isLoading ? (
        <div className="flex flex-wrap gap-1.5" aria-live="polite" aria-busy="true">
          <span className="sr-only">AI가 {bin.label} 보관함을 채우는 중</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="h-6 animate-pulse rounded-sm bg-ink-800"
              style={{ width: 52 + i * 18 }}
            />
          ))}
        </div>
      ) : bin.items.length === 0 ? (
        <p className="text-micro text-text-lo">아직 원소가 없어요.</p>
      ) : (
        // level(학정번호 앞자리)로 tier를 나눠, 기초 과목이 위로 오게 쌓는다.
        // 왼쪽의 얇은 세로선은 "같은 tier"라는 연결을 은은하게만 표시하는
        // connector - 실제 계층 구조는 카드 배경/그림자가 아니라 이 헤어라인과
        // 위→아래 순서만으로 표현한다.
        <div className="space-y-2">
          {groups.map((group) => (
            <div key={group.level ?? "unleveled"} className="relative pl-2.5">
              <div className="absolute inset-y-0.5 left-0 w-px bg-rule" aria-hidden />
              <div className="mb-1 flex items-baseline gap-1.5 text-micro font-semibold text-text-lo">
                {group.level !== null && (
                  <span className="font-mono text-[10px] text-text-lo/80">{group.level}</span>
                )}
                <span>{group.level !== null ? tierLabel(group.level) : "학년 정보 없음"}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <ItemChip
                    key={item.id}
                    item={item}
                    placed={placedItemIds.has(item.id)}
                    onDragToCanvas={onItemDragToCanvas}
                  />
                ))}
              </div>
            </div>
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
    // 캔버스 위에 뜨는 반투명 판 - 폭을 나눠 갖는 flex 컬럼이 아니라 fixed
    // 오버레이다. 그래프가 뒤로 은은하게 비치도록 배경은 완전 불투명이 아닌
    // /95 + backdrop-blur를 유지한다. 모바일에서는 3컬럼(레일·캔버스·패널)이
    // 성립하지 않으므로 탭바 위에 뜨는 하단 시트로 내려앉고, md 이상에서만
    // 오른쪽 도크가 된다.
    <aside
      className={cn(
        "fixed z-20 flex flex-col overflow-hidden rounded-xl border border-rule bg-ink-800/95 shadow-lg backdrop-blur-md",
        "inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] max-h-[46vh]",
        "md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:h-auto md:max-h-none md:w-72",
        className
      )}
      aria-label="원소 보관함"
    >
      <div className="border-b border-rule px-4 py-3.5">
        <div className="text-body-sm font-bold text-text-hi">원소 보관함</div>
        <p className="mt-0.5 text-micro text-text-lo">
          칩을 캔버스로 끌어놓거나, 칩에 포커스한 뒤 Enter를 누르세요.
        </p>
      </div>

      <div className="canvas-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {bins.length === 0 ? (
          <p className="px-1.5 py-6 text-body-sm text-text-lo">아직 보관함이 없어요.</p>
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
        className="flex items-center gap-1.5 border-t border-rule p-3"
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
          className="min-w-0 flex-1 rounded-sm border border-rule bg-transparent px-2.5 py-1.5 text-caption text-text-hi placeholder:text-text-lo focus:border-spec-b focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
        />
        <button
          type="submit"
          disabled={!newBinLabel.trim()}
          className="shrink-0 rounded-sm bg-spec-b/18 px-2.5 py-1.5 text-caption font-semibold text-spec-b transition-colors hover:bg-spec-b/25 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
        >
          추가
        </button>
      </form>
    </aside>
  );
}
