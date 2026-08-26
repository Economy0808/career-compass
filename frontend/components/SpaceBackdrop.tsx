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
 * 움직이지 않는다. 애니메이션 없음(모션은 점등 엣지·위성 궤도에만 쓴다는 하우스
 * 룰), pointer-events: none으로 팬/드래그/엣지 연결을 절대 가로채지 않는다.
 * 밝기 상한: 가장 밝은 별도 그래프의 미점등 엣지보다 눈에 띄지 않을 만큼만.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
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
    stars.push({
      x: Math.round(rand() * 1600 * 10) / 10,
      y: Math.round(rand() * 900 * 10) / 10,
      // 대부분은 먼지 같은 미광(0.4~0.9px), 드물게 1px대의 또렷한 별.
      r: Math.round((0.4 + brightness * brightness * 1.1) * 100) / 100,
      // 밝기도 제곱 분포 - 어두운 별이 압도적으로 많아야 사진처럼 읽힌다.
      opacity: Math.round((0.1 + brightness * brightness * 0.55) * 100) / 100,
    });
  }
  return stars;
}

// 모듈 로드 시 한 번만 생성 - 렌더마다 재계산하지 않는다.
const DIM_STARS = makeStars(20260827, 420);
// 소수의 "밝은 별"만 살짝 큰 반지름 + 부드러운 광륜.
const BRIGHT_STARS = makeStars(1004, 14).map((s) => ({
  ...s,
  r: 1.3 + s.r,
  opacity: Math.min(0.5, s.opacity + 0.22),
}));

export function SpaceBackdrop() {
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

      {/* 미광 별밭 - 사진의 "먼지처럼 깔린 별들" */}
      {DIM_STARS.map((s, i) => (
        <circle key={`d${i}`} cx={s.x} cy={s.y} r={s.r} fill="#E8EAF2" opacity={s.opacity} />
      ))}

      {/* 소수의 밝은 별 - 작은 광륜을 두른다 */}
      {BRIGHT_STARS.map((s, i) => (
        <g key={`b${i}`}>
          <circle cx={s.x} cy={s.y} r={s.r * 4} fill="url(#sb-star-glow)" opacity={s.opacity} />
          <circle cx={s.x} cy={s.y} r={s.r * 0.55} fill="#F2F4FA" opacity={s.opacity} />
        </g>
      ))}
    </svg>
  );
}
