'use client';

// 손 동작 ↔ 보드 명령 매핑 — 학생이 직접 지정.
// localStorage persist. v1: 두 손 모양 (활짝/주먹) 만. 추후 더 많은 제스처 추가 가능.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type GestureKey = 'hand_open' | 'hand_fist';   // 활짝 / 주먹
export type ActionId =
  | 'forward'        // 모든 모터 전진 (W)
  | 'backward'       // 모든 모터 후진 (S)
  | 'left'           // 좌회전 (A)
  | 'right'          // 우회전 (D)
  | 'fast_forward'   // V9 + W
  | 'slow_forward'   // V3 + W
  | 'stop'           // 전체 정지 (0)
  | 'servo_a_open'   // 입 벌리기 (% × 3)
  | 'servo_a_close'  // 입 다물기 (5 × 3)
  | 'servo_b_open'   // 꼬리 위 (6 × 3)
  | 'servo_b_close'  // 꼬리 아래 (^ × 3)
  | 'noop';          // 아무 것도 안 함

export interface ActionDef {
  id: ActionId;
  label: string;
  emoji: string;
  /** 보드에 송신할 바이트 시퀀스 (펌웨어 어휘) */
  bytes: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'forward',       label: '앞으로',     emoji: '⬆️', bytes: 'V6W' },
  { id: 'fast_forward',  label: '빠르게 앞으로', emoji: '🚀', bytes: 'V9W' },
  { id: 'slow_forward',  label: '천천히 앞으로', emoji: '🐢', bytes: 'V3W' },
  { id: 'backward',      label: '뒤로',       emoji: '⬇️', bytes: 'V6S' },
  { id: 'left',          label: '왼쪽 회전',   emoji: '⬅️', bytes: 'V6A' },
  { id: 'right',         label: '오른쪽 회전', emoji: '➡️', bytes: 'V6D' },
  { id: 'stop',          label: '정지',       emoji: '⏹', bytes: '0' },
  { id: 'servo_a_open',  label: '입 벌리기',   emoji: '😮', bytes: '%%%' },
  { id: 'servo_a_close', label: '입 다물기',   emoji: '🤐', bytes: '555' },
  { id: 'servo_b_open',  label: '꼬리 위',    emoji: '🔺', bytes: '666' },
  { id: 'servo_b_close', label: '꼬리 아래',   emoji: '🔻', bytes: '^^^' },
  { id: 'noop',          label: '아무 것도 안 함', emoji: '⭕', bytes: '' },
];

interface GestureMappingState {
  mapping: Record<GestureKey, ActionId>;
  setMapping: (g: GestureKey, a: ActionId) => void;
  reset: () => void;
}

const DEFAULT: Record<GestureKey, ActionId> = {
  hand_open: 'fast_forward',
  hand_fist: 'stop',
};

export const useGestureMappingStore = create<GestureMappingState>()(
  persist(
    (set) => ({
      mapping: DEFAULT,
      setMapping: (g, a) => set((s) => ({ mapping: { ...s.mapping, [g]: a } })),
      reset: () => set({ mapping: DEFAULT }),
    }),
    {
      name: '4dframe-gesture-mapping',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

export function actionById(id: ActionId): ActionDef {
  return ACTIONS.find((a) => a.id === id) ?? ACTIONS[ACTIONS.length - 1];
}
