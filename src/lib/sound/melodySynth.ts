'use client';

// 한국 동요 + 단순 전자음 멜로디 — Web Audio API 사인파 합성.
// AI 가 play_tune step 보내면 클라이언트가 멜로디 재생.
// 학생 "학교종이 땡땡땡에 맞춰 흔들어줘" 같은 요청에 동기화.
//
// 음높이는 frequency Hz. 길이는 beats 단위 (tempo 적용).

import type { TuneId } from '@/lib/dsl/schema';

// 음 → Hz 매핑 (A4=440 기준)
const NOTE_HZ: Record<string, number> = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
  A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
};

interface Note {
  hz: number | null;   // null = 쉼표
  beats: number;       // 1 = 한 박자
}

// 한 박자 = 0.4초 (tempo 1.0 기준 = 약 150 BPM)
const BASE_BEAT_MS = 400;

// 동요 멜로디 정의
const TUNES: Record<TuneId, Note[]> = {
  // 학교종이 땡땡땡 — 솔솔라라 솔솔미 솔솔미미레 (전통 한국 동요)
  school_bell: [
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 },
    { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.A4, beats: 1 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 },
    { hz: NOTE_HZ.E4, beats: 2 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 },
    { hz: NOTE_HZ.D4, beats: 4 },
  ],

  // 반짝반짝 작은별 — 도도솔솔라라솔
  twinkle: [
    { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 1 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 },
    { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.A4, beats: 1 },
    { hz: NOTE_HZ.G4, beats: 2 },
    { hz: NOTE_HZ.F4, beats: 1 }, { hz: NOTE_HZ.F4, beats: 1 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 },
    { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 },
    { hz: NOTE_HZ.C4, beats: 2 },
  ],

  // 나비야 나비야 — 솔미미 파레레 도레미파솔솔솔
  butterfly: [
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 2 },
    { hz: NOTE_HZ.F4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 2 },
    { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.F4, beats: 1 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 2 },
  ],

  // 산토끼 토끼야 — 솔미미 솔미미 솔라솔미레미도
  mountain_rabbit: [
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 2 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 2 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 },
    { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 2 },
  ],

  // 곰 세 마리 — 도도도 솔솔솔 라라라솔
  three_bears: [
    { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 2 },
    { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 2 },
    { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.A4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 },
    { hz: NOTE_HZ.F4, beats: 1 }, { hz: NOTE_HZ.F4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 2 },
  ],

  // 단순 전자음 패턴 — 띠띠띠띠 (8회)
  beep_pattern: Array.from({ length: 8 }, (_, i) => ({
    hz: i % 2 === 0 ? NOTE_HZ.E5 : NOTE_HZ.C5,
    beats: 0.5,
  })),
};

let _audioCtx: AudioContext | null = null;
let _activeGainNodes: GainNode[] = [];

function getCtx(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return _audioCtx;
}

export function stopMelody(): void {
  for (const g of _activeGainNodes) {
    try { g.gain.cancelScheduledValues(0); g.gain.value = 0; } catch {}
  }
  _activeGainNodes = [];
}

export async function playMelody(tune: TuneId, tempo = 1.0, muted = false): Promise<void> {
  if (typeof window === 'undefined') return;
  if (muted) return;

  stopMelody();
  const ctx = getCtx();
  // 사용자 제스처가 없으면 suspended — resume 시도
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }

  const notes = TUNES[tune];
  if (!notes) return;

  const beatMs = BASE_BEAT_MS / tempo;
  let cursorMs = 0;

  for (const note of notes) {
    if (note.hz !== null) {
      const startSec = ctx.currentTime + cursorMs / 1000;
      const durSec = (note.beats * beatMs) / 1000;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';   // 8-bit 전자음 느낌
      osc.frequency.setValueAtTime(note.hz, startSec);

      // 짧은 attack/decay envelope — 띠띠띠 느낌
      gain.gain.setValueAtTime(0, startSec);
      gain.gain.linearRampToValueAtTime(0.15, startSec + 0.01);
      gain.gain.setValueAtTime(0.15, startSec + durSec - 0.05);
      gain.gain.linearRampToValueAtTime(0, startSec + durSec);

      osc.connect(gain).connect(ctx.destination);
      osc.start(startSec);
      osc.stop(startSec + durSec);
      _activeGainNodes.push(gain);
    }
    cursorMs += note.beats * beatMs;
  }

  // 멜로디 끝까지 await 가능
  await new Promise<void>((resolve) => setTimeout(resolve, cursorMs + 100));
}

// 멜로디 총 길이 (ms) — UI 표시 또는 sync 용
export function melodyDurationMs(tune: TuneId, tempo = 1.0): number {
  const notes = TUNES[tune];
  if (!notes) return 0;
  const beatMs = BASE_BEAT_MS / tempo;
  return notes.reduce((sum, n) => sum + n.beats * beatMs, 0);
}

// 한국어 라벨 (UI 칩)
export const TUNE_LABELS: Record<TuneId, string> = {
  school_bell: '🔔 학교종이 땡땡땡',
  twinkle: '⭐ 반짝반짝 작은별',
  butterfly: '🦋 나비야',
  mountain_rabbit: '🐰 산토끼',
  three_bears: '🐻 곰 세 마리',
  beep_pattern: '🎵 띠띠 띠띠띠',
};
