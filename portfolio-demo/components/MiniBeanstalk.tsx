import type { ReactNode } from "react";

// SVG fills take no Tailwind classes, so the palette mirrors the design tokens here.
const SOIL = "#132A18";
const TRELLIS = "#1C3A24";
const STEM = "#3F8F47"; // growth
const LEAF = "#8FDC8A"; // growth-bright
const WITHERED = "#8A6A3A"; // wither ramp
const POD = "#EFE8BD"; // bloom-200
const POD_CORE = "#E2B94F"; // bloom

export interface MiniBeanstalkProps {
  progressPct: number;
  isWithered?: boolean;
}

/** Tiny potted beanstalk for feed cards — stem height and leaf count follow progress. */
export function MiniBeanstalk({ progressPct, isWithered = false }: MiniBeanstalkProps) {
  const p = Math.max(0.07, progressPct / 100);
  const h = 112 * p;
  const stemColor = isWithered ? WITHERED : STEM;
  const leafColor = isWithered ? WITHERED : LEAF;
  const kids: ReactNode[] = [];

  kids.push(<ellipse key="soil" cx={75} cy={133} rx={52} ry={13} fill={SOIL} />);
  kids.push(
    <path
      key="dark"
      d={`M75,${133 - h} Q81,${133 - h - (124 - h) / 2} 75,${133 - 124}`}
      stroke={TRELLIS}
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
    />
  );
  kids.push(
    <path
      key="stem"
      d={`M75,133 Q64,${133 - h * 0.5} 75,${133 - h}`}
      stroke={stemColor}
      strokeWidth={7}
      fill="none"
      strokeLinecap="round"
    />
  );

  const leaves = Math.max(1, Math.round(p * 4));
  for (let j = 0; j < leaves; j++) {
    const ly = 133 - (h * (j + 1)) / (leaves + 1);
    const side = j % 2 ? 1 : -1;
    const lx = 75 + side * 13;
    kids.push(
      <ellipse
        key={`l${j}`}
        cx={lx}
        cy={ly}
        rx={11}
        ry={5}
        fill={leafColor}
        transform={`rotate(${side * -22} ${lx} ${ly})`}
      />
    );
  }

  if (progressPct >= 100) {
    for (let j = 0; j < 5; j++) {
      kids.push(
        <ellipse
          key={`p${j}`}
          cx={75}
          cy={133 - h - 9}
          rx={3.5}
          ry={8}
          fill={POD}
          transform={`rotate(${j * 72} 75 ${133 - h})`}
        />
      );
    }
    kids.push(<circle key="pc" cx={75} cy={133 - h} r={3.5} fill={POD_CORE} />);
  }

  return (
    <svg width={150} height={150} viewBox="0 0 150 150">
      {kids}
    </svg>
  );
}
