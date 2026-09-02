/**
 * 별상(星像) Rev.B - "유형은 형태가, 색은 사용자가" (2026-09-02 사용자 승인)
 *
 * 참조 구현: 별상 시안 Rev.B의 star() 빌더(스크래치패드 star-plate.html).
 * 다섯 형태는 전부 실제 망원경 사진의 광학 현상: 십자/육각 회절, 쌍성, 유성,
 * 산개성단. 층 구조(헤일로 → 바늘 → 에어리 링 → 핵)와 그라디언트 스톱값은
 * 시안 그대로, 치수만 노드 반지름 r 기준으로 다시 잰다(시안은 148px 카드용이라
 * 핵 비율이 캔버스에선 너무 작다 - 미달성도 또렷해야 한다는 사양에 맞춰 핵을
 * 키웠다).
 *
 * 별도 파일인 이유: ConstellationCanvas(캔버스 노드)와 DraftReviewStage(LLM
 * 시안 다이브인 멤버)가 함께 쓰는데, 두 파일은 이미
 * ConstellationCanvas → DraftReviewStage(buildNebulaParticles) 방향의 값
 * import가 있어 역방향으로 StarBody를 가져가면 값 수준 순환이 된다.
 * 형태 매핑 표는 docs/design-handoff-guide.md §3-13 - 형태를 바꾸면 그 표와
 * 여기를 같이 고칠 것.
 *
 * 규칙(인계 가이드 §3):
 * - 새 path 전부 fill 실값(그라디언트 포함) - fill="none" 금지(§3-1).
 *   에어리 링만 윤곽선이라 fill="transparent"를 쓴다.
 * - 블러는 소비처의 공유 #const-glow 하나를 달성 별 전체에 1회 래핑 - 미달성
 *   블러 0. 시안의 별마다 feGaussianBlur는 이식하지 않는다(노드 수백 개 성능).
 * - 상시 애니메이션 추가 없음(§3-4) - 숨쉬기는 소비처의 spikeBreathe(달성
 *   연출 프리셋 레이어)가 담당한다.
 */

import { Fragment, type ReactElement } from "react";
import { mixHex } from "@/lib/element-colors";

/** 오목 곡선으로 가늘어지는 회절침 - 다이아몬드가 아니라 바늘. 시안의
 * needle() 그대로(세로 기준, rotate로 각도를 준다). */
function starNeedlePath(L: number, w: number): string {
  return `M0 ${-L} Q ${w * 0.22} ${-L * 0.12} ${w} 0 Q ${w * 0.22} ${L * 0.12} 0 ${L} Q ${-w * 0.22} ${L * 0.12} ${-w} 0 Q ${-w * 0.22} ${-L * 0.12} 0 ${-L} Z`;
}

/** 회절침 한 벌 - 길고 옅은 바늘 + 짧고 진한 심지 두 겹으로 길이 방향 감쇠를
 * 만든다. 시안의 블러 사본 층은 뺐다(위 규칙 - 달성 별은 const-glow 래핑이
 * 같은 번짐을 준다). */
function StarSpikeSet({
  cx = 0,
  cy = 0,
  L,
  w,
  angles,
  op,
  hex,
}: {
  cx?: number;
  cy?: number;
  L: number;
  w: number;
  angles: number[];
  op: number;
  hex: string;
}) {
  return (
    <>
      {angles.map((a) => (
        <g key={a} transform={`translate(${cx} ${cy}) rotate(${a})`}>
          <path d={starNeedlePath(L, w)} fill={mixHex(hex, 0.25)} opacity={op * 0.55} />
          <path d={starNeedlePath(L * 0.42, w * 1.25)} fill={mixHex(hex, 0.6)} opacity={op} />
        </g>
      ))}
    </>
  );
}

/** 노드 색별 그라디언트 defs - 노드마다가 아니라 "쓰이는 색마다" 하나씩만
 * 만든다(자유 RGB라도 실사용 색은 십수 개 수준). currentColor는 그라디언트
 * 정의 위치 기준으로 풀리는 SVG 함정이 있어 실색을 스톱에 굽는다(시안 주석
 * 그대로). 스톱값은 시안 정본과 동일. url(#id)는 같은 문서 전체에서 풀리므로
 * 소비처는 defs를 한 곳(숨은 svg 포함)에만 두면 된다. */
export function StarColorDefs({ hexes }: { hexes: string[] }) {
  return (
    <>
      {hexes.map((hex) => {
        const k = hex.slice(1).toLowerCase();
        return (
          <Fragment key={k}>
            <radialGradient id={`starHalo-${k}`}>
              <stop offset="0" stopColor={mixHex(hex, 0.8)} stopOpacity="0.9" />
              <stop offset="0.14" stopColor={mixHex(hex, 0.35)} stopOpacity="0.5" />
              <stop offset="0.38" stopColor={hex} stopOpacity="0.18" />
              <stop offset="0.7" stopColor={hex} stopOpacity="0.05" />
              <stop offset="1" stopColor={hex} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`starCore-${k}`}>
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
              <stop offset="0.45" stopColor={mixHex(hex, 0.5)} stopOpacity="0.5" />
              <stop offset="1" stopColor={hex} stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`starTail-${k}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={mixHex(hex, 0.4)} />
              <stop offset="1" stopColor={hex} stopOpacity="0" />
            </linearGradient>
          </Fragment>
        );
      })}
    </>
  );
}

/** 별상 본체 - 소비처의 <g>(이미 위치로 translate됨) 안에서 원점 기준으로
 * 그린다. 히트 영역: 헤일로 원이 그라디언트로 채워져 있어(투명 스톱 포함)
 * 본체 전체가 클릭 판정에 들어간다. */
export function StarBody({ type, done, hex, r }: { type: string; done: boolean; hex: string; r: number }) {
  const k = hex.slice(1).toLowerCase();
  // 시안 cfg의 done/undone 두 벌 - S(카드 한 변) 대신 r(노드 반지름) 기준.
  const haloR = done ? r * 2.4 : r * 1.15;
  const haloOp = done ? 0.8 : 0.5;
  const L = done ? r * 3.4 : r * 1.35; // 달성 긴 바늘 ≈ 캔버스 기존 SPIKE_LENGTH_MULT(3.5r)와 같은 급
  // 바늘 폭에 픽셀 하한을 깐다(2026-09-02 사용자 지적: "십자가가 잘 안뜬다 특히
  // 이미 달성해서 불 켜져있는 애들이"). 순수 비례(r×0.09)는 시안 카드(한 변
  // 148px)에서는 3px대지만 실제 노드 r 7~9에서는 0.5~0.8px 서브픽셀이 되어
  // 렌더러가 사실상 지워 버린다 — 특히 달성 별은 헤일로(r×2.4)가 밝아 완전히
  // 묻힌다. 하한은 r이 커지면 자연히 비례식에 자리를 내주므로 시안 화면의
  // 승인된 비율은 그대로 유지된다.
  const w = Math.max(done ? r * 0.09 : r * 0.075, done ? 1.4 : 1.0);
  const spOp = done ? 1 : 0.8;
  const coreR = r * 0.34;

  const halo = (cx: number, cy: number, radius: number, op: number) => (
    <circle cx={cx} cy={cy} r={radius} fill={`url(#starHalo-${k})`} opacity={op} />
  );
  // 핵 - 달성은 백색 고온핵(가시성 사양의 "백색 고온부"의 일반화), 미달성은 채색 핵.
  const core = (cx: number, cy: number, scale = 1) =>
    done ? (
      <>
        <circle cx={cx} cy={cy} r={r * 1.2 * scale} fill={`url(#starCore-${k})`} />
        <circle cx={cx} cy={cy} r={coreR * scale} fill="#ffffff" />
      </>
    ) : (
      <>
        <circle cx={cx} cy={cy} r={r * 0.9 * scale} fill={`url(#starCore-${k})`} opacity={0.6} />
        <circle cx={cx} cy={cy} r={coreR * scale} fill={mixHex(hex, 0.55)} />
      </>
    );
  // 에어리 링 - 달성 별에만 아주 희미하게. 윤곽선이라 fill은 transparent(§3-1).
  const airy = (radius: number) =>
    done ? (
      <circle r={radius} fill="transparent" stroke={mixHex(hex, 0.3)} strokeWidth={1} opacity={0.09} />
    ) : null;

  let body: ReactElement; // React 19: 전역 JSX 네임스페이스가 사라져 ReactElement로.
  if (type === "certification") {
    // 육각 회절 - 육각 거울(JWST)의 별상. 달성 시 수평 부침.
    body = (
      <>
        {halo(0, 0, haloR, haloOp)}
        <StarSpikeSet L={L * 0.9} w={w} angles={[0, 60, 120]} op={spOp} hex={hex} />
        {done && <StarSpikeSet L={L * 0.3} w={w * 0.8} angles={[90]} op={0.45} hex={hex} />}
        {airy(r * 1.75)}
        {core(0, 0)}
      </>
    );
  } else if (type === "organization") {
    // 쌍성 - 두 핵이 한 외광을 나눠 쓴다(주핵 > 부핵).
    const d = done ? r * 0.65 : r * 0.5;
    const ax = -d;
    const ay = d * 0.4;
    const bx = d;
    const by = -d * 0.4;
    body = (
      <>
        {halo(0, 0, haloR * 1.12, haloOp * 0.9)}
        <StarSpikeSet cx={ax} cy={ay} L={L * 0.62} w={w} angles={[0, 90]} op={spOp} hex={hex} />
        <StarSpikeSet cx={bx} cy={by} L={L * 0.44} w={w * 0.9} angles={[0, 90]} op={spOp * 0.8} hex={hex} />
        {airy(r * 2.1)}
        {core(ax, ay)}
        {core(bx, by, 0.75)}
      </>
    );
  } else if (type === "activity") {
    // 유성 - -45° 이중 꼬리(좁고 밝게 + 넓고 옅게). 지나간 자리의 움직임.
    const tailL = done ? r * 3.2 : r * 1.55;
    const tailW = done ? r * 0.25 : r * 0.16;
    const tail = (ww: number, op: number) => (
      <path d={`M0 0 L${-ww} ${-tailL} L${ww} ${-tailL} Z`} fill={`url(#starTail-${k})`} opacity={op} />
    );
    body = (
      <>
        <g transform="rotate(-45)">
          {tail(tailW * 2.6, done ? 0.35 : 0.25)}
          {tail(tailW, done ? 0.85 : 0.6)}
        </g>
        {halo(0, 0, haloR * 0.9, haloOp)}
        <StarSpikeSet L={L * 0.5} w={w} angles={[0, 90]} op={spOp * 0.9} hex={hex} />
        {core(0, 0)}
      </>
    );
  } else if (type === "networking") {
    // 산개성단 - 주성 곁에 잇닿은 위성별 3(크기 체감). 사람에서 사람으로.
    const sats: [number, number, number][] = [
      [1.7, -1.3, 0.55],
      [-1.45, 1.45, 0.45],
      [1.2, 1.85, 0.38],
    ];
    body = (
      <>
        {halo(0, 0, haloR * 1.2, haloOp * 0.85)}
        <StarSpikeSet L={L * 0.68} w={w} angles={[0, 90]} op={spOp} hex={hex} />
        {airy(r * 2)}
        {core(0, 0, 0.92)}
        {sats.map(([sx, sy, sk], i) => (
          <g key={i}>
            <StarSpikeSet cx={sx * r} cy={sy * r} L={L * 0.24} w={w * 0.9} angles={[0, 90]} op={spOp * 0.7} hex={hex} />
            {core(sx * r, sy * r, sk)}
          </g>
        ))}
      </>
    );
  } else {
    // 수업(course) + 미지의 type 폴백 - 십자 회절, 가장 기본의 별상.
    // 달성 시 45° 부침이 짧고 옅게 따라붙는다(수업 전용 - 폴백에도 해가 없다).
    body = (
      <>
        {halo(0, 0, haloR, haloOp)}
        {done && <StarSpikeSet L={L * 0.38} w={w * 0.8} angles={[45, 135]} op={0.4} hex={hex} />}
        <StarSpikeSet L={L} w={w} angles={[0, 90]} op={spOp} hex={hex} />
        {airy(r * 1.9)}
        {core(0, 0)}
      </>
    );
  }

  // 달성 별만 공유 블러(#const-glow)로 1회 래핑 - blur+원본 merge라 시안의
  // "블러 사본 + 선명한 바늘" 층 구조를 필터 하나로 대신한다.
  return done ? <g filter="url(#const-glow)">{body}</g> : body;
}
