"use client";

/**
 * 별자리 초안 검토 무대 - Intake 대화가 초안을 만들어 준 뒤 뜨는 전용
 * 풀스크린 화면. 승인된 Cosmos 시안 보드 그대로: 어두운 별밭 + 격자,
 * 상단 배너, 중앙-우측에 크게 그려진 선택된 초안, 좌하단 "추천 별자리" 패널.
 *
 * 확정("이 별자리로 시작")하기 전까지는 메인 캔버스를 전혀 보여주지
 * 않는다(사용자 지시) - page.tsx는 이 컴포넌트가 떠 있는 동안 캔버스 위에
 * 아무것도 그리지 않고, onConfirm/onReject가 불리면 그제서야 이 무대를 접는다.
 *
 * Esc는 의도적으로 아무 것도 하지 않는다 - 사용자가 반드시 셋 중 하나를
 * 선택하게 한다(대화 오버레이의 onDismiss와 다른 지점).
 */

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import type { Bin, BinItem } from "@/components/ElementBinPanel";
import type { CanvasEdge, CanvasNode, CanvasPosition } from "@/components/ConstellationCanvas";
import type { DraftDto } from "@/lib/constellation-api";

export interface DraftReviewStageProps {
  drafts: DraftDto[];
  selected: number;
  bins: Bin[];
  nodes: Record<string, CanvasNode>;
  edges: Record<string, CanvasEdge>;
  onSelect: (index: number) => void;
  onConfirm: () => void;
  onReject: () => void;
}

// ---- page.tsx의 formatDraftBreakdown/findBinItemAcrossBins을 그대로 옮겨왔다.
// 이 컴포넌트가 page.tsx를 거꾸로 import할 수 없어(순환 import) 작은 순수
// 함수 둘을 복제한다 - page.tsx 쪽 원본은 이제 이 화면 전용이라 지웠다.
const DRAFT_TYPE_LABEL_ORDER: [string, string][] = [
  ["course", "수업"],
  ["certification", "자격증"],
  ["organization", "학회"],
  ["activity", "활동"],
  ["networking", "네트워킹"],
];

function findBinItemAcrossBins(bins: Bin[], itemId: string): BinItem | undefined {
  for (const bin of bins) {
    const item = bin.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return undefined;
}

function formatDraftBreakdown(draft: DraftDto, bins: Bin[]): string {
  const counts = new Map<string, number>();
  for (const itemId of draft.itemIds) {
    const item = findBinItemAcrossBins(bins, itemId);
    if (!item) continue;
    counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [type, label] of DRAFT_TYPE_LABEL_ORDER) {
    const n = counts.get(type);
    if (n) parts.push(`${label} ${n}`);
  }
  for (const [type, n] of Array.from(counts.entries())) {
    if (!DRAFT_TYPE_LABEL_ORDER.some(([t]) => t === type)) parts.push(`${type} ${n}`);
  }
  return `${draft.tagline} · 요소 ${draft.itemIds.length}${parts.length ? " · " + parts.join(" ") : ""}`;
}

// 무대 곳곳에 흩뿌린 희미한 별 - ConstellationIntakeChat의 BackgroundStars와
// 같은 순전히 장식용 패턴(그쪽도 export되어 있지 않아 좌표만 새로 뽑았다).
const BACKGROUND_STARS = [
  { x: 6, y: 18, r: 1.3, o: 0.38 },
  { x: 18, y: 62, r: 1, o: 0.3 },
  { x: 34, y: 10, r: 1.5, o: 0.46 },
  { x: 47, y: 78, r: 1, o: 0.32 },
  { x: 58, y: 30, r: 1.2, o: 0.4 },
  { x: 88, y: 20, r: 1, o: 0.3 },
  { x: 12, y: 88, r: 1.4, o: 0.5 },
];

function BackgroundStars() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {BACKGROUND_STARS.map((s, idx) => (
        <circle key={idx} cx={s.x} cy={s.y} r={s.r} fill="var(--text-hi)" opacity={s.o} />
      ))}
    </svg>
  );
}

/** 8-point 별빛 글리프 - ConstellationIntakeChat/page.tsx의 StarGlyph와 같은
 * path. 그쪽들도 export되어 있지 않아(각자 화면 전용) 여기서도 그대로 옮겨왔다. */
function StarGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="var(--lit)" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
      <path d="M8 1.5 L8 14.5 M1.5 8 L14.5 8 M3.7 3.7 L12.3 12.3 M12.3 3.7 L3.7 12.3" />
    </svg>
  );
}

const PREVIEW_PADDING_RATIO = 0.12;
const MIN_SPAN = 40; // 노드가 한 줄/한 점에 몰려 폭이나 높이가 0일 때의 최소 스팬(MiniConstellation과 동일)

/** world 좌표(노드 position)를 미리보기 박스 안 0~100% 좌표로 편다.
 * MiniConstellation의 viewBox 계산과 같은 공식이지만, 결과를 SVG viewBox가
 * 아니라 좌표 자체(%)로 돌려준다 - 선(SVG)과 라벨(HTML)이 같은 매핑 함수를
 * 공유해야 서로 어긋나지 않기 때문(ponytail: 그래프가 아주 넓거나 좁으면
 * 라벨이 겹칠 수 있음 - 정적 미리보기라 레이아웃 알고리즘까지는 두지 않았다,
 * 필요해지면 force-directed 재배치를 추가).*/
function usePreviewLayout(nodes: CanvasNode[]) {
  return useMemo(() => {
    if (nodes.length === 0) return null;
    const xs = nodes.map((n) => n.position.x);
    const ys = nodes.map((n) => n.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, MIN_SPAN);
    const spanY = Math.max(maxY - minY, MIN_SPAN);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const totalSpanX = spanX * (1 + PREVIEW_PADDING_RATIO * 2);
    const totalSpanY = spanY * (1 + PREVIEW_PADDING_RATIO * 2);
    return (pos: CanvasPosition) => ({
      left: ((pos.x - centerX) / totalSpanX + 0.5) * 100,
      top: ((pos.y - centerY) / totalSpanY + 0.5) * 100,
    });
  }, [nodes]);
}

export function DraftReviewStage({
  drafts,
  selected,
  bins,
  nodes,
  edges,
  onSelect,
  onConfirm,
  onReject,
}: DraftReviewStageProps) {
  const nodeList = useMemo(() => Object.values(nodes), [nodes]);
  const validEdges = useMemo(
    () => Object.values(edges).filter((e) => nodes[e.sourceNodeId] && nodes[e.targetNodeId]),
    [edges, nodes]
  );
  const toPct = usePreviewLayout(nodeList);

  return (
    <div role="region" aria-label="별자리 초안 검토" className="fixed inset-0 z-40 overflow-hidden bg-ink-900">
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />
      <BackgroundStars />

      {/* 상단 중앙 배너 - 대화 완료 직후에도 계속 남아 "드래그로 고칠 수
          있다"는 걸 알려준다(정적 미리보기지만 문구는 그대로 유지 - 실제
          드래그는 확정 후 메인 캔버스에서 가능). */}
      <div
        className="pointer-events-none fixed left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-rule bg-ink-800/95 px-4 py-2 shadow-lg backdrop-blur-md"
        role="status"
      >
        <StarGlyph size={14} />
        <span className="font-sans text-xs text-text-hi">
          대화를 바탕으로 별자리 초안을 그렸어요 — 별을 끌어 마음대로 고쳐도 돼요
        </span>
      </div>

      {/* 중앙-우측 큰 미리보기 - 좌하단 패널 자리를 비워두기 위해 뷰포트의
          오른쪽 55~60%만 쓴다. */}
      <div className="absolute inset-y-0 right-0 flex w-[58%] items-center justify-center py-28 pl-8 pr-12">
        {toPct ? (
          <div className="relative h-full max-h-[620px] w-full max-w-[760px]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {validEdges.map((edge) => {
                const a = toPct(nodes[edge.sourceNodeId].position);
                const b = toPct(nodes[edge.targetNodeId].position);
                return (
                  <line
                    key={edge.id}
                    x1={a.left}
                    y1={a.top}
                    x2={b.left}
                    y2={b.top}
                    stroke="rgb(232 234 242 / 0.22)"
                    strokeWidth={0.35}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {nodeList.map((node) => {
              const pos = toPct(node.position);
              const color = colorForType(node.type);
              const isCourse = node.type === "course";
              return (
                <div
                  key={node.id}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                >
                  <span
                    aria-hidden
                    className="block rounded-full"
                    style={
                      isCourse
                        ? { width: 18, height: 18, background: color }
                        : { width: 16, height: 16, background: "transparent", border: `1.5px solid ${color}` }
                    }
                  />
                  <span className="mt-1.5 whitespace-nowrap font-sans text-sm text-text-hi">{node.label}</span>
                  {isCourse && node.code && (
                    <span className="whitespace-nowrap font-mono text-[11px] text-text-lo">{node.code}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="font-sans text-sm text-text-lo">그릴 원소가 없어요</p>
        )}
      </div>

      {/* 좌하단 "추천 별자리" 패널 - page.tsx의 옛 DraftOfferPanel과 같은
          레이아웃/문구/버튼 클래스를 그대로 옮겨왔다(승인된 시안 그대로). */}
      <aside
        role="region"
        aria-label="추천 별자리"
        className={cn(
          "fixed z-20 flex flex-col overflow-hidden rounded-xl border border-rule bg-ink-800/95 shadow-lg backdrop-blur-md",
          "inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] max-h-[46vh]",
          "md:inset-x-auto md:bottom-6 md:left-4 md:top-auto md:h-auto md:max-h-none md:w-[300px]"
        )}
      >
        <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
          <h2 className="font-sans text-sm font-medium text-text-hi">추천 별자리</h2>
          <span className="font-mono text-micro text-text-lo">{drafts.length}안</span>
        </div>

        <div className="canvas-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {drafts.map((draft, index) => {
            const isSelected = index === selected;
            return (
              <button
                key={index}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(index)}
                className={cn(
                  "w-full rounded-md border-l px-2.5 py-2 text-left transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b",
                  isSelected ? "border-l-text-hi/20 bg-ink-700/70" : "border-l-transparent hover:bg-ink-700/60"
                )}
              >
                <div className="font-sans text-sm font-medium text-text-hi">{draft.name}</div>
                <div className="mt-0.5 text-micro leading-relaxed text-text-lo">{formatDraftBreakdown(draft, bins)}</div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-rule p-3">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-spec-b px-3 py-1.5 font-sans text-sm font-medium text-ink-900 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            이 별자리로 시작
          </button>
          <button
            type="button"
            onClick={onReject}
            className="rounded-md border border-rule px-3 py-1.5 font-sans text-sm text-text-hi transition-colors hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            직접 그릴래요
          </button>
        </div>
      </aside>
    </div>
  );
}
