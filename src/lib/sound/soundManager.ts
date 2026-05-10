'use client';

// 사운드 매니저 — 인터프리터 say/play_sound 이벤트를 실제 오디오 재생으로 변환.
//  - say: 텍스트를 /api/tts 로 보내서 Gemini 3.1 Flash TTS 음성 받아 재생
//  - play_sound: /public/sounds/{id}.mp3 미리 로드해서 즉시 재생
//
// 학생이 음소거 토글하면 useSoundStore.muted 로 모두 차단.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SoundEffectId, Step, Program } from '@/lib/dsl/schema';

interface SoundState {
  muted: boolean;
  // TTS 재생 중인지 (UI 표시용)
  isPlayingTts: boolean;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      muted: false,
      isPlayingTts: false,
      setMuted: (m) => set({ muted: m }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
    }),
    {
      name: '4dframe-sound',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ muted: s.muted }),
    }
  )
);

// 정적 효과음 캐시 — 첫 호출 시 lazy load.
const effectCache = new Map<SoundEffectId, HTMLAudioElement>();

function getEffect(id: SoundEffectId): HTMLAudioElement {
  let a = effectCache.get(id);
  if (!a) {
    a = new Audio(`/sounds/${id}.mp3`);
    a.preload = 'auto';
    effectCache.set(id, a);
  }
  return a;
}

export function playEffect(id: SoundEffectId, volume = 1.0): void {
  if (typeof window === 'undefined') return;
  if (useSoundStore.getState().muted) return;
  try {
    const a = getEffect(id);
    a.volume = Math.max(0, Math.min(1, volume));
    a.currentTime = 0;
    void a.play().catch(() => {
      // 자동재생 정책 등으로 실패 — 조용히 무시
    });
  } catch {}
}

// 동시 TTS 재생 방지 — 이전 재생 중이면 중단하고 새로 시작.
let currentTtsAudio: HTMLAudioElement | null = null;
let currentTtsObjectUrl: string | null = null;

// TTS Blob URL 캐시 — text → blob URL.
// 응답 받자마자 prefetchProgramAudio 가 채워둠. speakText 가 캐시 먼저 조회.
const ttsBlobCache = new Map<string, string>();

function stripAudioTags(text: string): string {
  // 인라인 태그 [excited] 등을 시각 표시용으로 노출할 때는 유지하되,
  // 음성 합성 입력에는 그대로 보내는 게 맞음 (Gemini가 처리). 이 함수는 UI 표시용.
  return text.replace(/\[(excited|whispers|laughs|curious|happy|calm|sad|angry|surprised)\]/g, '');
}

export { stripAudioTags };

// Gemini TTS voice — 언어별. 몽골어는 미지원이라 영어 voice 로 fallback.
const VOICE_BY_LOCALE: Record<string, string> = {
  ko: 'Kore',     // 한국어
  en: 'Puck',     // 영어 (활달한 톤)
  mn: 'Puck',     // 몽골어 voice 미지원 → 영어 voice 로 fallback
};

function currentLocale(): string {
  if (typeof window === 'undefined') return 'ko';
  try {
    const raw = window.localStorage.getItem('4dframe-i18n');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.state?.locale ?? 'ko';
    }
  } catch {}
  return 'ko';
}

// 한 텍스트의 TTS 를 fetch 해서 Blob URL 로 캐시. 캐시 hit 시 바로 반환.
// cache 키에 locale prefix — 같은 텍스트라도 언어별로 다른 voice.
async function fetchAndCacheTts(text: string): Promise<string | null> {
  const locale = currentLocale();
  const voice = VOICE_BY_LOCALE[locale] ?? VOICE_BY_LOCALE.ko;
  const cacheKey = `${locale}:${text}`;
  const cached = ttsBlobCache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    });
    if (!res.ok) {
      console.warn('[TTS]', res.status, await res.text().catch(() => ''));
      return null;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    ttsBlobCache.set(cacheKey, url);
    return url;
  } catch (e) {
    console.warn('[TTS] fetch failed', e);
    return null;
  }
}

export async function speakText(text: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (useSoundStore.getState().muted) return;

  stopSpeaking();
  useSoundStore.setState({ isPlayingTts: true });

  try {
    const url = await fetchAndCacheTts(text);
    if (!url) return;

    const audio = new Audio(url);
    currentTtsAudio = audio;

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        if (currentTtsAudio === audio) currentTtsAudio = null;
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(() => cleanup());
    });
  } finally {
    useSoundStore.setState({ isPlayingTts: false });
  }
}

// 응답 받은 즉시 호출 — 모든 say.text + intro 병렬 prefetch + play_sound 효과음 미리 로드.
// 학생이 ▶ 실행 누르는 시점엔 거의 모든 오디오가 준비되어 동기화 재생.
export async function prefetchProgramAudio(program: Program): Promise<void> {
  if (typeof window === 'undefined') return;
  if (useSoundStore.getState().muted) return;

  // 1) say + intro 텍스트 모두 모음
  const texts: string[] = [];
  if (program.intro) texts.push(program.intro);
  collectSayTexts(program.steps, texts);

  // 2) 정적 효과음 미리 lazy-load 트리거
  const sounds = new Set<SoundEffectId>();
  collectSoundIds(program.steps, sounds);
  for (const id of sounds) getEffect(id);

  // 3) TTS 병렬 prefetch (실패해도 무시 — 실행 시 재시도 됨)
  await Promise.all(texts.map((t) => fetchAndCacheTts(t)));
}

function collectSayTexts(steps: Step[], out: string[]): void {
  for (const s of steps) {
    if (s.do === 'say') out.push(s.text);
    else if (s.do === 'repeat') collectSayTexts(s.steps, out);
  }
}

function collectSoundIds(steps: Step[], out: Set<SoundEffectId>): void {
  for (const s of steps) {
    if (s.do === 'play_sound') out.add(s.sound);
    else if (s.do === 'repeat') collectSoundIds(s.steps, out);
  }
}

export function stopSpeaking(): void {
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); } catch {}
    currentTtsAudio = null;
  }
  // ttsBlobCache 의 URL 은 revoke 안 함 (재사용 위해 유지)
  currentTtsObjectUrl = null;
  useSoundStore.setState({ isPlayingTts: false });
}
