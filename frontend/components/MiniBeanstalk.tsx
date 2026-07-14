import type { ReactNode } from "react";

/** Tiny potted beanstalk for feed cards — stem height and leaf count follow progress. */
export function MiniBeanstalk({ progressPct }: { progressPct: number }) {
  const p = Math.max(0.07, progressPct / 100);
  const h = 112 * p;
  const kids: ReactNode[] = [];

  kids.push(<ellipse key="soil" cx={75} cy={133} rx={52} ry={13} fill="#132a18" />);
  kids.push(
    <path
      key="dark"
      d={`M75,${133 - h} Q81,${133 - h - (124 - h) / 2} 75,${133 - 124}`}
      stroke="#1c3a24"
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
    />
  );
  kids.push(
    <path
      key="stem"
      d={`M75,133 Q64,${133 - h * 0.5} 75,${133 - h}`}
      stroke="#3f8f47"
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
        fill="#5db35b"
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
          fill="#efe8bd"
          transform={`rotate(${j * 72} 75 ${133 - h})`}
        />
      );
    }
    kids.push(<circle key="pc" cx={75} cy={133 - h} r={3.5} fill="#e2b94f" />);
  }

  return (
    <svg width={150} height={150} viewBox="0 0 150 150">
      {kids}
    </svg>
  );
}
