'use client';

// 한국 동요 + 단순 전자음 멜로디 — Web Audio API 사인파 합성.
// AI 가 play_tune step 보내면 클라이언트가 멜로디 재생.
// 학생 "학교종이 땡땡땡에 맞춰 흔들어줘" 같은 요청에 동기화.
//
// 음높이는 frequency Hz. 길이는 beats 단위 (tempo 적용).
//
// 'custom' tune — AI 가 학생 요청 (분위기/리듬/노래) 으로 직접 만든 즉석 멜로디.
// notes 배열을 그대로 재생. 부정확해도 OK — 학생-AI 협업 창작이 핵심.

import type { TuneId, CustomTune } from '@/lib/dsl/schema';

// 음 → Hz 매핑 (A4=440 기준)
const NOTE_HZ: Record<string, number> = {
  E2: 82.41, F2: 87.31, G2: 98.00,            // 죠스용 저음
  C3: 130.81, D3: 146.83, E3: 164.81, G3: 196.00,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00,
  A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
  C6: 1046.50, E6: 1318.51,                   // 오르골 고음
};

interface Note {
  hz: number | null;   // null = 쉼표
  beats: number;       // 1 = 한 박자
}

// 한 박자 = 0.4초 (tempo 1.0 기준 = 약 150 BPM)
const BASE_BEAT_MS = 400;

// 동요 멜로디 정의 (preset)
const TUNES: Record<Exclude<TuneId, 'custom'>, Note[]> = {
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

  // 떴다떴다 비행기 — Mary Had a Little Lamb (한국 번안). 미레도레 미미미 / 레레레 / 미솔솔 / ...
  airplane: [
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 2 },
    { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 2 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 1 }, { hz: NOTE_HZ.G4, beats: 2 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.C4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 },
    { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 },
    { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 }, { hz: NOTE_HZ.E4, beats: 1 }, { hz: NOTE_HZ.D4, beats: 1 },
    { hz: NOTE_HZ.C4, beats: 4 },
  ],

  // 단순 전자음 패턴 — 띠띠띠띠 (8회)
  beep_pattern: Array.from({ length: 8 }, (_, i) => ({
    hz: i % 2 === 0 ? NOTE_HZ.E5 : NOTE_HZ.C5,
    beats: 0.5,
  })),

  // 🎵 오르골 — 반짝반짝 멜로디 + 태엽 풀어지는 dynamics (시작 빠름 → 점점 느려짐).
  // 옥타브 낮춤 (C4 ~ C5) — 더 부드럽고 친숙. triangle wave 가 자동 적용 (오르골 본질).
  // beats 점진 증가 = 자연 감속. 마지막 음 길게.
  music_box: [
    { hz: NOTE_HZ.C4, beats: 0.5 }, { hz: NOTE_HZ.C4, beats: 0.5 },
    { hz: NOTE_HZ.G4, beats: 0.6 }, { hz: NOTE_HZ.G4, beats: 0.6 },
    { hz: NOTE_HZ.A4, beats: 0.7 }, { hz: NOTE_HZ.A4, beats: 0.7 },
    { hz: NOTE_HZ.G4, beats: 1.2 },
    { hz: NOTE_HZ.F4, beats: 0.9 }, { hz: NOTE_HZ.F4, beats: 0.9 },
    { hz: NOTE_HZ.E4, beats: 1.0 }, { hz: NOTE_HZ.E4, beats: 1.0 },
    { hz: NOTE_HZ.D4, beats: 1.4 }, { hz: NOTE_HZ.D4, beats: 1.4 },
    { hz: NOTE_HZ.C4, beats: 2.5 },   // 길게 늘어짐
    { hz: null, beats: 0.5 },
    { hz: NOTE_HZ.C4, beats: 4.0 },   // 잔잔한 마지막 한 음 (태엽 다 풀린 상태)
  ],

  // 🦈 죠스 등장음 — E-F E-F 두 음 점점 빨라짐. 긴장감 점증.
  // beats 감소 = 점점 빠른 템포 (긴박).
  jaws: [
    { hz: NOTE_HZ.E2, beats: 1.5 }, { hz: NOTE_HZ.F2, beats: 1.5 },
    { hz: NOTE_HZ.E2, beats: 1.2 }, { hz: NOTE_HZ.F2, beats: 1.2 },
    { hz: NOTE_HZ.E2, beats: 0.9 }, { hz: NOTE_HZ.F2, beats: 0.9 },
    { hz: NOTE_HZ.E2, beats: 0.6 }, { hz: NOTE_HZ.F2, beats: 0.6 },
    { hz: NOTE_HZ.E2, beats: 0.4 }, { hz: NOTE_HZ.F2, beats: 0.4 },
    { hz: NOTE_HZ.E2, beats: 0.3 }, { hz: NOTE_HZ.F2, beats: 0.3 },
    { hz: NOTE_HZ.E3, beats: 2.0 },   // 폭발음 — 한 옥타브 위 길게
  ],
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

// custom tune 의 pitch 문자열 → Hz 변환. 'C4', 'D#4', 'rest' 모두 처리.
// 미지의 형식은 NOTE_HZ 직접 참조 후 fallback C4.
function pitchToHz(pitch: string): number | null {
  const trimmed = pitch.trim();
  if (!trimmed || trimmed.toLowerCase() === 'rest' || trimmed === '-') return null;
  const direct = NOTE_HZ[trimmed.toUpperCase()];
  if (typeof direct === 'number') return direct;
  // 못 찾으면 C4 fallback (안 들리는 것보다 낫게)
  return NOTE_HZ.C4;
}

// 즉석 melody — AI 가 만든 notes 배열을 Note[] 로 변환
function customToNotes(custom: CustomTune): Note[] {
  return custom.notes.map((n) => ({
    hz: pitchToHz(n.pitch),
    beats: Math.max(0.1, Math.min(8, n.beats)),
  }));
}

export async function playMelody(
  tune: TuneId,
  tempo = 1.0,
  muted = false,
  custom?: CustomTune,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (muted) return;

  stopMelody();
  const ctx = getCtx();
  // 사용자 제스처가 없으면 suspended — resume 시도
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }

  // custom 분기 — preset 카탈로그 외, AI 가 만든 즉석 멜로디
  let notes: Note[];
  if (tune === 'custom') {
    if (!custom) return;
    notes = customToNotes(custom);
  } else {
    const presetNotes = TUNES[tune];
    if (!presetNotes) return;
    notes = presetNotes;
  }

  // tune 별 음색.
  //   music_box: triangle (부드러운 오르골 본질) + 긴 sustain (오르골 chime 느낌)
  //   jaws: sine (저음 풍부, 위협 톤)
  //   custom: AI 지정 timbre 또는 square 기본
  //   기본: square (8-bit 전자음)
  let oscType: OscillatorType = 'square';
  let peakGain = 0.15;
  let attackSec = 0.01;
  let releaseSec = 0.05;
  if (tune === 'music_box') {
    oscType = 'triangle';
    peakGain = 0.22;          // 더 크게 (잘 들리도록)
    attackSec = 0.02;
    releaseSec = 0.18;        // 길게 ring out — 오르골 chime
  } else if (tune === 'jaws') {
    oscType = 'sine';
    peakGain = 0.35;          // 저음은 잘 안 들리니 크게
    attackSec = 0.03;
    releaseSec = 0.12;
  } else if (tune === 'custom' && custom?.timbre) {
    oscType = custom.timbre;
    if (custom.timbre === 'triangle') { peakGain = 0.22; releaseSec = 0.15; }
    else if (custom.timbre === 'sine') { peakGain = 0.30; releaseSec = 0.10; }
  }

  const beatMs = BASE_BEAT_MS / tempo;
  let cursorMs = 0;

  for (const note of notes) {
    if (note.hz !== null) {
      const startSec = ctx.currentTime + cursorMs / 1000;
      const durSec = (note.beats * beatMs) / 1000;
      const safeRelease = Math.min(releaseSec, durSec * 0.4);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = oscType;
      osc.frequency.setValueAtTime(note.hz, startSec);

      gain.gain.setValueAtTime(0, startSec);
      gain.gain.linearRampToValueAtTime(peakGain, startSec + attackSec);
      gain.gain.setValueAtTime(peakGain, startSec + durSec - safeRelease);
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
export function melodyDurationMs(tune: TuneId, tempo = 1.0, custom?: CustomTune): number {
  const beatMs = BASE_BEAT_MS / tempo;
  if (tune === 'custom') {
    if (!custom) return 0;
    return custom.notes.reduce((sum, n) => sum + Math.max(0.1, Math.min(8, n.beats)) * beatMs, 0);
  }
  const notes = TUNES[tune];
  if (!notes) return 0;
  return notes.reduce((sum, n) => sum + n.beats * beatMs, 0);
}

// 한국어 라벨 (UI 칩)
export const TUNE_LABELS: Record<TuneId, string> = {
  school_bell: '🔔 학교종이 땡땡땡',
  twinkle: '⭐ 반짝반짝 작은별',
  butterfly: '🦋 나비야',
  mountain_rabbit: '🐰 산토끼',
  three_bears: '🐻 곰 세 마리',
  airplane: '✈️ 떴다떴다 비행기',
  beep_pattern: '🎵 띠띠 띠띠띠',
  music_box: '🎼 오르골',
  jaws: '🦈 죠스 등장',
  custom: '🎶 즉석 멜로디',
};
