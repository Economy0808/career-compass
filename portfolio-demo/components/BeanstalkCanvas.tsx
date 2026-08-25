"use client";

import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { EagleIcon } from "@/components/ui";
import type { MilestoneOut } from "@/lib/types";

// World geometry (px). The scroll world is SKY + n segments + GROUND tall;
// milestones sit on the stem bottom-up in order_index order.
const W = 880;
const CX = 440;
const SEG = 360;
const GROUND = 560;
const SKY = 780;

export const STALK_WIDTH = W;

/** Container width the world geometry was authored against. */
const DESIGN_WIDTH = 640;

/**
 * Floor for the world scale. Branch panels keep their text at full size, so a
 * segment must stay taller than a panel (~190px) or neighbouring milestones
 * collide. 0.72 * 360px segment = 259px, which clears the tallest panel.
 */
const MIN_SCALE = 0.72;

/**
 * Shrink-only scale factor for the canvas world.
 *
 * The geometry is a fixed pixel world, so narrow screens scale the whole world
 * down rather than reflow it — the tapered stem stays the progress bar and the
 * progress math is untouched, only the coordinate system shrinks.
 *
 * Returns null until the container has been measured: callers that position
 * scroll by world coordinates must wait, or they land on the wrong branch.
 *
 * `ready` must flip to true once the measured element is actually mounted —
 * these pages render a loading notice first, and a ref alone never re-triggers
 * the effect when the real container finally appears.
 */
export function useCanvasScale(ref: RefObject<HTMLElement>, ready: boolean): number | null {
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const el = ready ? ref.current : null;
    if (!el) return;
    const apply = (w: number) => {
      if (w <= 0) return;
      // Containers up to W (the SVG's authored width) shrink-only, as before.
      // Wider containers (desktop's centered content column can exceed W)
      // grow scale just enough that the SVG fills the container exactly —
      // otherwise the artwork stops at W while the flat background keeps
      // going, leaving a hard-edged gap where bleed shapes (ground hill,
      // stars) get clipped mid-shape instead of running off the frame.
      const s = w > W ? w / W : Math.min(1, w / DESIGN_WIDTH);
      setScale(Math.max(MIN_SCALE, s));
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, ready]);
  return scale;
}

export interface SproutState {
  milestoneId: number;
  t: number;
}

export function worldHeight(n: number): number {
  return SKY + n * SEG + GROUND;
}

export function milestoneY(n: number, i: number): number {
  return worldHeight(n) - GROUND - (i + 0.5) * SEG;
}

/** 1 = branch grows to the right, -1 = to the left. */
export function milestoneSide(i: number): 1 | -1 {
  return i % 2 ? -1 : 1;
}

/** Sky-to-soil gradient. The px stops are world coordinates, so they scale too. */
export function worldBackground(scale = 1): string {
  return `linear-gradient(180deg,#233a52 0px,#152a3d ${460 * scale}px,#0f2820 ${
    (SKY + 260) * scale
  }px,#081a0e 62%,#050e07 100%)`;
}

type Pt = [number, number];

/** Stem centerline: a gentle S-curve. */
function sx(y: number): number {
  return CX + 46 * Math.sin(y / 230) + 16 * Math.sin(y / 93);
}

/** Point on a quadratic bezier. */
function qp(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

function leaf(key: string, x: number, y: number, rot: number, len: number, fill: string): ReactNode {
  const d = `M0 0 Q ${0.38 * len} ${-0.36 * len} ${len} ${-0.08 * len} Q ${0.42 * len} ${
    0.28 * len
  } 0 0`;
  return <path key={key} d={d} fill={fill} transform={`translate(${x} ${y}) rotate(${rot})`} />;
}

function curl(key: string, x: number, y: number, s: number, flip: number): ReactNode {
  return (
    <path
      key={key}
      d="M0 0 Q 16 -2 22 -14 Q 26 -26 16 -30 Q 7 -33 5 -24 Q 4 -17 11 -16"
      transform={`translate(${x} ${y}) scale(${flip * s} ${s})`}
      stroke="#5db35b"
      strokeWidth={3.5}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function flower(key: string, x: number, y: number, i: number, swayEnabled: boolean): ReactNode {
  // The sway animation must live on its own inner group: CSS transform
  // animations override the SVG transform attribute, so animating the same
  // <g> that carries the translate would throw the flower back to (0,0).
  const style: CSSProperties | undefined = swayEnabled
    ? {
        transformBox: "fill-box",
        transformOrigin: "center",
        animation: `sway ${5 + (i % 4)}s ease-in-out infinite`,
      }
    : undefined;
  return (
    <g key={key} transform={`translate(${x} ${y})`}>
      <g style={style}>
        {[0, 1, 2, 3, 4].map((k) => (
          <ellipse key={k} cx={0} cy={-11} rx={5.5} ry={11} fill="#efe8bd" transform={`rotate(${k * 72})`} />
        ))}
        <circle r={4.5} fill="#e2b94f" />
      </g>
    </g>
  );
}

interface BeanstalkCanvasProps {
  /** Milestones sorted by order_index ascending. */
  milestones: MilestoneOut[];
  progressPct: number;
  /** Milestone just completed — replays the branch/foliage grow animation. */
  sprout: SproutState | null;
  /** Wave of leaves/blossoms growing up the stalk (100% celebration or preview). */
  celebrating: boolean;
  /** Re-keys the celebration so it replays on a new burst. */
  celebrationKey: number;
  /** Flower + glow at the stem tip (real 100% or preview). */
  showTopBloom: boolean;
  fireflies: boolean;
  swayEnabled: boolean;
  /** Shrink-only world scale from `useCanvasScale`. 1 = authored size. */
  scale: number;
}

export function BeanstalkCanvas({
  milestones,
  progressPct,
  sprout,
  celebrating,
  celebrationKey,
  showTopBloom,
  fireflies,
  swayEnabled,
  scale,
}: BeanstalkCanvasProps) {
  const n = milestones.length;
  const H = worldHeight(n);
  const stemTop = SKY - 140;
  const stemBot = H - GROUND + 180;

  const pts: Pt[] = [];
  for (let y = stemBot; y >= stemTop; y -= 20) pts.push([sx(y), y]);

  let topDone = -1;
  milestones.forEach((m, i) => {
    if (m.status === "완료") topDone = i;
  });
  const splitY =
    progressPct >= 100 ? stemTop : topDone >= 0 ? milestoneY(n, topDone) - 80 : stemBot - 140;
  const donePts = pts.filter((p) => p[1] >= splitY);

  // Stem is a filled tapered polygon, not a stroke: thin at the top, thick at the ground.
  const hw = (y: number): number => 4.5 + 9.5 * ((y - stemTop) / (stemBot - stemTop));
  // `spread` widens the taper (drop shadow / vivid overlay), unrelated to world scale.
  const taperPoly = (arr: Pt[], spread: number): string => {
    if (arr.length < 2) return "";
    const left = arr.map((p) => `${(p[0] - hw(p[1]) * spread).toFixed(1)},${p[1]}`);
    const right = [...arr].reverse().map((p) => `${(p[0] + hw(p[1]) * spread).toFixed(1)},${p[1]}`);
    return `M${left.join(" L")} L${right.join(" L")}Z`;
  };
  const lineOf = (arr: Pt[]): string =>
    arr.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  const kids: ReactNode[] = [];

  // Moon + stars
  kids.push(<circle key="mh" cx={W - 150} cy={200} r={66} fill="#dfe6d2" opacity={0.1} />);
  kids.push(<circle key="m1" cx={W - 150} cy={200} r={38} fill="#e9edda" opacity={0.9} />);
  kids.push(<circle key="m2" cx={W - 161} cy={191} r={29} fill="#f5f7ea" />);
  for (let k = 0; k < 34; k++) {
    kids.push(
      <circle
        key={`st${k}`}
        cx={(k * 233 + 57) % W}
        cy={(k * 151 + 31) % 600}
        r={0.8 + (k % 3) * 0.7}
        fill="#dce8f0"
        style={{ animation: `twinkle ${2.6 + (k % 5) * 0.9}s ease-in-out ${k * 0.37}s infinite` }}
      />
    );
  }

  // Clouds — densest just below the goal, like a platform.
  const cloud = (key: string, x: number, y: number, s: number, o: number): ReactNode => (
    <g key={key} transform={`translate(${x} ${y}) scale(${s})`} opacity={o}>
      <ellipse cx={0} cy={0} rx={90} ry={26} fill="#c7d5e6" />
      <ellipse cx={-54} cy={8} rx={56} ry={20} fill="#b6c6da" />
      <ellipse cx={48} cy={6} rx={60} ry={22} fill="#bccbde" />
      <ellipse cx={8} cy={-15} rx={48} ry={20} fill="#d3dfec" />
    </g>
  );
  kids.push(
    cloud("c1", CX - 150, 470, 1.5, 0.34),
    cloud("c2", CX + 200, 570, 1.05, 0.24),
    cloud("c3", CX - 30, SKY - 150, 1.9, 0.42),
    cloud("c4", 120, 330, 0.9, 0.18),
    cloud("c5", W - 120, 660, 0.8, 0.16)
  );

  // Ground hills + grass
  kids.push(<ellipse key="g1" cx={CX} cy={H - 220} rx={580} ry={240} fill="#0c2113" />);
  kids.push(<ellipse key="g2" cx={CX - 200} cy={H - 140} rx={500} ry={210} fill="#081a0d" />);
  for (let k = 0; k < 14; k++) {
    const gx = CX - 260 + k * 40;
    const dx = (k % 2 ? 1 : -1) * (8 + (k % 5) * 3);
    kids.push(
      <path
        key={`gr${k}`}
        d={`M${gx} ${H - 330} q ${dx} -36 ${dx * 1.7} -62`}
        stroke="#1d4526"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
    );
  }

  // Stem: dark (not yet grown) below, vivid (completed) up to splitY — the stem IS the progress bar.
  kids.push(<path key="sb2" d={taperPoly(pts, 2.0)} fill="#0e2013" opacity={0.55} />);
  kids.push(<path key="sb1" d={taperPoly(pts, 1.0)} fill="#173420" />);
  kids.push(
    <circle key="sbt" cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={hw(stemTop)} fill="#173420" />
  );
  if (donePts.length > 1) {
    kids.push(<path key="sd1" d={taperPoly(donePts, 2.0)} fill="#2a6134" />);
    kids.push(<path key="sd2" d={taperPoly(donePts, 1.45)} fill="#3f8f47" />);
    kids.push(
      <circle
        key="sdt"
        cx={donePts[donePts.length - 1][0]}
        cy={donePts[donePts.length - 1][1]}
        r={hw(donePts[donePts.length - 1][1]) * 1.9}
        fill="#3f8f47"
      />
    );
    kids.push(
      <path
        key="sd3"
        d={lineOf(donePts.map((p) => [p[0] - hw(p[1]) * 0.7, p[1]]))}
        stroke="#6cc167"
        strokeWidth={5}
        fill="none"
        opacity={0.65}
        strokeLinecap="round"
      />
    );
  }

  // Branches — one per milestone, alternating sides; overdue branches droop.
  milestones.forEach((m, i) => {
    const y = milestoneY(n, i);
    const bx = sx(y);
    const side = milestoneSide(i);
    const st = m.status;
    const ex = bx + side * (st === "기한초과" ? 150 : 178);
    const ey = st === "기한초과" ? y + 46 : y - 30;
    const c1: Pt = [bx + side * 84, st === "기한초과" ? y + 8 : y - 2];
    const p0: Pt = [bx, y];
    const p2: Pt = [ex, ey];
    const branchD = `M${bx},${y} Q${c1[0]},${c1[1]} ${ex},${ey}`;
    const anim = sprout !== null && sprout.milestoneId === m.id;

    const branchColor = st === "완료" ? "#3f8f47" : st === "진행중" ? "#2c5b36" : "#5a4527";
    const branch = (
      <path
        key={`b${anim ? sprout.t : ""}`}
        d={branchD}
        stroke={branchColor}
        strokeWidth={st === "완료" ? 9 : 6}
        fill="none"
        strokeLinecap="round"
        style={
          anim
            ? { strokeDasharray: 300, strokeDashoffset: 0, animation: "drawBranch .55s ease-out" }
            : undefined
        }
      />
    );

    const foliage: ReactNode[] = [];
    if (st === "완료") {
      const rots = [-46, 28, -24, 40];
      [0.32, 0.5, 0.68, 0.86].forEach((t, k) => {
        const p = qp(p0, c1, p2, t);
        foliage.push(
          leaf(`l${k}`, p[0], p[1], side === 1 ? rots[k] : 180 - rots[k], 30 + k * 5, k % 2 ? "#4ea355" : "#6abf63")
        );
      });
      foliage.push(flower("fl", ex, ey, i, swayEnabled));
      foliage.push(curl("cu", bx - side * 16, y - 34, 1, -side));
    } else if (st === "진행중") {
      const p = qp(p0, c1, p2, 0.55);
      foliage.push(leaf("l0", p[0], p[1], side === 1 ? -30 : 210, 24, "#3f7d46"));
      foliage.push(
        <g key="bud" transform={`translate(${ex} ${ey})`}>
          <path d="M0 7 Q -8 -4 0 -17 Q 8 -4 0 7" fill="#79b56b" />
          <path d="M0 7 Q -11 5 -9 -6" stroke="#3f7d46" strokeWidth={3} fill="none" strokeLinecap="round" />
        </g>
      );
    } else {
      [0.45, 0.75].forEach((t, k) => {
        const p = qp(p0, c1, p2, t);
        foliage.push(
          leaf(`l${k}`, p[0], p[1], side === 1 ? 48 + k * 18 : 132 - k * 18, 28, k ? "#6e5430" : "#8a6a3a")
        );
      });
      foliage.push(leaf("le", ex, ey, side === 1 ? 70 : 110, 26, "#7a5c33"));
    }

    const knot = (
      <circle
        key="kn"
        cx={bx}
        cy={y}
        r={8}
        fill={st === "완료" ? "#5db35b" : "#1c3a24"}
        stroke={st === "완료" ? "#8fdc8a" : "#3f6f49"}
        strokeWidth={2.5}
      />
    );

    if (anim) {
      // Branch draws outward from the stem; foliage pops after, scaling from the stem side.
      kids.push(
        <g key={`ms${m.order_index}${sprout.t}`}>
          {branch}
          <g
            key="fol"
            style={{
              transformBox: "fill-box",
              transformOrigin: side === 1 ? "left center" : "right center",
              animation: "sprout .7s cubic-bezier(.34,1.56,.64,1) .38s both",
            }}
          >
            {foliage}
          </g>
          {knot}
        </g>
      );
    } else {
      kids.push(
        <g key={`ms${m.order_index}`}>
          {branch}
          {foliage}
          {knot}
        </g>
      );
    }
  });

  // Stem tip
  kids.push(curl("tip", sx(stemTop), stemTop - 6, 1.3, 1));
  kids.push(leaf("tl1", sx(stemTop) + 4, stemTop + 26, -64, 30, "#4ea355"));
  kids.push(leaf("tl2", sx(stemTop) - 6, stemTop + 44, 224, 26, "#3f7d46"));
  if (showTopBloom) {
    kids.push(flower("topfl", sx(stemTop), stemTop - 28, 1, swayEnabled));
    kids.push(
      <circle
        key="tg"
        cx={sx(stemTop)}
        cy={stemTop - 28}
        r={60}
        fill="#f0e8b4"
        opacity={0.14}
        style={{ animation: "twinkle 3s ease-in-out infinite" }}
      />
    );
  }

  // Celebration: a wave of leaves & blossoms grows up the stalk (no falling petals).
  if (celebrating) {
    for (let k = 0; k < 20; k++) {
      const cy = stemBot - 120 - k * ((stemBot - stemTop - 200) / 19);
      const side2 = k % 2 ? 1 : -1;
      const cx2 = sx(cy) + side2 * (hw(cy) * 0.8);
      const grow: CSSProperties = {
        transformBox: "fill-box",
        transformOrigin: side2 === 1 ? "left center" : "right center",
        animation: `sprout .6s cubic-bezier(.34,1.56,.64,1) ${k * 0.09}s both`,
      };
      if (k % 4 === 3) {
        kids.push(
          <g key={`cb${k}-${celebrationKey}`} style={grow}>
            {flower(`cbf${k}`, cx2 + side2 * 16, cy, k, swayEnabled)}
          </g>
        );
      } else {
        kids.push(
          <g key={`cb${k}-${celebrationKey}`} style={grow}>
            {leaf(
              `cbl${k}`,
              cx2,
              cy,
              side2 === 1 ? (k % 3) * 16 - 24 : 180 + 24 - (k % 3) * 16,
              26 + (k % 3) * 7,
              k % 2 ? "#6abf63" : "#8fdc8a"
            )}
          </g>
        );
      }
    }
  }

  if (fireflies && n > 0) {
    for (let k = 0; k < 14; k++) {
      const fy = H - GROUND - ((k * 467) % (n * SEG));
      const fx = (k * 173 + 70) % W;
      kids.push(
        <circle
          key={`ff${k}`}
          cx={fx}
          cy={fy}
          r={2.4}
          fill="#d8e77a"
          opacity={0.85}
          style={{ animation: `floaty ${6 + (k % 5)}s ease-in-out ${k * 0.7}s infinite` }}
        />
      );
    }
  }

  return (
    // The viewBox stays in world units and only the rendered box shrinks, so
    // every coordinate above — including the progress split — is untouched.
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg
        width={W * scale}
        height={H * scale}
        viewBox={`0 0 ${W} ${H}`}
        style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 0, display: "block" }}
      >
        {kids}
      </svg>
      {/* A single distant eagle marks the sky the beanstalk is climbing toward. */}
      <EagleIcon
        size={26}
        className={`absolute [animation:sway_9s_ease-in-out_infinite] ${
          progressPct >= 100 ? "text-goal-bright/55" : "text-goal-bright/25"
        }`}
        style={{ left: "68%", top: 48 * scale }}
      />
    </div>
  );
}
