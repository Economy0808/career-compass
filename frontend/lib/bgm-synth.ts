/**
 * 진입 플로우 BGM - Web Audio 실시간 합성 엔진.
 *
 * 오디오 파일 대신 악보(lib/bgm-score.ts, 3KB)를 실시간 합성한다:
 * 14MB wav 자산 문제가 사라지고, 루프가 이음새 없이 되고, 모드별 음색을
 * 파라미터로 가른다. 합성 수식은 데모 렌더러(파이썬)와 동일 계열 -
 * PeriodicWave(배음 스펙트럼) + 게인 엔벨로프 + 핑퐁 딜레이.
 *
 * 모드(사용자 배치):
 * - landing: 묵직한 쪽(wav 데모 믹스) - 랜딩 페이지.
 * - canvas: "미디 재생 느낌"(밝은 오르골 + 합창풍 허밍, 가벼운 저음) - 캔버스.
 *
 * 브라우저 자동재생 정책: 사용자 제스처 전엔 AudioContext가 suspended라
 * start()를 여러 번 불러도 안전하다(제스처 후 resume되며 처음부터 재생).
 */

import { BGM_BARS, BGM_SCORE, BGM_TEMPO } from "./bgm-score";

export type BgmMode = "landing" | "canvas";

const BEAT = 60 / BGM_TEMPO;
const TOTAL_BEATS = BGM_BARS * 4;
/** 곡 끝 여운 뒤 재시작까지의 간격(박). */
const LOOP_GAP_BEATS = 4;

interface ModeParams {
  /** 오르골 배음(인덱스=배음 차수, 0번은 미사용). */
  pluckHarmonics: number[];
  /** 허밍 레이어 디튠 - 1개면 솔로, 2개면 합창풍. */
  voiceDetunes: number[];
  bassGain: number;
  padGain: number;
  riffFeedback: number;
  voiceFeedback: number;
  master: number;
}

const PARAMS: Record<BgmMode, ModeParams> = {
  landing: {
    pluckHarmonics: [0, 1, 0.26, 0.1, 0.035],
    voiceDetunes: [1],
    bassGain: 1,
    padGain: 1,
    riffFeedback: 0.42,
    voiceFeedback: 0.45,
    master: 0.32,
  },
  canvas: {
    pluckHarmonics: [0, 1, 0.38, 0.18, 0.07],
    voiceDetunes: [0.9965, 1.0038],
    bassGain: 0.5,
    padGain: 0.8,
    riffFeedback: 0.32,
    voiceFeedback: 0.3,
    master: 0.24,
  },
};

const PAD_HARMONICS = [0, 0.62, 0.24, 0.11, 0.05];
const BASS_HARMONICS = [0, 1, 0.14];
const VOICE_HARMONICS = [0, 1, 0.32, 0.16, 0.05];

function freqOf(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function makeWave(ctx: AudioContext, harmonics: number[]): PeriodicWave {
  const real = new Float32Array(harmonics.length);
  const imag = new Float32Array(harmonics);
  return ctx.createPeriodicWave(real, imag);
}

/** 핑퐁 딜레이: 입력 → 좌우로 번갈아 반사되며 감쇠. wet만 출력한다. */
function pingpong(ctx: AudioContext, input: AudioNode, out: AudioNode, delaySec: number, feedback: number) {
  const dA = ctx.createDelay(4);
  const dB = ctx.createDelay(4);
  dA.delayTime.value = delaySec;
  dB.delayTime.value = delaySec;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const fb2 = ctx.createGain();
  fb2.gain.value = feedback;
  const panR = new StereoPannerNode(ctx, { pan: 0.7 });
  const panL = new StereoPannerNode(ctx, { pan: -0.7 });
  const wet = ctx.createGain();
  wet.gain.value = 0.7;
  input.connect(dA);
  dA.connect(panR).connect(wet);
  dA.connect(fb).connect(dB);
  dB.connect(panL).connect(wet);
  dB.connect(fb2).connect(dA);
  wet.connect(out);
}

export class BgmPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waves: { pluck: PeriodicWave; pad: PeriodicWave; bass: PeriodicWave; voice: PeriodicWave } | null = null;
  private buses: { riff: GainNode; voice: GainNode; pad: GainNode; bass: GainNode } | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private started = false;

  constructor(private mode: BgmMode) {}

  /** 여러 번 불러도 안전 - 첫 호출이 그래프를 만들고, 이후엔 resume만 시도. */
  start(): void {
    if (this.stopped) return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const p = PARAMS[this.mode];

      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(p.master, ctx.currentTime + 1.5);
      this.master = master;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);

      const mkBus = () => {
        const g = ctx.createGain();
        g.connect(master);
        return g;
      };
      this.buses = { riff: mkBus(), voice: mkBus(), pad: mkBus(), bass: mkBus() };
      pingpong(ctx, this.buses.riff, master, BEAT * 0.75, p.riffFeedback);
      pingpong(ctx, this.buses.voice, master, BEAT, p.voiceFeedback);

      this.waves = {
        pluck: makeWave(ctx, p.pluckHarmonics),
        pad: makeWave(ctx, PAD_HARMONICS),
        bass: makeWave(ctx, BASS_HARMONICS),
        voice: makeWave(ctx, VOICE_HARMONICS),
      };
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    if (!this.started) {
      this.started = true;
      this.schedulePass(this.ctx.currentTime + 0.15);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    // 짧게 페이드아웃 후 컨텍스트 정리.
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 1200);
    this.ctx = null;
  }

  /** 곡 전체(20마디)를 t0 기준으로 예약하고, 끝나기 전에 다음 회차를 예약한다. */
  private schedulePass(t0: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.waves || !this.buses || this.stopped) return;
    const p = PARAMS[this.mode];
    let prevVoiceFreq: number | null = null;

    for (const note of BGM_SCORE) {
      const t = t0 + note.s * BEAT;
      const dur = note.d * BEAT;
      const f = freqOf(note.n);
      if (note.t === "riff") {
        for (const det of [0.9995, 1.0006]) {
          this.tone(this.buses.riff, this.waves.pluck, f * det, t, Math.max(dur, 1.1) + 0.8, {
            peak: note.a * 0.55,
            attack: 0.007,
            decayTau: 0.5,
          });
        }
      } else if (note.t === "pad") {
        for (const det of [0.9972, 1, 1.0031]) {
          this.tone(this.buses.pad, this.waves.pad, f * det, t, dur + 2, {
            peak: note.a * 0.5 * p.padGain,
            attack: 1.1,
            releaseAt: dur,
            releaseTau: 0.55,
          });
        }
      } else if (note.t === "bass") {
        this.tone(this.buses.bass, this.waves.bass, f, t, dur + 1, {
          peak: note.a * 1.3 * p.bassGain,
          attack: 0.12,
          releaseAt: dur,
          releaseTau: 0.15,
        });
      } else {
        // 허밍 훅: 지연 비브라토 + 포르타멘토.
        for (const det of p.voiceDetunes) {
          this.voiceTone(
            f * det,
            prevVoiceFreq !== null && note.g ? prevVoiceFreq * det : null,
            t,
            dur,
            note.a / p.voiceDetunes.length
          );
        }
        prevVoiceFreq = f;
      }
    }

    const passLen = (TOTAL_BEATS + LOOP_GAP_BEATS) * BEAT;
    const nextT0 = t0 + passLen;
    const waitMs = Math.max(1000, (nextT0 - ctx.currentTime - 3) * 1000);
    this.loopTimer = setTimeout(() => this.schedulePass(nextT0), waitMs);
  }

  private tone(
    bus: GainNode,
    wave: PeriodicWave,
    freq: number,
    t: number,
    life: number,
    env: { peak: number; attack: number; decayTau?: number; releaseAt?: number; releaseTau?: number }
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(env.peak, t + env.attack);
    if (env.decayTau) {
      g.gain.setTargetAtTime(0, t + env.attack, env.decayTau);
    } else if (env.releaseAt !== undefined && env.releaseTau) {
      g.gain.setTargetAtTime(0, t + env.releaseAt, env.releaseTau);
    }
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + life);
  }

  private voiceTone(freq: number, glideFrom: number | null, t: number, dur: number, amp: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.waves || !this.buses) return;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.waves.voice);
    if (glideFrom !== null) {
      osc.frequency.setValueAtTime(glideFrom, t);
      osc.frequency.linearRampToValueAtTime(freq, t + 0.13);
    } else {
      osc.frequency.setValueAtTime(freq, t);
    }
    // 지연 비브라토: 0.22초 뒤부터 0.5초에 걸쳐 깊어진다.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1;
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.setValueAtTime(0, t + 0.22);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.0035, t + 0.72);
    lfo.connect(lfoGain).connect(osc.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.9, t + 0.09);
    g.gain.setTargetAtTime(0, t + dur, 0.18);
    osc.connect(g).connect(this.buses.voice);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 1);
    lfo.stop(t + dur + 1);
  }
}
