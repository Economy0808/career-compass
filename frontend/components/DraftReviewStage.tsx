"use client";

/**
 * 별자리 초안 검토 무대 - Intake 대화가 초안을 만들어 준 뒤 뜨는 전용
 * 풀스크린 화면. 승인된 Cosmos 시안 보드 그대로: 어두운 별밭 + 격자,
 * 상단 배너, 중앙-우측에 크게 그려진 선택된 초안, 좌하단 "추천 별자리" 패널.
 *
 * c368bb5 계약 갱신: 시안은 더 이상 몇 개 항목만 발췌하지 않는다. bins는
 * 항상 전부(full load) 표시되고, 안별 차이는 어떤 군집(bin)을 강조하는지
 * (coreBinLabels)와 군집 사이 학습 경로(binEdges)뿐이다 - 그래서 이 화면도
 * 개별 원소가 아니라 **bins 전체를 성단(군집) 단위로** 그린다. 군집 하나 =
 * 그 bin의 items 개수 배지를 단 원 하나(ConstellationCanvas의 성단 시각
 * 문법을 가볍게 복제 - 캔버스 컴포넌트 자체를 끌어오면 이 화면 전용이 아닌
 * pan/zoom·드래그까지 딸려와 비대해지므로 원/배지/라벨만 옮겨왔다).
 *
 * 확정("이 별자리로 시작")하기 전까지는 메인 캔버스를 전혀 보여주지
 * 않는다(사용자 지시) - page.tsx는 이 컴포넌트가 떠 있는 동안 캔버스 위에
 * 아무것도 그리지 않고, onConfirm이 불리면 handleAcceptDraft가 그제서야
 * bins 전체를 실제 노드+성단 그룹으로 한 번에 materialize한다(nodes/edges를
 * 이 화면에 미리 채워 둘 필요가 없다 - 그 책임이 이제 여기 하나로 모였다).
 *
 * Esc는 의도적으로 아무 것도 하지 않는다 - 사용자가 반드시 셋 중 하나를
 * 선택하게 한다(대화 오버레이의 onDismiss와 다른 지점).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import { SpaceBackdrop } from "@/components/SpaceBackdrop";
import type { Bin } from "@/components/ElementBinPanel";
import type { CanvasPosition } from "@/components/ConstellationCanvas";
import type { DraftDto } from "@/lib/constellation-api";

export interface DraftReviewStageProps {
  drafts: DraftDto[];
  selected: number;
  bins: Bin[];
  onSelect: (index: number) => void;
  onConfirm: () => void;
  onReject: () => void;
}

// ---- 군집(bin) 배치 - 결정론적 황금각 나선(시드=인덱스, Math.random 없음).
// 이 무대의 미리보기와 확정 후 실제 캔버스 배치(page.tsx의 handleAcceptDraft)가
// 이 함수 하나를 공유해야 "스테이지에서 본 자리 부근"이라는 약속이 지켜진다 -
// page.tsx가 이 컴포넌트를 단방향으로만 import하므로(파일 상단 참고, 역방향
// import는 순환이라 금지) 여기서 export해 page.tsx가 가져다 쓰게 한다. 안을
// 갈아타도(onSelect) 이 좌표는 절대 다시 계산하지 않는다 - 그래야 core 강조와
// 간선만 바뀌는 게 "같은 하늘, 다른 별자리"로 읽힌다.
const CLUSTER_GOLDEN_ANGLE_RAD = 137.5 * (Math.PI / 180);
const CLUSTER_BASE_DISTANCE = 220;
const CLUSTER_DISTANCE_STEP = 130;
export function binClusterCenter(index: number): CanvasPosition {
  const angle = index * CLUSTER_GOLDEN_ANGLE_RAD;
  const radius = CLUSTER_BASE_DISTANCE + index * CLUSTER_DISTANCE_STEP;
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
}

// ConstellationCanvas의 성단 반지름 공식과 같은 상수를 그대로 옮겨왔다(§DESIGN
// "은은하게 크게") - 이 화면은 world 좌표가 아니라 고정 px 원(HTML span)이라
// *2로 지름 스케일만 맞춘다.
const CLUSTER_BASE_DIAMETER = 32;
const CLUSTER_DIAMETER_SCALE = 10;
const CLUSTER_MAX_DIAMETER = 68;

/** 8-point 별빛 글리프 - ConstellationIntakeChat/page.tsx의 StarGlyph와 같은
 * path. 그쪽들도 export되어 있지 않아(각자 화면 전용) 여기서도 그대로 옮겨왔다. */
function StarGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="var(--lit)" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
      <path d="M8 1.5 L8 14.5 M1.5 8 L14.5 8 M3.7 3.7 L12.3 12.3 M12.3 3.7 L3.7 12.3" />
    </svg>
  );
}

// "요소 N" 하나짜리 발췌 요약 대신, full-load 계약에 맞춰 "성단 N개 · 요소
// M개 · 핵심: [core 라벨들]"로 구성 요약을 바꾼다. 성단/요소 총량은 안마다
// 똑같다(모든 안이 같은 bins를 전부 싣는다) - 달라지는 건 core/tagline뿐이다.
function formatDraftBreakdown(draft: DraftDto, bins: Bin[]): string {
  const clusterCount = bins.length;
  const itemCount = bins.reduce((sum, bin) => sum + bin.items.length, 0);
  const core = draft.coreBinLabels.length > 0 ? ` · 핵심: ${draft.coreBinLabels.join(", ")}` : "";
  return `${draft.tagline} · 성단 ${clusterCount}개 · 요소 ${itemCount}개${core}`;
}

const PREVIEW_PADDING_RATIO = 0.12;
const MIN_SPAN = 40; // 군집이 한 점에 몰려 폭이나 높이가 0일 때의 최소 스팬(MiniConstellation과 동일)

/** world 좌표(군집 중심)를 미리보기 박스 안 0~100% 좌표로 편다.
 * MiniConstellation의 viewBox 계산과 같은 공식이지만, 결과를 SVG viewBox가
 * 아니라 좌표 자체(%)로 돌려준다 - 선(SVG)과 원/라벨(HTML)이 같은 매핑 함수를
 * 공유해야 서로 어긋나지 않기 때문. */
function usePreviewLayout(positions: CanvasPosition[]) {
  return useMemo(() => {
    if (positions.length === 0) return null;
    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
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
    // 극단에 있는 군집의 라벨(중앙 정렬이라 좌우로 반씩 뻗음)이 화면 밖으로
    // 나가지 않게 좌표를 7~93%로 클램프한다. 선과 원이 같은 함수를 쓰므로
    // 기하가 함께 밀려 어긋나지 않는다(정적 미리보기라 약간의 왜곡은 허용).
    const clamp = (v: number) => Math.min(Math.max(v, 7), 93);
    return (pos: CanvasPosition) => ({
      left: clamp(((pos.x - centerX) / totalSpanX + 0.5) * 100),
      top: clamp(((pos.y - centerY) / totalSpanY + 0.5) * 100),
    });
  }, [positions]);
}

export function DraftReviewStage({
  drafts,
  selected,
  bins,
  onSelect,
  onConfirm,
  onReject,
}: DraftReviewStageProps) {
  const currentDraft = drafts[selected] as DraftDto | undefined;

  // 군집 중심 좌표 - bins 개수에만 의존한다(내용이 바뀌어도 자리는 안 흔들려야
  // 하므로 bins.length를 dep으로 둔다, bins 배열 자체가 아니라).
  const clusterCenters = useMemo(
    () => bins.map((_, index) => binClusterCenter(index)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bins.length]
  );
  const toPct = usePreviewLayout(clusterCenters);

  // 라벨 -> bins 인덱스. 중복 라벨은 고려하지 않는다(먼저 찾은 것을 쓴다 -
  // 백엔드가 known_labels로 이미 교차 검증하므로 실사용에서 어긋날 일이 없다).
  const binIndexByLabel = useMemo(() => {
    const map = new Map<string, number>();
    bins.forEach((bin, index) => {
      if (!map.has(bin.label)) map.set(bin.label, index);
    });
    return map;
  }, [bins]);

  const coreLabelSet = useMemo(() => new Set(currentDraft?.coreBinLabels ?? []), [currentDraft]);

  // 성단 간 간선 - binEdges의 label 쌍을 bins 인덱스 쌍으로 해석한다. 알 수
  // 없는 라벨이나 자기 자신을 향한 쌍은 조용히 버린다(방어 - 백엔드가 이미
  // known_labels로 걸렀지만 defense in depth).
  const drawnEdges = useMemo(() => {
    if (!currentDraft) return [];
    return currentDraft.binEdges
      .map(([a, b]) => [binIndexByLabel.get(a), binIndexByLabel.get(b)] as const)
      .filter(
        (pair): pair is readonly [number, number] =>
          pair[0] !== undefined && pair[1] !== undefined && pair[0] !== pair[1]
      );
  }, [currentDraft, binIndexByLabel]);

  // 팬(pan) - 무대 배경 어디서든 드래그하면 그래프(엣지+군집+라벨)만 함께
  // 밀린다(패널/배너는 pointer-events로 분리돼 있어 이 레이어까지 안 옴).
  // 다른 안을 고르면 core/간선만 바뀔 뿐 군집 좌표는 그대로라 팬을 유지해도
  // 되지만, 기존 습관(안마다 다시 훑어본다)에 맞춰 여전히 0으로 되돌린다.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPan: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [selected]);

  const handlePanPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      panDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPan: pan,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pan]
  );

  const handlePanPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    setPan({
      x: drag.startPan.x + (e.clientX - drag.startClientX),
      y: drag.startPan.y + (e.clientY - drag.startClientY),
    });
    // ConstellationCanvas와 같은 배선: 이 프레임의 델타만 window에 쏴서
    // SpaceBackdrop이 관성 드리프트로 반응하게 한다(캔버스 코드 참고).
    window.dispatchEvent(
      new CustomEvent("ourlab:canvas-pan", { detail: { dx: e.movementX, dy: e.movementY } })
    );
  }, []);

  const handlePanPointerEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    panDragRef.current = null;
  }, []);

  return (
    <div role="region" aria-label="별자리 초안 검토" className="fixed inset-0 z-40 overflow-hidden bg-ink-900">
      {/* 가장 안쪽 레이어부터: 심우주 별밭 -> 격자 -> 그래프. */}
      <SpaceBackdrop />
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />

      {/* 상단 중앙 배너 - 시안의 pill 형태. 이 화면은 정적 미리보기라
          "끌어서 고친다"는 약속은 하지 않는다(그건 확정 후 캔버스의 일 -
          여기서 말하면 거짓 어포던스가 된다). pointer-events-none이라 팬
          서페이스보다 위(z-10)에 있어도 드래그를 가로채지 않는다. */}
      <div
        className="pointer-events-none fixed left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-rule bg-ink-800/95 px-5 py-2.5 shadow-lg backdrop-blur-md"
        role="status"
      >
        <StarGlyph size={14} />
        <span className="font-sans text-body-sm text-text-hi">
          대화를 바탕으로 별자리 초안을 그렸어요 — 마음에 드는 안을 골라 시작하세요
        </span>
      </div>

      {/* 팬 드래그 서페이스 - 무대 전체를 덮되 배너/패널은 별도 형제 요소라
          위에서 자기 이벤트를 먼저 가로챈다(z-index로 항상 위). 확대는
          범위 밖(요청 없음) - 이동만 지원한다. */}
      <div
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        aria-hidden
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerEnd}
        onPointerCancel={handlePanPointerEnd}
      >
        {/* 중앙 큰 미리보기 - 좌하단 패널과 겹치지 않게, 데스크톱에서는
            뷰포트의 26~90%(가로) / 12~88%(세로) 안에서 중앙 정렬한다
            (b95d752의 모바일 전폭 레이아웃은 그대로 둔다). */}
        <div className="absolute inset-x-0 bottom-[calc(46vh+var(--tabbar-h))] top-20 flex items-center justify-center px-6 md:left-[26%] md:right-[10%] md:top-[12%] md:bottom-[12%] md:px-0">
          {toPct ? (
            <div
              className="relative h-full max-h-[620px] w-full max-w-[760px]"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
            >
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                {drawnEdges.map(([aIndex, bIndex]) => {
                  const a = toPct(clusterCenters[aIndex]);
                  const b = toPct(clusterCenters[bIndex]);
                  // 양 끝 군집이 모두 core일 때만 "빛나는" 스타일 -
                  // ConstellationCanvas의 인접 발광 규칙(양 끝 완료 -> lit)과
                  // 같은 문법을 "완료" 대신 "핵심"에 대입한 것.
                  const lit = coreLabelSet.has(bins[aIndex].label) && coreLabelSet.has(bins[bIndex].label);
                  return (
                    <line
                      key={`${aIndex}-${bIndex}`}
                      x1={a.left}
                      y1={a.top}
                      x2={b.left}
                      y2={b.top}
                      stroke={lit ? "var(--lit)" : "rgb(255 243 196 / 0.3)"}
                      strokeWidth={lit ? 0.55 : 0.35}
                      opacity={lit ? 0.9 : 0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>

              {bins.map((bin, index) => {
                if (bin.items.length === 0) return null; // 아직 안 채워진(또는 채우기 실패한) 빈 군집 - 그릴 게 없다.
                const pos = toPct(clusterCenters[index]);
                const isCore = coreLabelSet.has(bin.label);
                const count = bin.items.length;
                const dominantType = bin.items[0].type;
                const sameType = bin.items.every((item) => item.type === dominantType);
                const color = sameType ? colorForType(dominantType) : "var(--text-hi)";
                const diameter = Math.min(
                  CLUSTER_MAX_DIAMETER,
                  CLUSTER_BASE_DIAMETER + Math.log2(count + 1) * CLUSTER_DIAMETER_SCALE
                );
                return (
                  <div
                    key={bin.id}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  >
                    <div
                      aria-hidden
                      className={cn("relative rounded-full", isCore && "shadow-glow-bloom")}
                      style={{
                        width: diameter,
                        height: diameter,
                        background: color,
                        opacity: isCore ? 0.9 : 0.4,
                        border: `1px solid ${color}`,
                      }}
                    >
                      {/* 멤버 수 배지 - 숫자이므로 font-mono(한글 아님, No-Korean-Mono 규칙과 무관). */}
                      <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border border-rule bg-ink-800 px-1 font-mono text-[9px] text-text-hi">
                        {count}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "mt-1.5 max-w-[140px] truncate text-center font-serif text-body-sm",
                        isCore ? "text-text-hi" : "text-text-lo"
                      )}
                      title={bin.label}
                    >
                      {bin.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="font-sans text-sm text-text-lo">그릴 군집이 없어요</p>
          )}
        </div>
      </div>

      {/* 좌하단 "추천 별자리" 패널 - page.tsx의 옛 DraftOfferPanel과 같은
          레이아웃/문구/버튼 클래스를 그대로 옮겨왔다(승인된 시안 그대로).
          팬 서페이스는 형제 요소라 이 패널 위에서 시작한 포인터는 원래
          거기로 안 새지만(topmost hit-test), 혹시 몰라 명시적으로도 막는다. */}
      <aside
        role="region"
        aria-label="추천 별자리"
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          "fixed z-20 flex flex-col overflow-hidden rounded-xl border border-rule bg-ink-800/95 shadow-lg backdrop-blur-md",
          "inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] max-h-[46vh]",
          "md:inset-x-auto md:bottom-6 md:left-4 md:top-auto md:h-auto md:max-h-none md:w-[300px]"
        )}
      >
        <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
          {/* 시안: 패널 제목은 별자리 이름과 같은 세리프(디스플레이) 어휘 */}
          <h2 className="font-serif text-heading font-bold text-text-hi">추천 별자리</h2>
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
                  "w-full rounded-md border-l-2 px-2.5 py-2 text-left transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b",
                  // 시안: 선택된 안은 발광선(lit)과 같은 노란 좌측 보더로 표시
                  isSelected ? "border-l-lit bg-ink-700/70" : "border-l-transparent hover:bg-ink-700/60"
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
            className="rounded-md bg-spec-b px-3 py-1.5 font-sans text-sm font-medium text-ink-900 transition-colors hover:bg-spec-a focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
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
