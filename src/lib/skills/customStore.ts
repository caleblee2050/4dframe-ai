'use client';

// 사용자가 직접 저장한 커스텀 스킬 — Turso libsql (서버 영구 저장).
// 모든 PC/브라우저 공유 (단일 테넌트, 로그인 v2 에서 추가).
// 페이지 mount 시 fetch /api/skills → state 초기화. add/remove/toggle 즉시 서버 sync.

import { create } from 'zustand';
import type { Program, Step } from '@/lib/dsl/schema';

// save_skill step 을 program 에서 제거 (재귀 — repeat 안까지).
// customSkill 로 저장될 때 자기 자신을 저장하는 무한 루프 방지.
function stripSaveSkill(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    if (s.do === 'save_skill') continue;
    if (s.do === 'repeat') {
      out.push({ ...s, steps: stripSaveSkill(s.steps) });
    } else {
      out.push(s);
    }
  }
  return out;
}

function sanitizeProgramForSave(p: Program): Program {
  return { ...p, steps: stripSaveSkill(p.steps) };
}

type Artwork = NonNullable<Program['artwork']>;

export interface CustomSkill {
  id: string;             // crypto.randomUUID()
  artwork: Artwork;
  label: string;          // 학생이 붙인 이름 (1~16자)
  emoji: string;          // 1글자 이모지
  description?: string;
  program: Program;
  createdAt: number;
  // 쉬운 모드에서 칩으로 노출할지. false (default) = 노출, true = 숨김.
  // 작품당 노출은 최대 3개. 4개 이상 저장 시 설정에서 교체 가능.
  simpleHidden?: boolean;
}

interface CustomSkillsState {
  skills: CustomSkill[];
  // 코드에 박힌 built-in 스킬 (viking_swing 등) 중 사용자가 쉬운 모드에서 숨긴 ID 들.
  // DB hidden_builtin 테이블과 동기화. customSkill.simpleHidden 과 같은 역할, built-in 용.
  hiddenBuiltinIds: string[];
  loaded: boolean;          // 서버에서 한 번 fetch 했는지
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
  add: (s: Omit<CustomSkill, 'id' | 'createdAt'>) => Promise<CustomSkill | null>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, label: string) => Promise<void>;
  toggleSimpleHidden: (id: string) => Promise<void>;
  toggleBuiltinHidden: (builtinId: string) => Promise<void>;
  clear: () => void;
}

// 서버 응답 형식 (Turso row → camelCase)
interface ServerSkill {
  id: string;
  artwork: string;
  label: string;
  emoji: string;
  description: string | null;
  program: Program;
  createdAt: number;
  simpleHidden: boolean;
}

function fromServer(s: ServerSkill): CustomSkill {
  return {
    id: s.id,
    artwork: s.artwork as Artwork,
    label: s.label,
    emoji: s.emoji,
    description: s.description ?? undefined,
    program: s.program,
    createdAt: s.createdAt,
    simpleHidden: s.simpleHidden,
  };
}

export const useCustomSkillsStore = create<CustomSkillsState>()((set, get) => ({
  skills: [],
  hiddenBuiltinIds: [],
  loaded: false,
  loading: false,
  error: null,

  fetch: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const data = await res.json() as { skills: ServerSkill[]; hiddenBuiltinIds?: string[] };
      set({
        skills: data.skills.map(fromServer),
        hiddenBuiltinIds: data.hiddenBuiltinIds ?? [],
        loaded: true,
        loading: false,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  add: async (s) => {
    const cleanProgram = sanitizeProgramForSave(s.program);
    if (cleanProgram.steps.length === 0) {
      set({ error: '저장할 동작이 없어요. 먼저 동작을 만들어보세요!' });
      return null;
    }
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artwork: s.artwork,
          label: s.label,
          emoji: s.emoji,
          description: s.description,
          program: cleanProgram,
        }),
      });
      if (!res.ok) throw new Error(`add ${res.status}`);
      const data = await res.json() as { skill: ServerSkill };
      const newSkill = fromServer(data.skill);
      set((state) => ({ skills: [newSkill, ...state.skills] }));
      return newSkill;
    } catch (e) {
      console.error('[customStore.add]', e);
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  remove: async (id) => {
    // 낙관적 업데이트
    const prev = get().skills;
    set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }));
    try {
      const res = await fetch(`/api/skills/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`remove ${res.status}`);
    } catch (e) {
      // 롤백
      set({ skills: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  rename: async (id, label) => {
    const trimmed = label.trim().slice(0, 16);
    if (trimmed.length === 0) return;
    const prev = get().skills;
    // 낙관적 업데이트
    set((state) => ({
      skills: state.skills.map((s) => s.id === id ? { ...s, label: trimmed } : s),
    }));
    try {
      const res = await fetch(`/api/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) throw new Error(`rename ${res.status}`);
    } catch (e) {
      set({ skills: prev, error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleSimpleHidden: async (id) => {
    const skill = get().skills.find((s) => s.id === id);
    if (!skill) return;
    const next = !skill.simpleHidden;
    // 낙관적 업데이트
    set((state) => ({
      skills: state.skills.map((s) => s.id === id ? { ...s, simpleHidden: next } : s),
    }));
    try {
      const res = await fetch(`/api/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simpleHidden: next }),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
    } catch (e) {
      // 롤백
      set((state) => ({
        skills: state.skills.map((s) => s.id === id ? { ...s, simpleHidden: !next } : s),
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  },

  toggleBuiltinHidden: async (builtinId) => {
    const current = get().hiddenBuiltinIds;
    const isHidden = current.includes(builtinId);
    const next = isHidden ? current.filter((x) => x !== builtinId) : [...current, builtinId];
    // 낙관적 업데이트
    set({ hiddenBuiltinIds: next });
    try {
      const res = isHidden
        ? await fetch(`/api/builtin-hidden/${encodeURIComponent(builtinId)}`, { method: 'DELETE' })
        : await fetch('/api/builtin-hidden', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: builtinId }),
          });
      if (!res.ok) throw new Error(`builtin-hidden ${res.status}`);
    } catch (e) {
      // 롤백
      set({ hiddenBuiltinIds: current, error: e instanceof Error ? e.message : String(e) });
    }
  },

  clear: () => set({ skills: [], hiddenBuiltinIds: [] }),
}));

export function customSkillsForArtwork(artwork: Artwork | undefined): CustomSkill[] {
  if (!artwork) return [];
  if (typeof window === 'undefined') return [];
  return useCustomSkillsStore.getState().skills.filter((s) => s.artwork === artwork);
}
