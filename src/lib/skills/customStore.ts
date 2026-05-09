'use client';

// 사용자가 직접 저장한 커스텀 스킬 — localStorage persist.
// v1: 단일 사용자 (로그인 X). 추후 유료 + 로그인 시 서버 동기화 진입점.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Program } from '@/lib/dsl/schema';

type Artwork = NonNullable<Program['artwork']>;

export interface CustomSkill {
  id: string;             // crypto.randomUUID()
  artwork: Artwork;
  label: string;          // 학생이 붙인 이름 (1~16자)
  emoji: string;          // 1글자 이모지
  description?: string;
  program: Program;
  createdAt: number;
}

interface CustomSkillsState {
  skills: CustomSkill[];
  add: (s: Omit<CustomSkill, 'id' | 'createdAt'>) => CustomSkill;
  remove: (id: string) => void;
  clear: () => void;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useCustomSkillsStore = create<CustomSkillsState>()(
  persist(
    (set) => ({
      skills: [],
      add: (s) => {
        const skill: CustomSkill = { ...s, id: genId(), createdAt: Date.now() };
        set((state) => ({ skills: [skill, ...state.skills].slice(0, 30) }));   // 최대 30개
        return skill;
      },
      remove: (id) => set((state) => ({ skills: state.skills.filter((s) => s.id !== id) })),
      clear: () => set({ skills: [] }),
    }),
    {
      name: '4dframe-custom-skills',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

export function customSkillsForArtwork(artwork: Artwork | undefined): CustomSkill[] {
  if (!artwork) return [];
  if (typeof window === 'undefined') return [];
  return useCustomSkillsStore.getState().skills.filter((s) => s.artwork === artwork);
}
