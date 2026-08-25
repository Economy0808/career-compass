"use client";

// 할 일 완료 시 "띠링" 소리 + 진동. 외부 에셋 없이 Web Audio API로 합성한다(CSP 안전).
// 오디오는 사용자 제스처(클릭) 안에서만 재생되므로 브라우저 자동재생 정책에 안전하다.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** 밝은 2음 차임("띠링"). 완료 시에만 재생한다. */
export function playDing(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  // 두 음(높은 라 → 더 높은 도)을 짧게 이어 붙여 "띠링" 느낌을 낸다.
  const notes = [
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 1174.7, start: 0.09, dur: 0.18 },
  ];
  for (const note of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    const t0 = now + note.start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
}

/** 진동(지원 기기만). 데스크톱/미지원 브라우저는 조용히 무시된다. */
export function vibrate(pattern: number | number[] = 30): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // 무시
    }
  }
}

/** 완료 체크 순간의 피드백(소리 + 진동)을 한 번에. */
export function celebrateCheck(): void {
  playDing();
  vibrate([20, 30, 20]);
}

/** 하루 목표(6개) 달성 팡파레: 밝은 상행 아르페지오 + 마지막 화음. */
export function playFanfare(): void {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  // C5-E5-G5-C6 상행 후 마지막에 C6+E6 화음으로 마무리 (밝은 장조 = 축하 느낌)
  const seq = [
    { freq: 523.25, start: 0.0, dur: 0.13 },
    { freq: 659.25, start: 0.1, dur: 0.13 },
    { freq: 783.99, start: 0.2, dur: 0.13 },
    { freq: 1046.5, start: 0.32, dur: 0.5 },
    { freq: 1318.5, start: 0.32, dur: 0.5 },
  ];
  for (const note of seq) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = note.freq;
    const t0 = now + note.start;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.03);
  }
}

/** 하루 6개 완료 축하: 팡파레 + 긴 진동 패턴. */
export function celebrateDayComplete(): void {
  playFanfare();
  vibrate([0, 40, 40, 40, 40, 120]);
}
