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

import { useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { TYPE_COLOR, DEFAULT_TYPE_COLOR } from "@/lib/element-colors";
import type { CanvasPosition } from "@/components/ConstellationCanvas";
import { InfoIcon, SeedIcon } from "@/components/ui/icons";

export interface BinItem {
  id: string;
  label: string;
  type: string;
  level?: number | null;
  subtitle?: string;
  description?: string;
}

export interface Bin {
  id: string;
  label: string;
  origin: "llm" | "user";
  items: BinItem[];
  /** 방금 사용자가 만든 보관함이라 LLM이 아직 채우는 중일 때. */
  isLoading?: boolean;
  /** LLM이 이 보관함을 왜 이렇게 구성했는지 짧게 설명하는 조언 - ⓘ로 펼쳐 본다. */
  advice?: string;
}

export interface ElementBinPanelProps {
  bins: Bin[];
  /** 키보드/클릭 경로용 - 드래그 없이도 기본 위치에 노드를 놓을 수 있어야 한다. */
  onItemDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
  onCreateBin: (label: string) => void;
  /** 보관함에 직접 원소를 추가한다 - id는 page.tsx가 생성한다. */
  onAddItem: (binId: string, item: Omit<BinItem, "id">) => void;
  /** 이미 캔버스에 배치된 원소는 흐리게 + 체크 표시로 구분한다. */
  placedItemIds?: Set<string>;
  /** 있으면 패널 하단에 "새 별자리 만들기" 버튼을 보여준다. */
  onStartNewConstellation?: () => void;
  className?: string;
}

// 유형→색 매핑은 lib/element-colors.ts에서 단일 진실 공급원으로 관리된다.
// 보관함 칩의 점 색이 캔버스에 놓인 뒤의 노드 색과 항상 일치한다.

/** 사용자가 직접 원소를 추가할 때 고를 수 있는 종류 - type이 노드 색(분광형
 * 악센트)을 결정하므로 추측하지 않고 항상 명시적으로 고르게 한다. */
const ELEMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "course", label: "수업" },
  { value: "certification", label: "자격증" },
  { value: "organization", label: "학회" },
  { value: "activity", label: "대외활동" },
  { value: "networking", label: "네트워킹" },
];

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

// 황금각(137.5도) 나선형 배치. "모두 추가"로 보관함 하나를 통째로 캔버스에
// 내려놓을 때, 항목을 겹치지 않게 흩뿌리면서도 하나의 "군집"으로 읽히게 하는
// 가장 단순한 방법 - index가 늘어날수록 반지름도 같이 늘어나 서로 겹치지
// 않고, 각도는 황금각만큼씩 돌아 나선을 그린다. items는 level 오름차순(기초
// 학년 먼저)으로 미리 정렬해 넘기면, 나선 중심(=기초 원소)에서 바깥(=고학년)
// 으로 자연스럽게 펼쳐진다.
const GOLDEN_ANGLE_RAD = 137.5 * (Math.PI / 180);
function spiralPosition(index: number, base: CanvasPosition): CanvasPosition {
  const angle = index * GOLDEN_ANGLE_RAD;
  const radius = 46 + index * 28;
  return {
    x: Math.round(base.x + Math.cos(angle) * radius),
    y: Math.round(base.y + Math.sin(angle) * radius),
  };
}

/** level 오름차순(없으면 맨 뒤)으로 정렬 - "기초 원소가 나선 안쪽" 규칙의 기반. */
function sortByLevelAscending(items: BinItem[]): BinItem[] {
  return [...items].sort((a, b) => {
    const la = typeof a.level === "number" ? a.level : Number.POSITIVE_INFINITY;
    const lb = typeof b.level === "number" ? b.level : Number.POSITIVE_INFINITY;
    return la - lb;
  });
}

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
        "group flex items-center gap-1.5 rounded-none border px-2 py-1 text-caption font-semibold",
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
        style={{ background: placed ? "var(--text-lo)" : (TYPE_COLOR[item.type] ?? DEFAULT_TYPE_COLOR) }}
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

/** 보관함 통째로 드래그할 때 캔버스로 넘기는 페이로드 - 단일 원소 페이로드
 * (BinItem 그대로)와 구분하기 위해 kind: "bin" 태그를 붙인다. page.tsx의
 * onExternalDrop이 이 태그로 분기한다. */
export interface BinDropPayload {
  kind: "bin";
  binId: string;
}

// 보관함 하나 = 섬 하나. Obsidian 그래프뷰처럼 절제된 톤 - 진한 채도나 그림자
// 대신 얇은 rule 헤어라인 하나로 다른 섬과 분리한다.
function BinSection({
  bin,
  placedItemIds,
  onItemDragToCanvas,
  onAddItem,
}: {
  bin: Bin;
  placedItemIds: Set<string>;
  onItemDragToCanvas: (item: BinItem, position: CanvasPosition) => void;
  onAddItem: (binId: string, item: Omit<BinItem, "id">) => void;
}) {
  const groups = useMemo(() => groupByLevel(bin.items), [bin.items]);
  const [addLabel, setAddLabel] = useState("");
  const [addType, setAddType] = useState(ELEMENT_TYPE_OPTIONS[0].value);
  const [adviceOpen, setAdviceOpen] = useState(false);

  const allPlaced = bin.items.length > 0 && bin.items.every((item) => placedItemIds.has(item.id));
  const canPlaceAll = !bin.isLoading && bin.items.length > 0 && !allPlaced;
  const hasAdvice = !!bin.advice && bin.advice.trim().length > 0;
  // "AI 제안" 배지 - LLM이 채운 보관함인데 카탈로그 검증되는 "수업"이 하나도
  // 없으면(전부 course가 아니면), 사용자가 카탈로그 항목으로 오해하지 않도록
  // 정직하게 표시한다.
  const isAiSuggested =
    bin.origin === "llm" && bin.items.length > 0 && bin.items.every((item) => item.type !== "course");
  const adviceId = `bin-advice-${bin.id}`;

  function handleAddItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const label = addLabel.trim();
    if (!label) return;
    onAddItem(bin.id, { label, type: addType });
    setAddLabel("");
  }

  // "모두 추가" - 아직 캔버스에 없는 원소만, level 오름차순으로 나선형 배치.
  // 이미 놓인 원소는 건너뛰어 두 번 눌러도 중복 생성되지 않는다(placeItem
  // 쪽에서도 같은 id는 무시하지만, 여기서 먼저 걸러야 위치가 낭비되지 않는다).
  function handlePlaceAll() {
    const unplaced = sortByLevelAscending(bin.items).filter((item) => !placedItemIds.has(item.id));
    if (unplaced.length === 0) return;
    dropSeed += 1;
    const base = defaultDropPosition(dropSeed);
    unplaced.forEach((item, i) => onItemDragToCanvas(item, spiralPosition(i, base)));
  }

  // 보관함 섬 자체를 드래그해도 통째로 놓을 수 있게 - 헤더를 드래그 손잡이로
  // 쓴다(칩 하나하나의 드래그와 겹치지 않도록 items 영역이 아니라 헤더에만).
  function handleBinDragStart(e: DragEvent<HTMLElement>) {
    if (bin.isLoading || bin.items.length === 0) {
      e.preventDefault();
      return;
    }
    const payload: BinDropPayload = { kind: "bin", binId: bin.id };
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
  }

  return (
    <section className="rounded-lg border border-rule bg-ink-700/50 px-3 py-2.5">
      <header
        className="mb-2 flex items-center gap-1.5"
        draggable={!bin.isLoading && bin.items.length > 0}
        onDragStart={handleBinDragStart}
        title="보관함 전체를 캔버스로 끌어놓을 수 있어요"
      >
        <h3 className="text-caption font-bold tracking-[.02em] text-text-hi">{bin.label}</h3>
        {bin.origin === "user" && (
          <span className="rounded-none bg-ink-800 px-1.5 py-0.5 text-micro font-semibold text-text-lo">
            내가 만든 보관함
          </span>
        )}
        {isAiSuggested && (
          <span
            title="카탈로그 검증 없이 AI가 제안한 항목이에요"
            className="rounded-none bg-ink-800 px-1.5 py-0.5 text-micro font-semibold text-text-lo"
          >
            AI 제안
          </span>
        )}
        {hasAdvice && (
          <button
            type="button"
            draggable={false}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              setAdviceOpen((v) => !v);
            }}
            aria-expanded={adviceOpen}
            aria-controls={adviceId}
            aria-label={`${bin.label} 조언 보기`}
            className="shrink-0 rounded-full p-0.5 text-text-lo transition-colors hover:bg-ink-800 hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
          >
            <InfoIcon size={14} />
          </button>
        )}
        {!bin.isLoading && (
          <>
            <button
              type="button"
              onClick={handlePlaceAll}
              disabled={!canPlaceAll}
              className="ml-auto shrink-0 rounded-none px-1.5 py-0.5 text-micro font-semibold text-spec-b transition-colors hover:bg-spec-b/15 disabled:cursor-not-allowed disabled:text-text-lo disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
            >
              모두 추가
            </button>
            <span className="font-mono text-micro text-text-lo">{bin.items.length}</span>
          </>
        )}
      </header>

      {hasAdvice && adviceOpen && (
        <p
          id={adviceId}
          className="mt-1 mb-2 rounded-md border border-rule bg-ink-900/60 px-2.5 py-2 text-caption leading-relaxed text-text-lo"
        >
          {bin.advice}
        </p>
      )}

      {bin.isLoading ? (
        <div className="flex flex-wrap gap-1.5" aria-live="polite" aria-busy="true">
          <span className="sr-only">AI가 {bin.label} 보관함을 채우는 중</span>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="h-6 animate-pulse rounded-none bg-ink-800"
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
        //
        // 실 데이터(NCS 과목 카탈로그 7,109개)가 들어오면 보관함 하나에 수십
        // 개가 쌓일 수 있어, 이 목록만 자체 높이(max-h)로 스크롤한다 - 바깥
        // 패널(ElementBinPanel의 canvas-scroll 영역)까지 한없이 늘어나면 다른
        // 보관함들이 화면 밖으로 밀려나기 때문. overscroll-contain으로 이
        // 안쪽 스크롤이 끝에 닿아도 바깥 패널 스크롤로 새지 않게 막아, 모바일
        // 하단 시트에서 "안쪽 다 내렸는데 갑자기 시트 전체가 스크롤"되는
        // 흔한 중첩 스크롤 함정을 피한다.
        <div className="canvas-scroll max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
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

      {!bin.isLoading && (
        <form
          onSubmit={handleAddItem}
          className="mt-2 flex items-center gap-1.5 border-t border-rule pt-2"
          aria-label={`${bin.label}에 원소 직접 추가`}
        >
          <select
            value={addType}
            onChange={(e) => setAddType(e.target.value)}
            aria-label="새 원소 종류"
            className="shrink-0 rounded-none border border-rule bg-ink-800 px-1 py-1 text-micro text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
          >
            {ELEMENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            placeholder="요소 이름 직접 추가"
            aria-label="새 원소 이름"
            className="min-w-0 flex-1 rounded-none border border-rule bg-transparent px-2 py-1 text-micro text-text-hi placeholder:text-text-lo focus:border-spec-b focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
          />
          <button
            type="submit"
            disabled={!addLabel.trim()}
            className="shrink-0 rounded-none bg-spec-b/18 px-2 py-1 text-micro font-semibold text-spec-b transition-colors hover:bg-spec-b/25 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
          >
            추가
          </button>
        </form>
      )}
    </section>
  );
}

export function ElementBinPanel({
  bins,
  onItemDragToCanvas,
  onCreateBin,
  onAddItem,
  placedItemIds,
  onStartNewConstellation,
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
    <div
      id="panel-bins"
      role="tabpanel"
      aria-label="원소 보관함"
      tabIndex={0}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
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
              onAddItem={onAddItem}
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
          className="min-w-0 flex-1 rounded-none border border-rule bg-transparent px-2.5 py-1.5 text-caption text-text-hi placeholder:text-text-lo focus:border-spec-b focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
        />
        <button
          type="submit"
          disabled={!newBinLabel.trim()}
          className="shrink-0 rounded-none bg-spec-b/18 px-2.5 py-1.5 text-caption font-semibold text-spec-b transition-colors hover:bg-spec-b/25 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70"
        >
          추가
        </button>
      </form>

      {onStartNewConstellation && (
        <div className="border-t border-rule px-3 pb-3 pt-2">
          <button
            type="button"
            onClick={onStartNewConstellation}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rule bg-ink-700/60 py-1.5 text-caption font-semibold text-text-hi transition-colors hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-spec-b/70 md:py-2 md:text-sm"
          >
            <SeedIcon size={14} />
            새 별자리 만들기
          </button>
        </div>
      )}
    </div>
  );
}
