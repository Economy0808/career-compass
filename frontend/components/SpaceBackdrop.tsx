/**
 * 별자리 캔버스 뒤에 까는 심우주 배경 - 성운, 먼 은하 두 개, 블랙홀 하나를
 * SVG 그라데이션/필터만으로 구성한다(이미지·새 라이브러리 없음).
 *
 * 뷰포트 고정(팬과 함께 움직이지 않음): 캔버스의 격자(.bg-radec-grid, globals.css)도
 * 이미 컨테이너 배경이라 pan/zoom <g> 밖에서 고정돼 있고, 이 배경도 그 관례를
 * 따른다. 실제 밤하늘은 몇 백 px 팬한다고 별자리가 움직이지 않는다 - 은하가
 * 노드와 같은 속도로 미끄러지면 "패럴랙스"가 아니라 "버그"로 읽힌다.
 *
 * 절대 그래프보다 튀면 안 된다 - 모든 요소가 미점등 엣지(rgba(255,255,255,0.08))
 * 보다 어둡게 유지된다. 유일한 예외는 블랙홀 강착원반의 가장 밝은 한 점이며,
 * 그마저도 낮게 잡는다. 애니메이션 없음(모션은 점등 엣지·위성 궤도에만 쓴다는
 * 하우스 룰), pointer-events: none으로 팬/드래그/엣지 연결을 절대 가로채지 않는다.
 */
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
        <radialGradient id="sb-nebula-a" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5b4fd1" stopOpacity="0.06" />
          <stop offset="55%" stopColor="#5b4fd1" stopOpacity="0.025" />
          <stop offset="100%" stopColor="#5b4fd1" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-nebula-b" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2f8fa8" stopOpacity="0.05" />
          <stop offset="55%" stopColor="#2f8fa8" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#2f8fa8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-galaxy" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#9db4ff" stopOpacity="0.09" />
          <stop offset="60%" stopColor="#9db4ff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#9db4ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sb-hole-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffa76b" stopOpacity="0.06" />
          <stop offset="45%" stopColor="#ffa76b" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#ffa76b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sb-hole-ring" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffa76b" stopOpacity="0.03" />
          <stop offset="50%" stopColor="#ffd9b0" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffa76b" stopOpacity="0.03" />
        </linearGradient>
        <filter id="sb-blur-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="sb-blur-tight" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>

      {/* 성운 워시 - 화면 대각선 양쪽 구석에 아주 옅게, 그래프가 놓일 중앙은 비워둔다. */}
      <circle cx="300" cy="220" r="420" fill="url(#sb-nebula-a)" />
      <circle cx="1260" cy="640" r="480" fill="url(#sb-nebula-b)" />

      {/* 먼 은하 두 개 - 살짝 기울인 타원 스머지. 나선팔을 그리지 않는 이유는
          디테일이 살면 시선을 끌어 "장식이 주인공"이 되기 때문. */}
      <ellipse
        cx="1400"
        cy="150"
        rx="150"
        ry="42"
        fill="url(#sb-galaxy)"
        filter="url(#sb-blur-soft)"
        transform="rotate(-24 1400 150)"
      />
      <ellipse
        cx="160"
        cy="720"
        rx="115"
        ry="30"
        fill="url(#sb-galaxy)"
        filter="url(#sb-blur-soft)"
        transform="rotate(18 160 720)"
      />

      {/* 블랙홀 - 우하단으로 비켜 배치해 그래프 중앙과 겹치지 않게 한다.
          사건의 지평선(검은 원반)은 배경보다 어둡기만 해서 밝기 상한과 무관하고,
          강착원반은 미점등 엣지보다 어둡게, 그 중 가장 밝은 호 하나만 예외로
          약간 더 밝혀 "빛나는 고리"라는 인상만 준다. */}
      <circle cx="1180" cy="740" r="170" fill="url(#sb-hole-glow)" />
      <ellipse
        cx="1180"
        cy="740"
        rx="76"
        ry="24"
        fill="none"
        stroke="url(#sb-hole-ring)"
        strokeWidth="4"
        filter="url(#sb-blur-tight)"
        transform="rotate(-20 1180 740)"
      />
      <circle cx="1180" cy="740" r="36" fill="var(--ink-900)" opacity="0.55" />
    </svg>
  );
}
