"use client";

import { useEffect } from "react";
import { celebrateDayComplete } from "@/lib/feedback";

const STAR_PATH =
  "M12 2.5l2.7 6.4 6.9.6-5.3 4.6 1.6 6.8L12 17.3l-5.9 3.6 1.6-6.8-5.3-4.6 6.9-.6L12 2.5Z";

// 사방으로 튀어나가는 별 컨페티
const CONFETTI = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.3 : 0);
  const dist = 120 + (i % 4) * 40;
  return {
    tx: `${Math.cos(angle) * dist}px`,
    ty: `${Math.sin(angle) * dist}px`,
    rot: `${(i % 2 ? 1 : -1) * (180 + (i % 5) * 90)}deg`,
    delay: (i % 6) * 0.03,
    color: ["#FFF3C4", "#9DB4FF", "#E8ECFF", "#FFD98A", "#FFA76B"][i % 5],
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
          className="absolute h-[140px] w-[140px] rounded-full border-2 border-lit/60"
          style={{ animation: "cheerRing .9s ease-out forwards" }}
        />
        <span
          className="absolute h-[140px] w-[140px] rounded-full border-2 border-spec-b/50"
          style={{ animation: "cheerRing 1.1s .15s ease-out forwards" }}
        />

        {/* 별 컨페티 */}
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
            <path d={STAR_PATH} fill={c.color} />
          </svg>
        ))}

        {/* 중앙 별 */}
        <div
          className="flex h-[112px] w-[112px] items-center justify-center rounded-full border-2 border-lit/60 bg-ink-800 shadow-glow-bloom"
          style={{ animation: "celebratePop .6s cubic-bezier(.34,1.56,.64,1) both" }}
        >
          <svg width="60" height="60" viewBox="0 0 24 24">
            <path d={STAR_PATH} fill="#FFF3C4" />
          </svg>
        </div>

        <div
          className="mt-5 text-center"
          style={{ animation: "celebrateText .5s .2s ease-out both" }}
        >
          <div className="font-serif text-title font-bold text-lit">오늘 할 일 완성!</div>
          <div className="mt-1.5 text-body-sm text-text-lo">
            오늘 할 일을 알차게 채웠어요. 꾸준히 잘 하고 있어요!
          </div>
        </div>
      </div>
    </div>
  );
}
