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
 * 성운 다이브인 - 성단을 클릭하면 그 자리를 중심으로 하늘 전체가 확대되며
 * (단일 wrapper의 transform CSS 전환, 요소별 애니메이션 아님) 풀뷰포트
 * 내부 뷰로 전환된다. 내부에서는 멤버가 별자리 펼쳐지듯 스태거로 등장한다
 * (computeExpandedLayout 포스 시뮬을 그대로 재사용 - 성단 미리보기와 내부
 * 뷰가 "같은 모양, 다른 크기"로 보이게). 확정 시 materialize되는 실제
 * 좌표(binClusterCenter)와는 무관한 "미리보기 전용" 연출이라, 다이브
 * 인/아웃을 반복해도 확정 결과는 절대 바뀌지 않는다(handleAcceptDraft는
 * 여전히 bins 원본만 읽는다).
 *
 * Esc: 하늘 전체 뷰에서는 의도적으로 아무 것도 하지 않는다(사용자가 반드시
 * 좌하단 패널의 셋 중 하나를 선택하게 한다) - 성운 내부로 다이브인한
 * 동안에만 "성운 밖으로"와 같은 동작(diveOut)을 한다.
 *
 * 성단 히트 타깃 버그(실통합 3중 검증 완료): 배경 팬 레이어가 모든
 * pointerdown에서 조상에 setPointerCapture를 걸면 중첩된 성단의 네이티브
 * click이 영영 발생하지 않는다. ConstellationCanvas의 beginGroupDrag와
 * 같은 패턴으로 고쳤다 - 성단 자체 히트 타깃에서 pointerdown 시
 * stopPropagation + 자기 자신에 캡처 + 이동 임계값(CLUSTER_CLICK_THRESHOLD)
 * 으로 클릭/드래그를 분리한다.
 *
 * 성운 내부 위계 레이아웃(사용자 지시: "선수과목 순으로 위계가 한눈에
 * 들어오도록"): 내부 뷰는 선수관계 위계로 층을 쌓는다. 과목마다 미리
 * 이어두지 않고, 다이브인 순간 온디맨드로 백엔드(/api/constellation-intake/
 * prereqs)를 호출해 그 bin의 선수관계를 받아 items에 캐시한다(대원칙 -
 * API가 그때그때 적용). 간선이 하나도 없으면 level(학정번호 앞자리) 층으로
 * 폴백하고, 그마저도 없는 지원요소 bin은 기존 포스 시뮬 배치를 그대로 쓴다.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "@/lib/cn";
import { colorForType } from "@/lib/element-colors";
import { SpaceBackdrop } from "@/components/SpaceBackdrop";
import { splitCourseCode, type Bin, type BinItem } from "@/components/ElementBinPanel";
import type { CanvasPosition } from "@/components/ConstellationCanvas";
import { inferPrereqs, type DraftDto } from "@/lib/constellation-api";

export interface DraftReviewStageProps {
  drafts: DraftDto[];
  selected: number;
  bins: Bin[];
  onSelect: (index: number) => void;
  onConfirm: () => void;
  onReject: () => void;
  /** 온디맨드 선수관계 조회(/prereqs)가 끝나면 알려준다 - key는 후수(after)
   * 항목 id, value는 그 항목의 선수(before) id 배열. bins state는 여기서
   * 직접 바꾸지 않는다(page.tsx가 소유) - 부모가 불변 업데이트로 병합한다. */
  onPrereqsResolved?: (binId: string, prereqsByItemId: Record<string, string[]>) => void;
}

// ---- 군집(bin) 배치 - 결정론적 황금각 나선(시드=인덱스, Math.random 없음).
// 이 무대의 미리보기와 확정 후 실제 캔버스 배치(page.tsx의 handleAcceptDraft)가
// 이 함수 하나를 공유해야 "스테이지에서 본 자리 부근"이라는 약속이 지켜진다 -
// page.tsx가 이 컴포넌트를 단방향으로만 import하므로(파일 상단 참고, 역방향
// import는 순환이라 금지) 여기서 export해 page.tsx가 가져다 쓰게 한다. 안을
// 갈아타도(onSelect) 이 좌표는 절대 다시 계산하지 않는다 - 그래야 core 강조와
// 간선만 바뀌는 게 "같은 하늘, 다른 별자리"로 읽힌다.
const CLUSTER_GOLDEN_ANGLE_RAD = 137.5 * (Math.PI / 180);
// 반경은 √index(필로택시스)로 키운다 - index 선형 증가(220+130i)는 17군집이면
// 반경 2,300px까지 퍼져 확정 후 캔버스 fit 줌이 극단으로 축소됐다(실측: 성단
// 17개가 한 덩어리로 보임). √ 스케일은 군집 수와 무관하게 밀도가 균일하다.
const CLUSTER_RADIUS_STEP = 240;
export function binClusterCenter(index: number): CanvasPosition {
  const angle = index * CLUSTER_GOLDEN_ANGLE_RAD;
  const radius = CLUSTER_RADIUS_STEP * Math.sqrt(index + 0.6);
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
}

// ConstellationCanvas의 성단 반지름 공식과 같은 상수를 그대로 옮겨왔다(§DESIGN
// "은은하게 크게") - 이 화면은 world 좌표가 아니라 고정 px 원(HTML span)이라
// *2로 지름 스케일만 맞춘다. MAX_DIAMETER 68→84는 "성단 많다고 과축소된" 실측
// 피드백에 따른 소폭 확대(usePreviewLayout의 패딩/클램프 완화와 함께 간다).
const CLUSTER_BASE_DIAMETER = 32;
const CLUSTER_DIAMETER_SCALE = 10;
const CLUSTER_MAX_DIAMETER = 84;
function clusterDiameterFor(count: number): number {
  return Math.min(CLUSTER_MAX_DIAMETER, CLUSTER_BASE_DIAMETER + Math.log2(count + 1) * CLUSTER_DIAMETER_SCALE);
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

// "요소 N" 하나짜리 발췌 요약 대신, full-load 계약에 맞춰 "성단 N개 · 요소
// M개 · 핵심: [core 라벨들]"로 구성 요약을 바꾼다. 성단/요소 총량은 안마다
// 똑같다(모든 안이 같은 bins를 전부 싣는다) - 달라지는 건 core/tagline뿐이다.
function formatDraftBreakdown(draft: DraftDto, bins: Bin[]): string {
  const clusterCount = bins.length;
  const itemCount = bins.reduce((sum, bin) => sum + bin.items.length, 0);
  const core = draft.coreBinLabels.length > 0 ? ` · 핵심: ${draft.coreBinLabels.join(", ")}` : "";
  return `${draft.tagline} · 성단 ${clusterCount}개 · 요소 ${itemCount}개${core}`;
}

// 패딩 0.12→0.06 + 클램프 7~93→5~95: "성단 많다고 과축소" 피드백에 대응해
// 미리보기가 박스를 더 꽉 채우게 한다(팬으로 가장자리를 커버할 수 있으니
// 약간 넘쳐도 괜찮다).
const PREVIEW_PADDING_RATIO = 0.06;
const MIN_SPAN = 40; // 군집이 한 점에 몰려 폭이나 높이가 0일 때의 최소 스팬(MiniConstellation과 동일)
const PREVIEW_CLAMP_MIN = 5;
const PREVIEW_CLAMP_MAX = 95;

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
    // 나가지 않게 좌표를 5~95%로 클램프한다. 선과 원이 같은 함수를 쓰므로
    // 기하가 함께 밀려 어긋나지 않는다(정적 미리보기라 약간의 왜곡은 허용).
    const clamp = (v: number) => Math.min(Math.max(v, PREVIEW_CLAMP_MIN), PREVIEW_CLAMP_MAX);
    return (pos: CanvasPosition) => ({
      left: clamp(((pos.x - centerX) / totalSpanX + 0.5) * 100),
      top: clamp(((pos.y - centerY) / totalSpanY + 0.5) * 100),
    });
  }, [positions]);
}

// ---- 시드 고정 PRNG (SpaceBackdrop/GeneratingGuide의 mulberry32 관례) ----
// Math.random 금지: 같은 성단·같은 아이템은 항상 같은 입자 자리/펼침 초기
// 위치를 낸다(리렌더·재전개 때 "글리치"로 안 보이게).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 문자열 해시 - bin.id/group.id(문자열)를 정수 시드로 바꾼다.
// ConstellationCanvas의 접힌 성단도 이 함수로 그룹 id를 시드화해 쓴다(아래
// export - "성운 안개+입자" 비주얼을 시안과 메인 캔버스가 공유하는 단일
// 진실 공급원. 캔버스는 그룹 배열 순서가 고정돼 있지 않아(Record 순회) 이
// 스테이지처럼 clusterIndex를 시드로 쓸 수 없어 id 해시가 필수다).
export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- 성운 입자 - 성단 원 안에 흩뿌리는 "자글자글한" 미니 별들 ----
// ConstellationCanvas와 공유하기 위해 Bin에 묶이지 않은 최소 모양(멤버
// 유형만 필요)으로 잡는다 - bin.items든 group의 memberNodes든 그대로 넘긴다.
export interface NebulaMember {
  type: string;
}
export const PARTICLE_CAP = 40; // 멤버가 아주 많아도 DOM 노드가 폭주하지 않게
export interface NebulaParticle {
  x: number; // 원 중심 기준 px 오프셋
  y: number;
  size: number;
  color: string;
  twinkleDur: number;
  twinkleDelay: number;
  twinkleLo: number;
  twinkleHi: number;
}
/** seed는 호출자가 정한다 - 이 스테이지는 clusterIndex(안정적인 bins 배열
 * 순서)를, ConstellationCanvas는 hashSeed(group.id)(순서 불안정한 Record라
 * id 해시가 필요)를 넘긴다. */
export function buildNebulaParticles(
  seed: number,
  members: NebulaMember[],
  diameter: number,
  dominantColor: string
): NebulaParticle[] {
  const count = Math.min(members.length, PARTICLE_CAP);
  const mixed = !members.every((m) => m.type === members[0]?.type);
  const maxR = diameter / 2 - 2; // 테두리 살짝 안쪽까지만
  const particles: NebulaParticle[] = [];
  for (let i = 0; i < count; i++) {
    // 성단 seed와 아이템 index를 서로 다른 소수로 섞어 시드를 뽑는다 - 옆
    // 성단·옆 입자끼리 같은 패턴으로 뭉쳐 보이지 않게(hashNodeId 주석과
    // 같은 이유로 축을 분리).
    const rand = mulberry32((seed * 7919 + i * 104729) >>> 0);
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * maxR; // 균일 원반 분포(가장자리에 쏠리지 않게)
    particles.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: 1.6 + rand() * 1.4,
      color: mixed ? colorForType(members[i].type) : dominantColor,
      twinkleDur: 2.4 + rand() * 2.4,
      twinkleDelay: rand() * 3,
      twinkleLo: 0.15 + rand() * 0.15,
      twinkleHi: 0.65 + rand() * 0.3,
    });
  }
  return particles;
}

// ---- 성운 내부 전개 - 옵시디언 그래프뷰풍 경량 포스 시뮬(외부 라이브러리
// 없이 자체 반복 완화). 성단 미리보기 원과 다이브인 내부 뷰가 모두 이 하나의
// 순수 함수를 공유한다(스케일만 다르게 입힌다 - 아래 interiorLayoutFor) ----
// 1순위 목적은 "내용물 열람"이다(라벨을 항상 읽을 수 있어야 함) - 그래서
// 최소 간격을 라벨 폭을 넉넉히 감안한 값으로 잡는다. 진짜 옵시디언처럼 라벨
// 겹침을 감지해 지시선을 긋는 것까지는 하지 않는다(과한 스코프) - 대신 간격
// 자체를 넓게 둬서 실용적으로 안 겹치게 한다.
// ponytail: 라벨 충돌 회피/지시선 미도입 - 넉넉한 척력 간격으로 대신한다.
// 실측에서 라벨이 자주 겹치면 그때 추가한다.
const EXPAND_MIN_DIST = 30; // 이 거리 안이면 척력 작동
const EXPAND_REPEL = 1400; // 척력 계수
const EXPAND_SPRING_K = 0.02; // 중심으로 은은하게 당기는 스프링(전체가 흩어지지 않게)
const EXPAND_ITERATIONS = 120;
const EXPAND_STEP = 0.12; // 반복당 이동 배율
const EXPAND_MAX_STEP = 6; // 반복당 최대 이동(px) - 폭주 방지

interface Vec2 {
  x: number;
  y: number;
}

/** 성단 중심(0,0) 기준 컴팩트한 상대 배치를 계산한다 - 순수 함수, count와
 * seed에만 의존해 항상 같은 결과를 낸다(px 단위지만 작은 반경 - 실제 화면
 * 크기로 펴는 건 interiorLayoutFor의 몫). */
function computeExpandedLayout(count: number, seed: number): Vec2[] {
  if (count === 0) return [];
  const rand = mulberry32(seed);
  const pts: Vec2[] = Array.from({ length: count }, () => {
    const angle = rand() * Math.PI * 2;
    const r = 6 + rand() * 14;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
  for (let iter = 0; iter < EXPAND_ITERATIONS; iter++) {
    const disp: Vec2[] = pts.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const distSq = dx * dx + dy * dy || 0.0001;
        const dist = Math.sqrt(distSq);
        if (dist < EXPAND_MIN_DIST * 2) {
          const force = EXPAND_REPEL / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp[i].x += fx;
          disp[i].y += fy;
          disp[j].x -= fx;
          disp[j].y -= fy;
        }
      }
      // 중심 스프링 - 척력만 있으면 전체가 무한히 퍼지므로 원점으로 당겨
      // 성단 하나로 묶어 둔다.
      disp[i].x += -pts[i].x * EXPAND_SPRING_K;
      disp[i].y += -pts[i].y * EXPAND_SPRING_K;
    }
    for (let i = 0; i < count; i++) {
      let dx = disp[i].x * EXPAND_STEP;
      let dy = disp[i].y * EXPAND_STEP;
      const mag = Math.hypot(dx, dy);
      if (mag > EXPAND_MAX_STEP) {
        dx = (dx / mag) * EXPAND_MAX_STEP;
        dy = (dy / mag) * EXPAND_MAX_STEP;
      }
      pts[i].x += dx;
      pts[i].y += dy;
    }
  }
  return pts;
}

// 다이브인 내부 뷰 전용(위계 정보가 전무한 지원요소 bin의 폴백) -
// computeExpandedLayout의 컴팩트 좌표를 뷰포트를 채우도록 스케일만 키운다
// (포스 시뮬 재계산 없음 - 성단 미리보기와 내부 뷰가 "같은 모양, 다른
// 크기"로 보이게 하기 위함).
const INTERIOR_FILL_RATIO = 0.34; // 뷰포트 짧은 변 대비 배치 반경 비율
function interiorForceLayoutFallback(
  count: number,
  seed: number,
  viewport: { width: number; height: number }
): Vec2[] {
  const raw = computeExpandedLayout(count, seed);
  if (raw.length === 0) return raw;
  const maxR = Math.max(...raw.map((p) => Math.hypot(p.x, p.y)), 1);
  const targetR = Math.min(viewport.width, viewport.height) * INTERIOR_FILL_RATIO;
  const scale = targetR / maxR;
  return raw.map((p) => ({ x: p.x * scale, y: p.y * scale }));
}

// ---- 선수과목 위계 레이아웃 - "과목마다 미리 이어놓지 않고, 대원칙(최장경로
// 랭크)을 세워 API가 그때그때 채운 prereqIds에 적용한다"(사용자 지시) ----

/** items 안에서 유효한 선수 간선(같은 bin에 있는 id만, 자기참조 제외)이
 * 하나라도 있는지 - 간선이 전무하면 rank는 level 폴백으로 넘어간다. */
function hasAnyPrereqEdge(items: BinItem[], idSet: Set<string>): boolean {
  return items.some((item) => (item.prereqIds ?? []).some((pid) => idSet.has(pid) && pid !== item.id));
}

/** prereqIds 그래프에서 item의 최장경로 깊이(rank) - memo + visiting set으로
 * 순환 시 0을 반환한다(백엔드가 DAG를 보장하지만 UI는 절대 멈추면 안 된다).
 * 같은 bin에 없는 id(dangling - 항목 삭제 시 청소 안 하는 게으름을 여기서
 * 흡수)는 무시한다. */
function computeRank(
  item: BinItem,
  byId: Map<string, BinItem>,
  memo: Map<string, number>,
  visiting: Set<string>
): number {
  const cached = memo.get(item.id);
  if (cached !== undefined) return cached;
  if (visiting.has(item.id)) return 0; // 순환 방어 - 렌더가 절대 멈추면 안 된다.
  visiting.add(item.id);
  let maxParentRank = -1;
  for (const pid of item.prereqIds ?? []) {
    const parent = byId.get(pid);
    if (!parent || parent.id === item.id) continue; // dangling/자기참조 무시
    const parentRank = computeRank(parent, byId, memo, visiting);
    if (parentRank > maxParentRank) maxParentRank = parentRank;
  }
  visiting.delete(item.id);
  const rank = maxParentRank + 1;
  memo.set(item.id, rank);
  return rank;
}

const ROW_GAP_MAX = 140; // 층 사이 최대 간격(px)
const ROW_GAP_VIEWPORT_RATIO = 0.72; // 뷰포트 세로 대비 전체 층 배치가 차지할 비율
const ROW_X_FILL_RATIO = INTERIOR_FILL_RATIO * 2; // 기존 가로 채움 비율(폴백과 동일 스케일 감각)을 재사용

/** 다이브인 내부 뷰의 멤버 배치 - items 순서로 좌표를 돌려준다(호출부가
 * items[i] <-> positions[i]로 인덱싱).
 *
 * 1. prereqIds 그래프에 유효한 간선이 있으면 최장경로 rank로 층을 쌓는다.
 * 2. 간선이 없으면 level(학정번호 앞자리)만으로 층을 쌓는다.
 * 3. rank도 level도 전무하면(지원요소 bin) 기존 포스 시뮬 배치로 폴백한다.
 */
function interiorLayoutFor(items: BinItem[], seed: number, viewport: { width: number; height: number }): Vec2[] {
  const idSet = new Set(items.map((item) => item.id));
  const anyEdges = hasAnyPrereqEdge(items, idSet);
  const anyLevel = items.some((item) => typeof item.level === "number");
  if (!anyEdges && !anyLevel) {
    return interiorForceLayoutFallback(items.length, seed, viewport);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const ranks = items.map((item) =>
    anyEdges ? computeRank(item, byId, memo, visiting) : Math.floor((item.level ?? 2000) / 1000) - 1
  );
  const maxRank = Math.max(...ranks, 0);
  const rowGap = Math.min((viewport.height * ROW_GAP_VIEWPORT_RATIO) / (maxRank + 1), ROW_GAP_MAX);
  const rowWidth = viewport.width * ROW_X_FILL_RATIO;

  // 같은 rank끼리 모아 가로로 균등 분산 + 중앙 정렬.
  const indicesByRank = new Map<number, number[]>();
  ranks.forEach((rank, index) => {
    if (!indicesByRank.has(rank)) indicesByRank.set(rank, []);
    indicesByRank.get(rank)!.push(index);
  });

  const positions: Vec2[] = new Array(items.length);
  indicesByRank.forEach((indices, rank) => {
    const count = indices.length;
    indices.forEach((itemIndex, i) => {
      const x = count === 1 ? 0 : (i / (count - 1) - 0.5) * rowWidth;
      const y = (rank - maxRank / 2) * rowGap;
      positions[itemIndex] = { x, y };
    });
  });
  return positions;
}

// ---- rAF 스프링 - 접힌 성단 중심 -> 전개 좌표로 "튀어나오는" 전환 모션.
// 상시 애니메이션이 아니라 전개 상호작용 순간에만 rAF 루프가 돈다(안정되면
// 스스로 멈춘다).
const SPRING_STIFFNESS = 210;
const SPRING_DAMPING = 26;
const SPRING_SETTLE_DIST = 0.3;
const SPRING_SETTLE_VEL = 2;

interface SpringNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
}

function stepSpringNode(node: SpringNode, dt: number): boolean {
  const dx = node.tx - node.x;
  const dy = node.ty - node.y;
  const ax = dx * SPRING_STIFFNESS;
  const ay = dy * SPRING_STIFFNESS;
  node.vx = (node.vx + ax * dt) * (1 - SPRING_DAMPING * dt);
  node.vy = (node.vy + ay * dt) * (1 - SPRING_DAMPING * dt);
  node.x += node.vx * dt;
  node.y += node.vy * dt;
  const settled =
    Math.abs(dx) < SPRING_SETTLE_DIST &&
    Math.abs(dy) < SPRING_SETTLE_DIST &&
    Math.abs(node.vx) < SPRING_SETTLE_VEL &&
    Math.abs(node.vy) < SPRING_SETTLE_VEL;
  return !settled;
}

// ---- 다이브인 상수 ----
const CLUSTER_CLICK_THRESHOLD = 5; // px - 이 안이면 클릭, 넘으면 드래그로 간주(pointerdown을 무효화)
const DIVE_ZOOM_K = 16; // 하늘 wrapper가 클릭 지점을 중심으로 확대되는 배율
const DIVE_DURATION_MS = 450;
const DIVE_EASE = "cubic-bezier(.22,1,.36,1)";
const INTERIOR_STAGGER_MS = 45; // 내부 멤버가 순서대로 튀어나오는 간격

export function DraftReviewStage({
  drafts,
  selected,
  bins,
  onSelect,
  onConfirm,
  onReject,
  onPrereqsResolved,
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

  // ---- 다이브인 상태 ------------------------------------------------------
  // diveBinId: 지금 "안으로 들어간" 성단(null이면 하늘 전체 뷰). insideActive는
  // 줌 애니메이션이 다 끝나 내부 뷰가 실제로 보이는 시점(오버레이 페이드인
  // 트리거) - 줌 도중(diveTransitioning만 true)엔 하늘 wrapper만 애니메이션
  // 중이고 오버레이는 아직 투명하다. diveTransitioning은 in/out 두 방향
  // 전환 내내 true이고, 어느 방향인지는 divePhaseRef(ref라 리렌더 없이도
  // onTransitionEnd에서 읽을 수 있다)로 구분한다.
  const [diveBinId, setDiveBinId] = useState<string | null>(null);
  const [diveXY, setDiveXY] = useState<{ originXPct: number; originYPct: number } | null>(null);
  const [diveTransitioning, setDiveTransitioning] = useState(false);
  const [insideActive, setInsideActive] = useState(false);
  const divePhaseRef = useRef<"in" | "out" | null>(null);
  const staggerTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 오버레이는 줌 인 도중(디자인상 하늘 뒤에 숨어야 함)부터 줌 아웃이 끝날
  // 때까지 DOM에 남아 있어야 opacity 트랜지션이 실제로 재생된다.
  const showInterior = diveBinId !== null || diveTransitioning;

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // 뷰포트 크기 - 다이브인 내부 뷰는 미리보기 박스가 아니라 풀뷰포트를
  // 채워야 하므로 별도로 추적한다(resize에도 즉시 반응).
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  useEffect(() => {
    function handleResize() {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // item.id -> {item, bin, binIndex} - 다이브인 내부 뷰에서 원본을 찾는다.
  const itemLookup = useMemo(() => {
    const map = new Map<string, { item: BinItem; bin: Bin; binIndex: number }>();
    bins.forEach((bin, binIndex) => {
      bin.items.forEach((item) => {
        map.set(`${bin.id}::${item.id}`, { item, bin, binIndex });
      });
    });
    return map;
  }, [bins]);

  const diveBinIndex = diveBinId ? bins.findIndex((b) => b.id === diveBinId) : -1;
  const diveBin = diveBinIndex >= 0 ? bins[diveBinIndex] : undefined;

  // rAF 스프링 - springsRef가 진짜 상태(위치/속도/목표)를 갖고, tick이
  // 리렌더를 강제한다. 상호작용 순간에만 돌고 안정되면 스스로 멈춘다. 이
  // Map은 다이브인 내부 뷰 전용(하늘 미리보기는 더 이상 제자리 전개를 하지
  // 않는다 - 다이브인이 그 역할을 대신한다).
  const springsRef = useRef<Map<string, SpringNode>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const stepAllSprings = useCallback((dt: number): boolean => {
    const springs = springsRef.current;
    let anyMoving = false;
    springs.forEach((node) => {
      if (stepSpringNode(node, dt)) anyMoving = true;
    });
    return anyMoving;
  }, []);

  const startSpringLoop = useCallback(() => {
    if (rafRef.current != null) return; // 이미 돌고 있다
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); // 탭 전환 등 큰 델타 방지
      last = now;
      const stillMoving = stepAllSprings(dt);
      setTick((t) => t + 1);
      rafRef.current = stillMoving ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stepAllSprings]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      staggerTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  // 온디맨드 선수관계 조회(POST /api/constellation-intake/prereqs) - bin당
  // 한 번만. 결과가 빈 배열이어도 다시 조회하지 않는다(fetched set). 위계는
  // 장식이라 실패는 콘솔 경고로만 남기고 조용히 무시한다 - 레이아웃은 이미
  // level 폴백으로 즉시 그려져 있다.
  const fetchedPrereqBinsRef = useRef<Set<string>>(new Set());

  const diveIn = useCallback(
    (bin: Bin, index: number) => {
      if (diveBinId || diveTransitioning) return; // 전환 중 재진입 방지
      if (bin.items.length === 0 || !toPct) return;
      const pos = toPct(clusterCenters[index]);
      setDiveXY({ originXPct: pos.left, originYPct: pos.top });
      setDiveBinId(bin.id);
      setDiveTransitioning(true);
      divePhaseRef.current = "in";

      const courseItems = bin.items.filter((item) => item.id.startsWith("course:"));
      const alreadyHasPrereqs = bin.items.some((item) => (item.prereqIds?.length ?? 0) > 0);
      if (
        onPrereqsResolved &&
        courseItems.length >= 2 &&
        !alreadyHasPrereqs &&
        !fetchedPrereqBinsRef.current.has(bin.id)
      ) {
        fetchedPrereqBinsRef.current.add(bin.id);
        inferPrereqs(
          courseItems.map((item) => ({
            code: item.id.slice("course:".length),
            name: item.label,
            level: typeof item.level === "number" ? Math.floor(item.level / 1000) : null,
            kind: null,
          }))
        )
          .then((edges) => {
            if (edges.length === 0) return;
            const prereqsByItemId: Record<string, string[]> = {};
            for (const edge of edges) {
              (prereqsByItemId[edge.after] ??= []).push(edge.before);
            }
            onPrereqsResolved(bin.id, prereqsByItemId);
          })
          .catch((err) => {
            console.warn("[constellation] 선수관계 조회 실패 - level 폴백 레이아웃을 유지한다", err);
          });
      }
    },
    [diveBinId, diveTransitioning, toPct, clusterCenters, onPrereqsResolved]
  );

  const diveOut = useCallback(() => {
    if (!diveBinId) return;
    divePhaseRef.current = "out";
    setDiveTransitioning(true);
    setInsideActive(false); // 오버레이 페이드아웃을 하늘 줌아웃과 동시에 시작
    setDiveBinId(null); // 하늘 wrapper의 목표 transform이 scale(1)로 바뀐다
  }, [diveBinId]);

  // Esc는 하늘 전체 뷰에서는 여전히 아무 것도 하지 않는다(문서 상단 참고) -
  // 성운 내부일 때만 diveOut과 같은 동작을 한다.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (diveBinId) diveOut();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [diveBinId, diveOut]);

  // 내부 뷰가 활성화되면(줌 인 트랜지션이 끝나면) 멤버를 성단 중심(오프셋
  // 0,0)에서 시작해 순서대로 목표 좌표로 스프링을 튕겨 보낸다 - "별자리
  // 펼쳐지듯" 스태거 등장.
  useEffect(() => {
    staggerTimeoutsRef.current.forEach(clearTimeout);
    staggerTimeoutsRef.current = [];
    if (!insideActive || !diveBin) return;
    const springs = springsRef.current;
    springs.clear();
    const positions = interiorLayoutFor(diveBin.items, hashSeed(diveBin.id), viewportSize);
    diveBin.items.forEach((item, i) => {
      const key = `${diveBin.id}::${item.id}`;
      springs.set(key, { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 });
      const timeout = setTimeout(() => {
        const node = springsRef.current.get(key);
        if (!node) return;
        node.tx = positions[i].x;
        node.ty = positions[i].y;
        startSpringLoop();
      }, i * INTERIOR_STAGGER_MS);
      staggerTimeoutsRef.current.push(timeout);
    });
    setTick((t) => t + 1); // 방금 clear한 springsRef를 즉시 반영(전부 중심에서 보이게)
  }, [insideActive, diveBin, viewportSize, startSpringLoop]);

  // ---- 성단 히트 타깃 - stopPropagation + 자기 캡처 + 이동 임계값으로
  // 클릭/드래그를 분리한다(파일 상단 주석의 버그 수정 패턴). ----
  const clusterDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
    bin: Bin;
    index: number;
  } | null>(null);

  const handleClusterPointerDown = useCallback(
    (bin: Bin, index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // 배경 팬 레이어가 조상에 캡처를 걸지 못하게 막는다
      clusterDragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
        bin,
        index,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    []
  );

  const handleClusterPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = clusterDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > CLUSTER_CLICK_THRESHOLD) {
      drag.moved = true;
    }
  }, []);

  const handleClusterPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = clusterDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      clusterDragRef.current = null;
      if (!drag.moved) diveIn(drag.bin, drag.index);
    },
    [diveIn]
  );

  // 하늘 wrapper의 단일 transform - 팬과 다이브 줌을 하나로 합친다(요소별
  // transform 애니메이션 금지 원칙, ae48e73). transformOrigin은 다이브 시점의
  // 클릭한 성단 위치(%)로 고정해 그 지점을 중심으로 확대되는 것처럼 보이게
  // 한다. diveTransitioning일 때만 CSS transition을 건다 - 순수 팬 드래그는
  // 여전히 즉시 반응해야(트랜지션 없이) 손맛이 그대로다.
  const wrapperTransform = `translate(${pan.x}px, ${pan.y}px) scale(${diveBinId ? DIVE_ZOOM_K : 1})`;

  return (
    <div role="region" aria-label="별자리 초안 검토" className="fixed inset-0 z-40 overflow-hidden bg-ink-900">
      {/* 가장 안쪽 레이어부터: 심우주 별밭 -> 격자 -> 그래프. */}
      <SpaceBackdrop />
      <div className="bg-radec-grid pointer-events-none absolute inset-0" aria-hidden />

      {/* 상단 중앙 배너 - 시안의 pill 형태. 다이브인 중에는 숨긴다(내부 뷰가
          자체 배너를 갖는다). 이 화면은 정적 미리보기라 "끌어서 고친다"는
          약속은 하지 않는다(그건 확정 후 캔버스의 일 - 여기서 말하면 거짓
          어포던스가 된다). pointer-events-none이라 팬 서페이스보다 위(z-10)에
          있어도 드래그를 가로채지 않는다. */}
      {!diveBinId && (
        <div
          className="pointer-events-none fixed left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-rule bg-ink-800/95 px-5 py-2.5 shadow-lg backdrop-blur-md"
          role="status"
        >
          <StarGlyph size={14} />
          <span className="font-sans text-body-sm text-text-hi">
            대화를 바탕으로 별자리 초안을 그렸어요 — 마음에 드는 안을 골라 시작하세요
          </span>
        </div>
      )}

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
              style={{
                transform: wrapperTransform,
                transformOrigin: diveXY ? `${diveXY.originXPct}% ${diveXY.originYPct}%` : "50% 50%",
                transition: diveTransitioning ? `transform ${DIVE_DURATION_MS}ms ${DIVE_EASE}` : undefined,
              }}
              onTransitionEnd={(e) => {
                if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
                if (divePhaseRef.current === "in") {
                  setInsideActive(true);
                } else if (divePhaseRef.current === "out") {
                  setDiveXY(null);
                  setDiveTransitioning(false);
                }
                divePhaseRef.current = null;
              }}
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
                const diameter = clusterDiameterFor(count);
                const particles = buildNebulaParticles(index, bin.items, diameter, color);
                return (
                  <div
                    key={bin.id}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${bin.label} 성운으로 들어가기 - 요소 ${count}개`}
                      onPointerDown={handleClusterPointerDown(bin, index)}
                      onPointerMove={handleClusterPointerMove}
                      onPointerUp={handleClusterPointerUp}
                      onPointerCancel={handleClusterPointerUp}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          diveIn(bin, index);
                        }
                      }}
                      className={cn(
                        "relative cursor-pointer overflow-hidden rounded-full outline-none touch-none",
                        isCore && "shadow-glow-bloom",
                        "focus-visible:ring-2 focus-visible:ring-spec-b"
                      )}
                      style={{
                        width: diameter,
                        height: diameter,
                        // 옅은 성운 안개 그라데이션 - 새 hex 없이 color-mix로
                        // 기존 토큰(color)을 투명도만 섞어 우려낸다.
                        background: `radial-gradient(circle, color-mix(in srgb, ${color} 75%, transparent) 0%, color-mix(in srgb, ${color} 30%, transparent) 55%, transparent 78%)`,
                        opacity: isCore ? 0.9 : 0.4,
                        border: `1px solid ${color}`,
                      }}
                    >
                      {/* 자글자글한 성운 입자 - 시드 결정론, Math.random 없음. */}
                      {particles.map((p, pi) => (
                        <span
                          key={pi}
                          aria-hidden
                          className="absolute rounded-full"
                          style={{
                            left: diameter / 2 + p.x,
                            top: diameter / 2 + p.y,
                            width: p.size,
                            height: p.size,
                            background: p.color,
                            transform: "translate(-50%, -50%)",
                            // 은은한 twinkle - opacity만 애니메이션(기존 규약).
                            animation: `starTwinkle ${p.twinkleDur.toFixed(2)}s ease-in-out -${p.twinkleDelay.toFixed(2)}s infinite`,
                            ["--twinkle-lo" as string]: p.twinkleLo,
                            ["--twinkle-hi" as string]: p.twinkleHi,
                          }}
                        />
                      ))}
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
          다이브인 중에는 숨긴다(내부 뷰가 화면을 다 덮는다). 팬 서페이스는
          형제 요소라 이 패널 위에서 시작한 포인터는 원래 거기로 안 새지만
          (topmost hit-test), 혹시 몰라 명시적으로도 막는다. */}
      {!diveBinId && (
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
      )}

      {/* 성운 내부 뷰 - 다이브인 중에만 마운트된다(줌 인 트랜지션이 시작되는
          순간부터 줌 아웃 트랜지션이 끝날 때까지). 풀뷰포트를 덮고, 자신의
          opacity 트랜지션으로 페이드인/아웃한다(insideActive가 방아쇠). */}
      {showInterior && diveBin && (
        <div
          className={cn(
            "fixed inset-0 z-30 overflow-hidden bg-ink-900 transition-opacity",
            insideActive ? "opacity-100" : "opacity-0"
          )}
          style={{ transitionDuration: `${DIVE_DURATION_MS}ms` }}
          role="region"
          aria-label={`${diveBin.label} 성운 내부`}
        >
          <SpaceBackdrop />

          {/* 확대된 성운 안개 - 성단 미리보기와 같은 buildNebulaParticles를
              재사용하되, 지름을 뷰포트 짧은 변 기준으로 크게 잡는다. */}
          {(() => {
            const dominantType = diveBin.items[0]?.type;
            const sameType = diveBin.items.every((item) => item.type === dominantType);
            const color = sameType && dominantType ? colorForType(dominantType) : "var(--text-hi)";
            const diameter = Math.min(viewportSize.width, viewportSize.height) * 0.9;
            const particles = buildNebulaParticles(diveBinIndex, diveBin.items, diameter, color);
            return (
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: diameter,
                  height: diameter,
                  background: `radial-gradient(circle, color-mix(in srgb, ${color} 55%, transparent) 0%, color-mix(in srgb, ${color} 22%, transparent) 55%, transparent 78%)`,
                }}
              >
                {particles.map((p, pi) => (
                  <span
                    key={pi}
                    className="absolute rounded-full"
                    style={{
                      left: diameter / 2 + p.x,
                      top: diameter / 2 + p.y,
                      width: p.size * 1.6,
                      height: p.size * 1.6,
                      background: p.color,
                      transform: "translate(-50%, -50%)",
                      animation: `starTwinkle ${p.twinkleDur.toFixed(2)}s ease-in-out -${p.twinkleDelay.toFixed(2)}s infinite`,
                      ["--twinkle-lo" as string]: p.twinkleLo,
                      ["--twinkle-hi" as string]: p.twinkleHi,
                    }}
                  />
                ))}
              </div>
            );
          })()}

          {/* 상단 필 - 성운 이름 + 밖으로 나가기. 하늘 뷰 배너와 같은 위치라
              전환이 시각적으로 이어져 보인다. */}
          <div className="pointer-events-auto fixed left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-rule bg-ink-800/95 px-5 py-2.5 shadow-lg backdrop-blur-md">
            <StarGlyph size={14} />
            <span className="font-serif text-heading font-bold text-text-hi">{diveBin.label}</span>
            <button
              type="button"
              onClick={diveOut}
              className="ml-1 rounded-full border border-rule px-3 py-1 font-sans text-body-sm text-text-hi transition-colors hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-spec-b"
            >
              ← 성운 밖으로
            </button>
          </div>

          {/* 선수관계 간선 - 별(멤버) 컨테이너보다 먼저 그려 선이 별 아래로
              깔린다. springsRef를 직접 읽으므로 스태거 등장 중에도 선이 따라
              온다(setTick이 매 프레임 리렌더를 강제). CSS transform 금지 -
              px 좌표를 attribute로만 준다(SVG에서 CSS transform이 attribute
              transform을 덮어써 버리는 함정). */}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
            aria-hidden
          >
            {diveBin.items.map((item, itemIndex) => {
              const toNode = springsRef.current.get(`${diveBin.id}::${item.id}`);
              if (!toNode) return null;
              return (item.prereqIds ?? []).map((prereqId) => {
                const fromNode = springsRef.current.get(`${diveBin.id}::${prereqId}`);
                if (!fromNode) return null; // dangling(같은 bin에 없는 id) - 그릴 게 없다.
                return (
                  <line
                    key={`${item.id}<-${prereqId}`}
                    x1={viewportSize.width / 2 + fromNode.x}
                    y1={viewportSize.height / 2 + fromNode.y}
                    x2={viewportSize.width / 2 + toNode.x}
                    y2={viewportSize.height / 2 + toNode.y}
                    pathLength={1}
                    strokeDasharray="1"
                    stroke="rgb(255 243 196 / 0.45)"
                    strokeWidth={1.2}
                    style={{
                      animation: "edgeDrawOn 550ms cubic-bezier(.22,1,.36,1) forwards",
                      animationDelay: `${itemIndex * INTERIOR_STAGGER_MS}ms`,
                    }}
                  />
                );
              });
            })}
          </svg>

          {/* 멤버 - 큰 별(라벨·학정번호·유형 점). springsRef가 성단 중심(0,0)
              기준 오프셋을 들고 있어 뷰포트 중앙에서 offset만큼 이동해 그린다. */}
          <div className="absolute inset-0">
            {Array.from(springsRef.current.entries()).map(([key, node]) => {
              const info = itemLookup.get(key);
              if (!info || info.bin.id !== diveBin.id) return null;
              const { code, rest } = splitCourseCode(info.item.label);
              const isHovered = hoveredKey === key;
              const dotColor = colorForType(info.item.type);
              return (
                <div
                  key={key}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                  style={{ left: `calc(50% + ${node.x}px)`, top: `calc(50% + ${node.y}px)`, zIndex: isHovered ? 30 : 10 }}
                  onMouseEnter={() => setHoveredKey(key)}
                  onMouseLeave={() => setHoveredKey((k) => (k === key ? null : k))}
                >
                  <span
                    aria-hidden
                    className="block rounded-full"
                    style={{
                      width: isHovered ? 14 : 10,
                      height: isHovered ? 14 : 10,
                      background: dotColor,
                      boxShadow: `0 0 8px ${dotColor}`,
                    }}
                  />
                  <span
                    className={cn(
                      "max-w-[160px] truncate whitespace-nowrap rounded bg-ink-800/85 px-1.5 py-0.5 text-center font-sans text-body-sm leading-tight",
                      isHovered ? "text-text-hi" : "text-text-lo"
                    )}
                    title={info.item.label}
                  >
                    {code && <span className="mr-1 font-mono text-micro text-text-lo">{code}</span>}
                    {rest}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
