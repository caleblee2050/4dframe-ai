'use client';

// 손 모양 ↔ 보드 명령 매핑 — 학생이 직접 지정 가능 (고급).
// localStorage persist. v2: 손가락 개수 0~5 = 6 슬롯.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type GestureKey =
  | 'finger_0'   // ✊ 주먹
  | 'finger_1'   // ☝️ 검지 1
  | 'finger_2'   // ✌️ V 자 2
  | 'finger_3'   // 🤟 3
  | 'finger_4'   // 🖖 4
  | 'finger_5';  // 🖐 활짝 5

export const GESTURE_LABELS: Record<GestureKey, { emoji: string; label: string }> = {
  finger_0: { emoji: '✊', label: '주먹 (0개)' },
  finger_1: { emoji: '☝️', label: '검지 (1개)' },
  finger_2: { emoji: '✌️', label: '브이 (2개)' },
  finger_3: { emoji: '🤟', label: '3개' },
  finger_4: { emoji: '🖖', label: '4개' },
  finger_5: { emoji: '🖐', label: '활짝 (5개)' },
};

export type ActionId =
  | 'forward'        // 모든 모터 전진 (V6 + W)
  | 'backward'       // 모든 모터 후진 (V6 + S)
  | 'left'           // 좌회전 (V6 + A)
  | 'right'          // 우회전 (V6 + D)
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
  bytes: string;
}

export const ACTIONS: ActionDef[] = [
  { id: 'noop',          label: '아무 것도 안 함', emoji: '⭕', bytes: '' },
  { id: 'stop',          label: '정지',         emoji: '⏹', bytes: '0' },
  { id: 'slow_forward',  label: '천천히 앞으로', emoji: '🐢', bytes: 'V3W' },
  { id: 'forward',       label: '앞으로',       emoji: '⬆️', bytes: 'V6W' },
  { id: 'fast_forward',  label: '빠르게 앞으로', emoji: '🚀', bytes: 'V9W' },
  { id: 'backward',      label: '뒤로',         emoji: '⬇️', bytes: 'V6S' },
  { id: 'left',          label: '왼쪽 회전',     emoji: '⬅️', bytes: 'V6A' },
  { id: 'right',         label: '오른쪽 회전',   emoji: '➡️', bytes: 'V6D' },
  { id: 'servo_a_open',  label: '입 벌리기',     emoji: '😮', bytes: '%%%' },
  { id: 'servo_a_close', label: '입 다물기',     emoji: '🤐', bytes: '555' },
  { id: 'servo_b_open',  label: '꼬리 위',      emoji: '🔺', bytes: '666' },
  { id: 'servo_b_close', label: '꼬리 아래',     emoji: '🔻', bytes: '^^^' },
];

interface GestureMappingState {
  mapping: Record<GestureKey, ActionId>;
  setMapping: (g: GestureKey, a: ActionId) => void;
  reset: () => void;
}

// 기본 매핑 — 학생이 안 바꿔도 즉시 자연스러운 동작.
// 손가락 N 개 = 단계, 주먹/활짝 = 정지/빠르게.
const DEFAULT_MAPPING: Record<GestureKey, ActionId> = {
  finger_0: 'stop',           // 주먹 = 정지
  finger_1: 'slow_forward',   // 1개 = 천천히
  finger_2: 'forward',        // 2개 = 보통
  finger_3: 'fast_forward',   // 3개 = 빠르게
  finger_4: 'backward',       // 4개 = 뒤로
  finger_5: 'servo_a_open',   // 활짝 = 입 벌리기 (악어용 default)
};

export const useGestureMappingStore = create<GestureMappingState>()(
  persist(
    (set) => ({
      mapping: DEFAULT_MAPPING,
      setMapping: (g, a) => set((s) => ({ mapping: { ...s.mapping, [g]: a } })),
      reset: () => set({ mapping: DEFAULT_MAPPING }),
    }),
    {
      name: '4dframe-gesture-mapping',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: () => ({ mapping: DEFAULT_MAPPING }),
    }
  )
);

export function actionById(id: ActionId): ActionDef {
  return ACTIONS.find((a) => a.id === id) ?? ACTIONS[0];
}

export function fingerCountToKey(n: number): GestureKey | null {
  if (n < 0 || n > 5) return null;
  return (`finger_${n}`) as GestureKey;
}
