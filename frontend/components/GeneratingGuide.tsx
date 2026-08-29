"use client";

/*
 * 인테이크 종료 후 잡 대기창의 로더 + 사용법 가이드(사용자 지시 2건).
 *
 * 1) 로더: 매번 랜덤 생성되는 미니 별자리에서 달성 불이 노드에서 노드로
 *    옮겨가는 모션(메인 캔버스의 lit·드로우온 어휘 축약판). 난수는
 *    mulberry32 시드 기반(SpaceBackdrop 관례 - Math.random 금지), 시드는
 *    마운트마다 달라져 "별자리 랜덤생성"을 만족한다.
 * 2) 캐러셀: 5장 + 하단 점 인디케이터(활성=lit). 1장은 실캔버스와 무관한
 *    미니 인터랙티브 플레이그라운드(더블클릭=달성 점등, 바깥 점선 링에서
 *    crosshair로 끌면 실제로 간선이 이어짐), 2~5장은 실기 스크린샷
 *    (public/guide/*)에 코드 오버레이 라벨(이미지에 텍스트를 굽지 않는다).
 *
 * 모션은 전부 CSS transition/opacity 계열 - prefers-reduced-motion 전역
 * 킬 스위치의 지배를 받는다.
 */

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "@/components/ui/icons";
import {
  ConstellationCanvas,
  type CanvasEdge,
  type CanvasNode,
} from "@/components/ConstellationCanvas";

/* ── 시드 난수 (SpaceBackdrop의 mulberry32 관례) ─────────────── */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 1. 로더: 불이 옮겨가는 랜덤 미니 별자리 ─────────────────── */
const LOADER_W = 220;
const LOADER_H = 140;

interface LoaderShape {
  nodes: { x: number; y: number; r: number }[];
  /** 불이 켜지는 방문 순서(최근접 이웃 체인 - 별자리답게 이어진다). */
  order: number[];
}

function genConstellation(seed: number): LoaderShape {
  const rand = mulberry32(seed);
  const count = 6 + Math.floor(rand() * 4); // 6~9
  const nodes: { x: number; y: number; r: number }[] = [];
  let guard = 0;
  while (nodes.length < count && guard < 200) {
    guard += 1;
    const x = 18 + rand() * (LOADER_W - 36);
    const y = 16 + rand() * (LOADER_H - 32);
    if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) > 32)) {
      nodes.push({ x, y, r: 3 + rand() * 2.5 });
    }
  }
  // 최근접 이웃 체인: 가장 왼쪽 별에서 시작해 가까운 별로 계속 잇는다.
  const remaining = nodes.map((_, i) => i);
  remaining.sort((a, b) => nodes[a]!.x - nodes[b]!.x);
  const order = [remaining.shift()!];
  while (remaining.length > 0) {
    const cur = nodes[order[order.length - 1]!]!;
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((ni, idx) => {
      const d = Math.hypot(nodes[ni]!.x - cur.x, nodes[ni]!.y - cur.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    order.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return { nodes, order };
}

function ConstellationLoader() {
  // 마운트마다 다른 별자리(사용자: "별자리 랜덤생성"). 대기 화면은 사용자
  // 제스처 뒤에만 마운트되므로 하이드레이션 불일치 여지가 없다.
  const [seed] = useState(() => (Date.now() % 2147483647) | 1);
  const { nodes, order } = useMemo(() => genConstellation(seed), [seed]);
  const [litCount, setLitCount] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      // 끝까지 다 켜지면 처음 하나로 돌아가 다시 이어간다.
      setLitCount((c) => (c >= order.length ? 1 : c + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [order.length]);

  return (
    <svg
      width={LOADER_W}
      height={LOADER_H}
      viewBox={`0 0 ${LOADER_W} ${LOADER_H}`}
      fill="transparent"
      aria-hidden
      className="overflow-visible"
    >
      {/* 간선: 방금 켜진 별을 향해 드로우온(캔버스 edgeDrawOn 축약판). */}
      {order.slice(0, -1).map((fromIdx, k) => {
        const from = nodes[fromIdx]!;
        const to = nodes[order[k + 1]!]!;
        const lit = k + 1 < litCount;
        return (
          <line
            key={k}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            pathLength={1}
            stroke="var(--lit)"
            strokeWidth="1.3"
            strokeDasharray="1"
            strokeDashoffset={lit ? 0 : 1}
            opacity={lit ? 0.85 : 0}
            style={{ transition: "stroke-dashoffset 650ms cubic-bezier(.22,1,.36,1), opacity 300ms" }}
          />
        );
      })}
      {nodes.map((n, i) => {
        const orderPos = order.indexOf(i);
        const lit = orderPos < litCount;
        const isLatest = orderPos === litCount - 1;
        return (
          <g key={i}>
            {/* 발광 헤일로 - 최근 점등 별은 더 크게. */}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r + (isLatest ? 7 : 4)}
              fill="var(--lit)"
              opacity={lit ? (isLatest ? 0.3 : 0.16) : 0}
              style={{ transition: "opacity 500ms" }}
            />
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={lit ? "var(--lit)" : "var(--rule)"}
              opacity={lit ? 1 : 0.6}
              style={{ transition: "fill 400ms, opacity 400ms" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

/* ── 2-1. 슬라이드 1: 실캔버스 연습장 ────────────────────────── */
/* 흉내 SVG가 아니라 진짜 ConstellationCanvas를 로컬 state로 임베드한다
 * (사용자 지적: "UI대충만들지 말고 메인페이지 캔버스랑 똑같이" — 핸들 링
 * 히트 영역·십자 커서·달성 연출이 실물과 동일해야 한다). 저장/서버 호출은
 * 없고 전부 이 컴포넌트의 로컬 상태다. */
const PLAYGROUND_NODES: Record<string, CanvasNode> = {
  "pg-a": { id: "pg-a", label: "회계원리", type: "course", isCompleted: false, position: { x: -130, y: 70 } },
  "pg-b": { id: "pg-b", label: "경영통계", type: "course", isCompleted: false, position: { x: 10, y: -60 } },
  "pg-c": { id: "pg-c", label: "학회 활동", type: "organization", isCompleted: false, position: { x: 150, y: 80 } },
};

function CanvasPlayground() {
  const [nodes, setNodes] = useState<Record<string, CanvasNode>>(PLAYGROUND_NODES);
  const [edges, setEdges] = useState<Record<string, CanvasEdge>>({});
  const edgeSeq = useRef(0);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="relative h-[420px] w-full overflow-hidden rounded-lg border border-rule md:h-[560px]">
        <ConstellationCanvas
          nodes={nodes}
          edges={edges}
          fitRequest={1}
          onNodeDrag={(nodeId, position) =>
            setNodes((prev) => {
              const cur = prev[nodeId];
              return cur ? { ...prev, [nodeId]: { ...cur, position } } : prev;
            })
          }
          onNodeToggleComplete={(nodeId) =>
            setNodes((prev) => {
              const cur = prev[nodeId];
              return cur ? { ...prev, [nodeId]: { ...cur, isCompleted: !cur.isCompleted } } : prev;
            })
          }
          onEdgeCreate={(sourceNodeId, targetNodeId) =>
            setEdges((prev) => {
              const exists = Object.values(prev).some(
                (ed) =>
                  (ed.sourceNodeId === sourceNodeId && ed.targetNodeId === targetNodeId) ||
                  (ed.sourceNodeId === targetNodeId && ed.targetNodeId === sourceNodeId)
              );
              if (exists) return prev;
              edgeSeq.current += 1;
              const id = `pg-edge-${edgeSeq.current}`;
              return { ...prev, [id]: { id, sourceNodeId, targetNodeId } };
            })
          }
          onEdgeDelete={(edgeId) =>
            setEdges((prev) => {
              const next = { ...prev };
              delete next[edgeId];
              return next;
            })
          }
        />
      </div>
      <p className="text-center text-caption leading-relaxed text-text-lo">
        별을 <b className="text-text-hi">더블클릭</b>하면 달성으로 빛나요 · 별 바깥 링에서 커서가{" "}
        <b className="text-text-hi">십자</b>로 바뀌면 끌어서 다른 별과 이어보세요 · 빈 곳을 끌면 하늘이 움직여요
      </p>
    </div>
  );
}

/* ── 2-2. 슬라이드 2~5: 스크린샷 + 오버레이 라벨 ─────────────── */
interface SlideLabel {
  x: number; // % - 점(앵커)의 위치
  y: number; // %
  text: string;
  /** right면 텍스트가 점의 왼쪽으로 펼쳐진다(우측 가장자리 라벨용). */
  align?: "right";
}

function AnnotatedShot({ src, alt, labels }: { src: string; alt: string; labels: SlideLabel[] }) {
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-rule">
      <Image src={src} alt={alt} width={1440} height={900} className="h-auto w-full" unoptimized />
      {/* 주석 라벨 - 버튼처럼 보여 눌린다는 지적으로 칩을 버리고 지시선+텍스트
          톤으로. 레이어 전체 pointer-events 차단(비인터랙티브임이 읽히게). */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {labels.map((label, i) => (
          <span
            key={i}
            className={cn(
              "absolute flex max-w-[52%] -translate-y-1/2 items-center gap-1.5",
              label.align === "right" && "-translate-x-full flex-row-reverse"
            )}
            style={{ left: `${label.x}%`, top: `${label.y}%` }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-lit shadow-[0_0_8px_rgba(255,243,196,0.8)]" />
            <span className="h-px w-4 shrink-0 bg-lit/50" />
            <span className="font-sans text-micro font-medium leading-snug text-text-hi [text-shadow:0_1px_4px_rgba(4,6,11,0.95),0_0_10px_rgba(4,6,11,0.8)]">
              {label.text}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── 2-3. 캐러셀 본체 ────────────────────────────────────────── */
interface GuideSlide {
  key: string;
  title: string;
  body: React.ReactNode;
}

const SLIDES: GuideSlide[] = [
  {
    key: "canvas-control",
    title: "캔버스에서 별 다루기",
    body: <CanvasPlayground />,
  },
  {
    key: "canvas-tools",
    title: "꾸미고, 기록하고, 띄우기",
    body: (
      <AnnotatedShot
        src="/guide/main-canvas.png"
        alt="메인 캔버스 화면"
        labels={[
          { x: 62, y: 4.5, text: "편집 — 별·연결선 색과 달성 연출 고르기", align: "right" },
          { x: 96, y: 12, text: "노트 — 마크다운 노트·수업자료 정리", align: "right" },
          { x: 96, y: 30, text: "AI가 제안한 요소 보관함 — 끌어다 놓기", align: "right" },
          { x: 60, y: 94, text: "별자리 띄우기 — 프로필에 발행", align: "right" },
        ]}
      />
    ),
  },
  {
    key: "social",
    title: "소셜 — 게시물과 스토리",
    body: (
      <AnnotatedShot
        src="/guide/feed.png"
        alt="소셜 피드 화면"
        labels={[
          { x: 9, y: 22, text: "소셜 탭" },
          { x: 59, y: 27, text: "24시간 스토리 링이 여기 떠요" },
          { x: 59, y: 55, text: "사진 게시물 스트림 — 별 모양 좋아요·댓글·공유" },
        ]}
      />
    ),
  },
  {
    key: "community",
    title: "커뮤니티 — 익명으로 편하게",
    body: (
      <AnnotatedShot
        src="/guide/community.png"
        alt="커뮤니티 게시판 화면"
        labels={[
          { x: 42, y: 35, text: "게시판 6곳 — 기본 익명, 실명은 선택", align: "right" },
          { x: 63, y: 35, text: "비밀 게시판은 항상 익명" },
        ]}
      />
    ),
  },
  {
    key: "explore",
    title: "탐색 — 같은 별을 보는 사람",
    body: (
      <AnnotatedShot
        src="/guide/explore.png"
        alt="탐색 화면"
        labels={[
          { x: 59, y: 29, text: "이름으로 검색" },
          { x: 33, y: 63, text: "관심사 태그 — 별자리를 띄우면 자동으로 쌓이고, 겹치면 별빛으로 빛나요" },
        ]}
      />
    ),
  },
];

function UsageGuideCarousel() {
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const slide = SLIDES[idx]!;

  function go(delta: number): void {
    setIdx((cur) => Math.min(SLIDES.length - 1, Math.max(0, cur + delta)));
  }

  return (
    <div
      className="flex w-full flex-col items-center gap-3"
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        if (start === null) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) < 40) return;
        go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <button
          type="button"
          aria-label="이전 안내"
          onClick={() => go(-1)}
          disabled={idx === 0}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-lo transition-colors hover:text-text-hi disabled:opacity-30"
        >
          <ChevronLeftIcon size={17} />
        </button>
        <h3 className="text-center font-sans text-body-sm font-semibold text-text-hi">{slide.title}</h3>
        <button
          type="button"
          aria-label="다음 안내"
          onClick={() => go(1)}
          disabled={idx === SLIDES.length - 1}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-lo transition-colors hover:text-text-hi disabled:opacity-30"
        >
          <ChevronRightIcon size={17} />
        </button>
      </div>

      <div className="w-full">{slide.body}</div>

      {/* 점 인디케이터 - 활성 점만 lit(사용자 지시의 "작은 페이지" 문법). */}
      <div className="flex items-center gap-2.5" role="tablist" aria-label="사용법 안내 페이지">
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={i === idx}
            aria-label={`${i + 1}번째 안내: ${s.title}`}
            onClick={() => setIdx(i)}
            className={cn(
              "h-[7px] w-[7px] rounded-full transition-colors",
              i === idx ? "bg-lit shadow-[0_0_10px_rgba(255,243,196,0.6)]" : "border border-rule bg-transparent"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/* ── 튜토리얼 다이얼로그 - "크게 전환"(사용자 지시) ──────────── */
function TutorialDialog({ onClose }: { onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Esc 닫기 + 경량 포커스 트랩(StoryViewer 패턴) + 닫힐 때 포커스 복원.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      prevFocus?.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="OurLab 사용법"
      className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/85 p-3 backdrop-blur-sm md:p-8"
    >
      <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-y-auto rounded-xl border border-rule bg-ink-800/95 px-4 pb-5 pt-4 shadow-panel md:px-8 md:pb-7 md:animate-[islandExpand_220ms_cubic-bezier(.22,1,.36,1)]">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-serif text-lg font-bold text-text-hi">OurLab 사용법</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="로딩 화면으로 돌아가기"
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-lo transition-colors hover:bg-ink-700 hover:text-text-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
          >
            <CloseIcon size={17} />
          </button>
        </div>
        <UsageGuideCarousel />
      </div>
    </div>
  );
}

/* ── 조립: 정중앙 로더, 버튼으로 튜토리얼 전환(사용자 지시) ───── */
export function GeneratingGuide() {
  const [tutorialOpen, setTutorialOpen] = useState(false);

  return (
    <>
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 px-6 py-10">
        <ConstellationLoader />
        <p className="font-serif text-xl text-text-hi" role="status" aria-live="polite">
          별자리 초안을 그리는 중…
        </p>
        <p className="text-center text-caption text-text-lo">몇 분 정도 걸려요</p>
        <button
          type="button"
          onClick={() => setTutorialOpen(true)}
          className="mt-4 rounded-full border border-rule px-5 py-2.5 font-sans text-sm text-text-hi transition-colors hover:border-lit focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spec-b"
        >
          사용법 익히기
        </button>
      </div>
      {/* 로딩이 끝나면 GeneratingStage 자체가 언마운트되므로 튜토리얼이 열려
          있어도 시안 스테이지로 자연 전환된다. */}
      {tutorialOpen && <TutorialDialog onClose={() => setTutorialOpen(false)} />}
    </>
  );
}
