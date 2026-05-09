'use client';

// 보드별 모터 캘리브레이션 — 펌웨어를 손대지 않고 학생 개체차를 흡수.
// localStorage 영속. 각 보드 ID(BOOT 메시지에서 받은 board_id) 별로 분리 저장.
//
// 두 가지를 저장:
//  1. startThreshold[Mn]: 0~9 — 그 모터가 실제로 시동 걸리는 V level
//  2. dirOverride[Mn]: 1 | -1 — 학생이 F1~F4 토글로 정한 방향
//
// 인터프리터가 SpeedLabel('천천히/보통/빠르게') → V level 변환:
//   commands.ts:speedToLevel 가 시동 V (threshold) 기준 균등 배분.
//   천천히 = threshold (시동 V 그대로), 빠르게 = 9, 보통 = 중간.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MotorId, SpeedLabel } from '@/lib/dsl/schema';
import { MOTORS, speedToLevel } from '@/lib/commands/commands';

export interface BoardCalibration {
  boardId: string;        // 예: Ami5_V01:<usbProductId>:<usbVendorId> (현실적으로 1보드만 가정)
  startThreshold: Record<MotorId, number>;   // 0~9
  dirOverride: Record<MotorId, 1 | -1>;
  measuredAt: number | null;
}

interface CalibrationState {
  // 단일 보드만 가정 (학생 1명 기준). 복수 보드는 5/10 후.
  current: BoardCalibration;
  setStartThreshold: (motor: MotorId, level: number) => void;
  toggleDir: (motor: MotorId) => void;
  setMeasured: () => void;
  reset: () => void;
}

const initial: BoardCalibration = {
  boardId: 'Ami5_V01',
  startThreshold: {
    M1: MOTORS.M1.typicalStartPwmLevel,
    M2: MOTORS.M2.typicalStartPwmLevel,
    M3: MOTORS.M3.typicalStartPwmLevel,
    M4: MOTORS.M4.typicalStartPwmLevel,
  },
  dirOverride: {
    M1: MOTORS.M1.defaultDir,
    M2: MOTORS.M2.defaultDir,
    M3: MOTORS.M3.defaultDir,
    M4: MOTORS.M4.defaultDir,
  },
  measuredAt: null,
};

export const useCalibrationStore = create<CalibrationState>()(
  persist(
    (set) => ({
      current: initial,
      setStartThreshold: (motor, level) => set((s) => ({
        current: {
          ...s.current,
          startThreshold: { ...s.current.startThreshold, [motor]: Math.max(0, Math.min(9, level)) },
        },
      })),
      toggleDir: (motor) => set((s) => {
        const next = (s.current.dirOverride[motor] === 1 ? -1 : 1) as 1 | -1;
        return {
          current: {
            ...s.current,
            dirOverride: { ...s.current.dirOverride, [motor]: next },
          },
        };
      }),
      setMeasured: () => set((s) => ({
        current: { ...s.current, measuredAt: Date.now() },
      })),
      reset: () => set({ current: initial }),
    }),
    {
      name: '4dframe-calibration',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);

// 학생 SpeedLabel + 모터 → 보드 시동 V 기반 V level (0~9)
// commands.ts:speedToLevel 가 핵심. 이 함수는 store 의 threshold 와 연결만.
// floor 클램프 (max(base, threshold+1)) 제거 — 학생 "천천히" 의도가 V9 로 끌려가
// 자연어 모드에서 단계차가 안 들리던 문제 해결 (5/9 D-1 결정).
export function calibratedPwmLevel(
  motor: MotorId,
  label: SpeedLabel,
  threshold: Record<MotorId, number>
): number {
  return speedToLevel(label, threshold[motor]);
}
