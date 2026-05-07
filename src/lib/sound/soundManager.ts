'use client';

// 사운드 매니저 — 인터프리터 say/play_sound 이벤트를 실제 오디오 재생으로 변환.
//  - say: 텍스트를 /api/tts 로 보내서 Gemini 3.1 Flash TTS 음성 받아 재생
//  - play_sound: /public/sounds/{id}.mp3 미리 로드해서 즉시 재생
//
// 학생이 음소거 토글하면 useSoundStore.muted 로 모두 차단.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SoundEffectId } from '@/lib/dsl/schema';

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

function stripAudioTags(text: string): string {
  // 인라인 태그 [excited] 등을 시각 표시용으로 노출할 때는 유지하되,
  // 음성 합성 입력에는 그대로 보내는 게 맞음 (Gemini가 처리). 이 함수는 UI 표시용.
  return text.replace(/\[(excited|whispers|laughs|curious|happy|calm|sad|angry|surprised)\]/g, '');
}

export { stripAudioTags };

export async function speakText(text: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (useSoundStore.getState().muted) return;

  // 이전 재생 중단
  stopSpeaking();

  useSoundStore.setState({ isPlayingTts: true });
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      // TTS 실패 — 조용히 fallback (콘솔에만 남기고 UI 막지 않음)
      console.warn('[TTS]', res.status, await res.text().catch(() => ''));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    currentTtsObjectUrl = url;

    const audio = new Audio(url);
    currentTtsAudio = audio;

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        if (currentTtsObjectUrl === url) {
          URL.revokeObjectURL(url);
          currentTtsObjectUrl = null;
        }
        if (currentTtsAudio === audio) {
          currentTtsAudio = null;
        }
        resolve();
      };
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(() => cleanup());
    });
  } catch (e) {
    console.warn('[TTS] failed', e);
  } finally {
    useSoundStore.setState({ isPlayingTts: false });
  }
}

export function stopSpeaking(): void {
  if (currentTtsAudio) {
    try { currentTtsAudio.pause(); } catch {}
    currentTtsAudio = null;
  }
  if (currentTtsObjectUrl) {
    try { URL.revokeObjectURL(currentTtsObjectUrl); } catch {}
    currentTtsObjectUrl = null;
  }
  useSoundStore.setState({ isPlayingTts: false });
}
