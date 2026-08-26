"use client";

import { useEffect } from "react";
import { celebrateDayComplete } from "@/lib/feedback";

const BEAN_PATH =
  "M8 4.5C4.8 6.2 4 11 6.6 14.8c2.7 3.9 8 5.6 11.6 3.9 3.3-1.6 4-6.4 1.4-10.2C17 4.6 11.3 2.8 8 4.5Z";

// 사방으로 튀어나가는 콩 컨페티 (듀오링고 레슨 완료 느낌)
const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.3 : 0);
  const dist = 120 + (i % 4) * 40;
  return {
    tx: `${Math.cos(angle) * dist}px`,
    ty: `${Math.sin(angle) * dist}px`,
    rot: `${(i % 2 ? 1 : -1) * (180 + (i % 5) * 90)}deg`,
    delay: (i % 6) * 0.03,
    color: ["#5db35b", "#8fdc8a", "#e2b94f", "#6abf63", "#f0e8b4"][i % 5],
    size: 14 + (i % 3) * 6,
  };
});

interface DayCompleteCelebrationProps {
  onDone: () => void;
}

export function DayCompleteCelebration({ onDone }: DayCompleteCelebrationProps) {
  useEffect(() => {
    celebrateDayComplete();
    const timer = setTimeout(onDone, 2800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={onDone}
    >
      <div className="relative flex flex-col items-center">
        {/* 퍼지는 링 */}
        <span
          className="absolute h-[140px] w-[140px] rounded-full border-2 border-bloom/60"
          style={{ animation: "cheerRing .9s ease-out forwards" }}
        />
        <span
          className="absolute h-[140px] w-[140px] rounded-full border-2 border-growth-bright/50"
          style={{ animation: "cheerRing 1.1s .15s ease-out forwards" }}
        />

        {/* 콩 컨페티 */}
        {CONFETTI.map((c, i) => (
          <svg
            key={i}
            width={c.size}
            height={c.size}
            viewBox="0 0 24 24"
            className="absolute"
            style={
              {
                "--tx": c.tx,
                "--ty": c.ty,
                "--rot": c.rot,
                animation: `confettiFly 1.1s ${c.delay}s cubic-bezier(.2,.7,.3,1) forwards`,
              } as React.CSSProperties
            }
          >
            <path d={BEAN_PATH} fill={c.color} />
          </svg>
        ))}

        {/* 중앙 메달 */}
        <div
          className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-bloom/60 bg-surface-overlay shadow-glow-bloom"
          style={{ animation: "celebratePop .6s cubic-bezier(.34,1.56,.64,1) both" }}
        >
          <svg width="60" height="60" viewBox="0 0 24 24">
            <path d={BEAN_PATH} fill="#5db35b" />
            <path
              d="M10 8c1.4 1 3.8 3 4.8 5.4"
              fill="none"
              stroke="#eef0c8"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </svg>
        </div>

        <div
          className="mt-5 text-center"
          style={{ animation: "celebrateText .5s .2s ease-out both" }}
        >
          <div className="font-serif text-title font-bold text-bloom">오늘 할 일 완성!</div>
          <div className="mt-1.5 text-body-sm text-content-secondary">
            오늘 할 일을 알차게 채웠어요. 꾸준히 잘 하고 있어요!
          </div>
        </div>
      </div>
    </div>
  );
}
