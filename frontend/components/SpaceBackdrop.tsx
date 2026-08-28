"use client";

/**
 * 별자리 캔버스 뒤에 까는 심우주 배경 - 허블 딥필드처럼 칠흑 위에 작은 흰 별이
 * 빽빽이 떠 있는 별밭(star field)만으로 구성한다. 이전 버전의 색 있는 성운·은하·
 * 블랙홀은 사용자 판정("색깔 들어가니까 너무 촌스러워")으로 전부 폐기 - 색은
 * 그래프(분광형 노드·점등 엣지)의 몫이고 배경은 무채색으로 물러난다.
 *
 * 별 좌표는 시드 고정 PRNG(mulberry32)로 생성한다. Math.random()을 쓰면 서버
 * 렌더와 클라이언트 하이드레이션의 좌표가 어긋나 React 경고가 나므로, 같은
 * 시드에서 항상 같은 하늘이 나오게 한다(재방문 시 하늘이 바뀌지 않는 효과도 덤).
 *
 * 뷰포트 고정(팬과 함께 움직이지 않음): 실제 밤하늘은 몇 백 px 팬한다고 별이
 * 움직이지 않는다. 다만 "비문증(eye floater)" 요청으로, 캔버스를 드래그해
 * 팬하는 그 순간에만 별밭 전체가 아주 살짝 관성으로 흔들리다 가라앉는다(아래
 * "관성 드리프트 물리" 섹션) - 별이 팬을 1:1로 따라가면 배경이 그래프에
 * 접착된 것처럼 보이므로 절대 그러면 안 된다는 게 핵심 요구사항이었다.
 * pointer-events: none으로 팬/드래그/엣지 연결을 절대 가로채지 않는다(드리프트
 * 중에도 마찬가지 - transform은 시각만 바꾸고 히트테스트에는 관여하지 않는다).
 * 밝기 상한: 가장 밝은 별도 그래프의 미점등 엣지보다 눈에 띄지 않을 만큼만.
 *
 * --- 관성 드리프트 물리 -----------------------------------------------------
 * ConstellationCanvas가 팬 제스처의 프레임 간 델타(movementX/Y)를 window에
 * "ourlab:canvas-pan" CustomEvent로 쏘면(디커플링 - 이 파일은 캔버스를 import하지
 * 않는다), 그 델타를 감쇠 스프링(damped spring)의 속도에 주입한다. 매 프레임
 * `v += -k·x - c·v; x += v`로 적분하면 델타를 따라가되(lag) 살짝 오버슈트하고
 * 감쇠하며 정지한다 - 팬에 딱 붙어 이동하는 시차(parallax)가 아니라 "관성으로
 * 뒤늦게 흔들리다 가라앉는" 움직임이 된다.
 *
 * 434개 별 각각을 매 프레임 애니메이션하는 건 그래프가 감당할 비용이 아니므로,
 * 별을 GROUP_COUNT개 그룹(<g>)으로만 나눠 그룹 단위로 transform을 적용한다.
 * 그룹마다 스프링 상수(k, c)·임펄스 반응도를 그룹 인덱스에서 결정적으로 미세하게
 * 다르게 둬서, 그룹들이 서로 살짝 다르게 흔들려야 "불규칙한 비문증"으로 읽힌다
 * (전부 똑같이 움직이면 그냥 딱딱한 판때기가 흔들리는 것으로 보인다).
 *
 * 사용자 피드백으로 진폭은 일부러 아주 절제했다("너무 과하면 안돼, 유저가 요소
 * 편집하는데에 거슬리면 안되니까") - 힘찬 팬에도 피크 변위가 10px 안팎에 머물고
 * 1초 이내에 가라앉도록 스프링/임펄스 상수를 튜닝했다(아래 상수 주석 참고).
 * 에너지가 임계값 아래로 떨어지면(REST 판정) rAF 루프 자체를 끊는다 - 평소엔
 * 이 배경이 완전히 정적이어야 한다는 하우스 룰(모션은 점등 엣지·위성 궤도에만)을
 * 지키면서, 팬이 끝나면 실제로 유휴 비용이 0으로 돌아간다.
 *
 * prefers-reduced-motion: reduce면 이벤트 구독 자체를 걸지 않는다 - 별은
 * 항상 identity transform(정적)으로 남는다.
 *
 * --- 반짝임(twinkle) ---------------------------------------------------------
 * 위 관성 드리프트와는 별개로, 일부 별은 CSS 애니메이션(opacity만, JS rAF
 * 아님)으로 은은하게 밝기가 오르내린다. 전부 반짝이면 산만하고 비용도 크므로
 * 미광 별은 대략 1/3만, 밝은 별은 전부 twinkle 대상이다. duration/delay는
 * Math.random이 아니라 이미 시드 PRNG로 뽑힌 각 별의 x/y 좌표를 해시해서
 * 파생한다(seededFrac) - 그래야 서버/클라이언트가 항상 같은 타이밍을 그린다.
 * prefers-reduced-motion은 globals.css의 전역 킬스위치(animation-duration
 * 0.001ms)가 이 애니메이션에도 그대로 적용되므로 여기서 따로 처리하지 않는다.
 */

import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  /** 이 별이 반짝임 애니메이션 대상인지 (전체의 일부만 - 성능/과함 방지). */
  twinkle: boolean;
  /** 반짝임 주기(초). 시드 좌표 해시에서 파생, 2.5~6s. */
  twinkleDuration: number;
  /** 반짝임 시작 지연(초). 별마다 위상을 흩뜨려 "다 같이 깜빡"을 피한다. */
  twinkleDelay: number;
}

/** 시드 PRNG에서 이미 나온 값(x, y 등)을 해시해 [0,1) 유사 난수를 얻는다.
 * Math.random을 새로 호출하지 않고도 별마다 다른 애니메이션 타이밍을 결정적으로
 * 파생시키기 위한 용도 - 같은 시드는 항상 같은 반짝임 타이밍을 낸다. */
function seededFrac(v: number): number {
  const s = Math.sin(v) * 43758.5453;
  return s - Math.floor(s);
}

/** style에 CSS 커스텀 프로퍼티(--twinkle-lo/hi)를 얹기 위한 타입. React의
 * CSSProperties는 커스텀 프로퍼티 키를 모르므로 템플릿 리터럴 인덱스 시그니처로
 * 확장한다(any 금지 규칙을 지키면서 타입 안전하게). */
type StyleWithVars = React.CSSProperties & Record<`--${string}`, string | number>;

/** 별 하나의 반짝임 style. 별마다 밝기(opacity)가 크게 다르므로, 전역으로 같은
 * 절대 밝기 구간을 오르내리면 어두운 별과 밝은 별이 똑같이 보여버린다 - 그래서
 * 저점/고점을 CSS 변수로 넘겨 keyframes(globals.css의 starTwinkle)가 그 별
 * 자신의 기준 밝기 주변에서만 숨쉬게 한다. */
function twinkleStyle(s: Star): StyleWithVars {
  return {
    "--twinkle-lo": Math.max(0.05, s.opacity * 0.4).toFixed(2),
    "--twinkle-hi": Math.min(1, s.opacity * 1.9).toFixed(2),
    // delay를 음수로 줘서 마운트 시점에 이미 주기 중간에서 시작하게 한다 -
    // 양수 delay는 그 시간만큼 지난 뒤 기본 opacity에서 키프레임 값으로
    // 눈에 띄게 "툭" 튀는데, 음수는 애니메이션이 그 지점부터 이미 재생 중인
    // 것으로 취급되어 튐 없이 바로 자연스러운 위상에서 시작한다.
    animation: `starTwinkle ${s.twinkleDuration.toFixed(2)}s ease-in-out -${s.twinkleDelay.toFixed(2)}s infinite`,
  };
}

/** 시드 고정 PRNG - 같은 시드는 항상 같은 수열을 낸다(하이드레이션 안전). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars(seed: number, count: number): Star[] {
  const rand = mulberry32(seed);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const brightness = rand();
    const x = Math.round(rand() * 1600 * 10) / 10;
    const y = Math.round(rand() * 900 * 10) / 10;
    stars.push({
      x,
      y,
      // 대부분은 먼지 같은 미광(0.4~0.9px), 드물게 1px대의 또렷한 별.
      r: Math.round((0.4 + brightness * brightness * 1.1) * 100) / 100,
      // 밝기도 제곱 분포 - 어두운 별이 압도적으로 많아야 사진처럼 읽힌다.
      opacity: Math.round((0.1 + brightness * brightness * 0.55) * 100) / 100,
      // 대략 1/3만 반짝인다(전부 애니메이션하면 산만하고 비용도 크다). 밝은 별은
      // 아래 BRIGHT_STARS에서 전부 true로 덮어쓴다.
      twinkle: i % 3 === 0,
      // x/y는 이미 시드 PRNG 결과이므로, 그걸 해시해 재현 가능한 타이밍을 만든다.
      twinkleDuration: 2.5 + seededFrac(x * 12.9898 + y * 78.233) * 3.5,
      twinkleDelay: seededFrac(x * 39.346 + y * 11.135) * 6,
    });
  }
  return stars;
}

// 모듈 로드 시 한 번만 생성 - 렌더마다 재계산하지 않는다.
const DIM_STARS = makeStars(20260827, 420);
// 소수의 "밝은 별"만 살짝 큰 반지름 + 부드러운 광륜 + 전부 반짝임.
const BRIGHT_STARS = makeStars(1004, 14).map((s) => ({
  ...s,
  r: 1.3 + s.r,
  opacity: Math.min(0.5, s.opacity + 0.22),
  twinkle: true,
}));

// --- 그룹 분할 --------------------------------------------------------------
// 그룹 수만큼 <g>를 만들고, 별은 인덱스 라운드로빈으로 나눠 담는다(공간적으로
// 뭉치지 않고 화면 전체에 고르게 흩어진 채로 그룹이 나뉜다 - 그래야 그룹마다
// 다르게 흔들려도 "왼쪽 별과 오른쪽 별이 따로 논다"가 아니라 "전체가 은은하게
// 불규칙하다"로 읽힌다).
const GROUP_COUNT = 5;

interface StarGroup {
  dim: Star[];
  bright: Star[];
}

const STAR_GROUPS: StarGroup[] = Array.from({ length: GROUP_COUNT }, () => ({
  dim: [],
  bright: [],
}));
DIM_STARS.forEach((s, i) => STAR_GROUPS[i % GROUP_COUNT].dim.push(s));
BRIGHT_STARS.forEach((s, i) => STAR_GROUPS[i % GROUP_COUNT].bright.push(s));

// --- 관성 드리프트 상수 ------------------------------------------------------
// 튜닝 근거: 스프링을 node로 별도 실행해 미리 확인함(damped spring, 프레임당
// v += -k·x - c·v; x += v). 힘찬 팬(15회 pointermove, 평균 movementX≈25px)을
// 넣으면 피크 변위 ≈11px, 정지(REST_EPS 이하)까지 ≈36프레임(0.6초) - 절제
// 피드백("너무 과하면 안돼") 이후의 목표였던 "8~14px 피크, 1.5초보다 훨씬
// 빠르게 가라앉음"에 맞춘 값. 잔잔한 팬(8회, 평균 6px)은 피크 ≈2.7px로
// 거의 안 보이는 수준에 그친다.
const BASE_SPRING_K = 0.08; // 복원력 - 클수록 빨리 원점으로 당겨진다
const BASE_DAMPING_C = 0.48; // 감쇠 - 클수록 진동 없이 빨리 멎는다
const BASE_IMPULSE_SCALE = 0.09; // movementX/Y 1px당 주입 속도
const MAX_IMPULSE_PER_EVENT = 1.8; // 포인터 이벤트 1회가 줄 수 있는 속도 상한
const MAX_VELOCITY = 2.8; // 임펄스 누적 후 속도 총량 상한 - 연타 팬으로도 안 커진다(포화)
const DEAD_ZONE_PX = 1.5; // 이보다 작은 movementX/Y는 지터로 보고 무시(노드 드래그 등 오반응 방지)
const REST_EPS = 0.05; // |x|와 |v|가 모두 이 아래면 정지로 판정하고 루프를 끊는다

interface GroupPhysics {
  x: number;
  y: number;
  vx: number;
  vy: number;
  k: number;
  c: number;
  impulseScale: number;
}

/** 그룹 인덱스에서 결정적으로 스프링 상수를 살짝 흩뜨린다 - 그룹마다 똑같이
 * 움직이면 "판때기가 흔들린다"로 보이고, 이렇게 갈라야 "불규칙"으로 읽힌다. */
function physicsParamsFor(groupIndex: number): Omit<GroupPhysics, "x" | "y" | "vx" | "vy"> {
  const t = GROUP_COUNT > 1 ? groupIndex / (GROUP_COUNT - 1) : 0; // 0..1
  return {
    k: BASE_SPRING_K * (0.85 + 0.3 * t),
    c: BASE_DAMPING_C * (0.9 + 0.2 * t),
    impulseScale: BASE_IMPULSE_SCALE * (0.8 + 0.4 * (1 - t)),
  };
}

export function SpaceBackdrop() {
  const groupRefs = useRef<(SVGGElement | null)[]>([]);
  const physicsRef = useRef<GroupPhysics[] | null>(null);
  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 요구사항: reduce면 구독 자체를 걸지 않는다 - 별은 항상 정적.
    if (reduceMotion) return;

    physicsRef.current = Array.from({ length: GROUP_COUNT }, (_, i) => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ...physicsParamsFor(i),
    }));

    const applyTransform = (i: number, x: number, y: number) => {
      const el = groupRefs.current[i];
      if (el) el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    };

    const stopLoop = () => {
      runningRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const tick = () => {
      const groups = physicsRef.current;
      if (!groups) return;
      let totalEnergy = 0;
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        g.vx += -g.k * g.x - g.c * g.vx;
        g.x += g.vx;
        g.vy += -g.k * g.y - g.c * g.vy;
        g.y += g.vy;
        totalEnergy += Math.abs(g.x) + Math.abs(g.y) + Math.abs(g.vx) + Math.abs(g.vy);
        applyTransform(i, g.x, g.y);
      }
      if (totalEnergy < REST_EPS * groups.length) {
        // 정지 판정 - 잔 진동 없이 정확히 원점으로 스냅하고 루프를 끊는다
        // (에너지가 없으면 rAF가 영원히 도는 걸 막는 게 이 게이팅의 핵심).
        for (let i = 0; i < groups.length; i++) {
          groups[i].x = 0;
          groups[i].y = 0;
          groups[i].vx = 0;
          groups[i].vy = 0;
          applyTransform(i, 0, 0);
        }
        stopLoop();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (runningRef.current) return;
      runningRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
    };

    const onCanvasPan = (e: Event) => {
      const detail = (e as CustomEvent<{ dx: number; dy: number }>).detail;
      if (!detail) return;
      const { dx, dy } = detail;
      // 지터 데드존 - 노드 드래그 등 팬이 아닌 미세한 포인터 움직임에는
      // 절대 반응하지 않는다(요청받은 제약: 편집 중 방해 금지).
      if (Math.abs(dx) < DEAD_ZONE_PX && Math.abs(dy) < DEAD_ZONE_PX) return;
      const groups = physicsRef.current;
      if (!groups) return;
      for (const g of groups) {
        const kickX = Math.max(-MAX_IMPULSE_PER_EVENT, Math.min(MAX_IMPULSE_PER_EVENT, dx * g.impulseScale));
        const kickY = Math.max(-MAX_IMPULSE_PER_EVENT, Math.min(MAX_IMPULSE_PER_EVENT, dy * g.impulseScale));
        g.vx = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, g.vx + kickX));
        g.vy = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, g.vy + kickY));
      }
      startLoop();
    };

    window.addEventListener("ourlab:canvas-pan", onCanvasPan);
    return () => {
      window.removeEventListener("ourlab:canvas-pan", onCanvasPan);
      stopLoop();
    };
  }, []);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* 밝은 별의 광륜 - 중심만 또렷하고 급격히 사그라드는 무채색 글로우 */}
        <radialGradient id="sb-star-glow">
          <stop offset="0%" stopColor="#EDEFF5" stopOpacity="0.5" />
          <stop offset="35%" stopColor="#EDEFF5" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#EDEFF5" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 그룹별 <g> - 초기 transform은 없음(identity) = SSR/하이드레이션 마크업이
          항상 그대로다. transform은 마운트 후 팬 이벤트가 들어와야만 JS로 붙는다. */}
      {STAR_GROUPS.map((group, gi) => (
        <g
          key={`g${gi}`}
          ref={(el) => {
            groupRefs.current[gi] = el;
          }}
        >
          {/* 미광 별밭 - 사진의 "먼지처럼 깔린 별들". 그중 일부만 반짝인다. */}
          {group.dim.map((s, i) => (
            <circle
              key={`d${gi}-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#E8EAF2"
              opacity={s.opacity}
              style={s.twinkle ? twinkleStyle(s) : undefined}
            />
          ))}

          {/* 소수의 밝은 별 - 작은 광륜을 두르고 전부 반짝인다. 광륜과 별 몸통이
              같은 타이밍(twinkleStyle)으로 함께 숨쉬어야 "같은 별"로 읽힌다. */}
          {group.bright.map((s, i) => (
            <g key={`b${gi}-${i}`}>
              <circle
                cx={s.x}
                cy={s.y}
                r={s.r * 4}
                fill="url(#sb-star-glow)"
                opacity={s.opacity}
                style={twinkleStyle(s)}
              />
              <circle
                cx={s.x}
                cy={s.y}
                r={s.r * 0.55}
                fill="#F2F4FA"
                opacity={s.opacity}
                style={twinkleStyle(s)}
              />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}
