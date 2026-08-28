"use client";

/*
 * BGM 토글 - 스피커 아이콘 하나. 마운트하면 해당 모드의 BgmPlayer를 켜고,
 * 언마운트/음소거 시 페이드아웃으로 끈다. 음소거 선택은 localStorage에
 * 기억한다(랜딩·캔버스 공유 키 - 한 번 끄면 어디서든 꺼진 채 시작).
 *
 * 자동재생 정책: 제스처 전엔 AudioContext가 suspended라 소리가 안 난다 -
 * 첫 pointerdown/keydown에서 start()를 다시 불러 resume한다.
 *
 * paper 변형은 인라인 var(--paper-*)로 칠한다(TelescopeLanding의 인라인 규칙과
 * 동일 - 떠 있는 종이 크롬 어디에나 얹을 수 있다).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { BgmPlayer, type BgmMode } from "@/lib/bgm-synth";

const STORAGE_KEY = "ourlab-bgm-muted";

function SpeakerIcon({ muted, size = 15 }: { muted: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="transparent" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" />
      {muted ? (
        <path d="M16 9.5 21 14.5 M21 9.5 16 14.5" />
      ) : (
        <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5 M18 7a7 7 0 0 1 0 10" />
      )}
    </svg>
  );
}

export interface BgmToggleProps {
  mode: BgmMode;
  /** paper=떠 있는 종이 크롬 위(랜딩·캔버스 툴바), ink=잉크 표면 위. */
  variant?: "paper" | "ink";
  className?: string;
}

export function BgmToggle({ mode, variant = "paper", className }: BgmToggleProps) {
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  const playerRef = useRef<BgmPlayer | null>(null);

  // 저장된 선택은 클라에서만 읽는다(SSR 안전). 기본은 켜짐.
  useEffect(() => {
    let storedMuted = false;
    try {
      storedMuted = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // 프라이빗 모드 등 - 기본값 유지.
    }
    setMuted(storedMuted);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || muted) return;
    const player = new BgmPlayer(mode);
    playerRef.current = player;
    player.start();
    const onGesture = () => player.start();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      player.stop();
      playerRef.current = null;
    };
  }, [ready, muted, mode]);

  function toggle(): void {
    setMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 저장 실패해도 이번 세션 동작엔 지장 없음.
      }
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? "배경 음악 켜기" : "배경 음악 끄기"}
      aria-pressed={!muted}
      title={muted ? "배경 음악 켜기" : "배경 음악 끄기"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1",
        variant === "ink" &&
          "border-rule bg-ink-800/70 text-text-lo backdrop-blur-[2px] hover:text-text-hi focus-visible:outline-spec-b",
        className
      )}
      style={
        variant === "paper"
          ? {
              borderColor: "var(--paper-line)",
              background: "var(--paper-soft)",
              color: muted ? "var(--paper-lo)" : "var(--paper-ink)",
            }
          : undefined
      }
    >
      <SpeakerIcon muted={muted} />
    </button>
  );
}
