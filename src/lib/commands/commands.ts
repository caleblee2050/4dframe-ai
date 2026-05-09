// 펌웨어 어휘 SSoT — src/lib/commands/commands.yaml 과 동일 내용을 TS 로 노출.
// YAML 은 스펙 문서, 이 파일은 런타임 import 대상. 둘은 항상 같이 갱신해야 한다.
//
// 펌웨어: Ami5_V01 / FW1.3 (ThinkGen_Framework 469c5f6 커밋의 .ino)

import type { MotorId, ServoId, SpeedLabel } from '@/lib/dsl/schema';

export const FIRMWARE = {
  boardId: 'Ami5_V01',
  fwVersion: '1.3',
  baud: 115200,
  bootMessage: 'BOOT:Ami5_V01:FW1.3',
} as const;

export interface MotorConfig {
  id: MotorId;
  labelKr: string;
  forwardByte: string;
  reverseByte: string;
  dirToggleSeq: string;     // F1, F2, F3, F4 — 2바이트 시퀀스
  defaultDir: 1 | -1;
  typicalStartPwmLevel: number;
  pwmPin: 5 | 6 | 9 | 10;
  pwmIndex: 0 | 1 | 2 | 3;  // PWM_PINS 배열 인덱스 (X 명령용)
}

export const MOTORS: Record<MotorId, MotorConfig> = {
  M1: {
    id: 'M1', labelKr: '모터 1',
    forwardByte: '1', reverseByte: '!', dirToggleSeq: 'F1',
    defaultDir: 1, typicalStartPwmLevel: 3,
    pwmPin: 6, pwmIndex: 1,
  },
  M2: {
    id: 'M2', labelKr: '모터 2',
    forwardByte: '2', reverseByte: '@', dirToggleSeq: 'F2',
    defaultDir: 1, typicalStartPwmLevel: 3,
    pwmPin: 5, pwmIndex: 0,
  },
  M3: {
    id: 'M3', labelKr: '모터 3',
    forwardByte: '3', reverseByte: '#', dirToggleSeq: 'F3',
    defaultDir: -1, typicalStartPwmLevel: 3,
    pwmPin: 9, pwmIndex: 2,
  },
  M4: {
    id: 'M4', labelKr: '모터 4',
    forwardByte: '4', reverseByte: '$', dirToggleSeq: 'F4',
    defaultDir: 1, typicalStartPwmLevel: 5,  // ⚠ 빡빡한 개체
    pwmPin: 10, pwmIndex: 3,
  },
};

export interface ServoConfig {
  id: ServoId;
  labelKr: string;
  stepUpByte: string;
  stepDownByte: string;
  stepDegrees: 15;
  rangeMin: 0;
  rangeMax: 180;
  defaultPos: 90;
}

export const SERVOS: Record<ServoId, ServoConfig> = {
  SA: { id: 'SA', labelKr: '서보 A', stepUpByte: '%', stepDownByte: '5', stepDegrees: 15, rangeMin: 0, rangeMax: 180, defaultPos: 90 },
  SB: { id: 'SB', labelKr: '서보 B', stepUpByte: '6', stepDownByte: '^', stepDegrees: 15, rangeMin: 0, rangeMax: 180, defaultPos: 90 },
};

export const GLOBAL = {
  stopAll: '0',
  carForward: 'W',
  carBackward: 'S',
  turnLeft: 'A',
  turnRight: 'D',
  diagnostic: '?',
  softReset: '*',
} as const;

// 학생 속도 라벨 → 펌웨어 PWM level (0~9)
// 시동 V (threshold) 기준 균등 배분 — 어른이 /play/test 에서 측정한 시동 V 가 그대로
// /play 의 학생 라벨 매핑에 반영됨 (zustand persist 통해 localStorage 공유).
//
//   천천히 = 시동 V 그대로 (모터가 막 시동 걸리는 최저 속도)
//   빠르게 = 9 (풀파워)
//   보통   = 두 값의 중간 반올림
//
// 예) 시동 V=3 인 모터 → 천천히=V3, 보통=V6, 빠르게=V9 (PWM 84/168/255)
//     시동 V=5 인 모터 → 천천히=V5, 보통=V7, 빠르게=V9 (PWM 140/196/255)
//
// V Sweep (V3/V5/V7/V9) 의 단계차를 학생 모드에서도 명확히 들리게 하는 게 목적.
// floor 클램프 제거로 학생 명시 "천천히" 의도 그대로 적용.
export function speedToLevel(label: SpeedLabel, threshold: number): number {
  const t = Math.max(0, Math.min(9, threshold));
  if (label === '천천히') return t;
  if (label === '빠르게') return 9;
  // 보통
  return Math.round((t + 9) / 2);
}

/** @deprecated speedToLevel 사용. 5/9 D-1 결정으로 floor 클램프 폐기. */
export const SPEED_BASE_LEVEL: Record<SpeedLabel, number> = {
  '천천히': 5,
  '보통':  7,
  '빠르게': 9,
};

// V{level} 시리얼 전송 시퀀스 생성
export function pwmCommand(level: number): string {
  if (level < 0 || level > 9) throw new Error(`PWM level out of range: ${level}`);
  return `V${level}`;
}

// FT232RL — Mac 에서 Web Serial requestPort 필터에 쓰임
export const USB_FILTER = {
  usbVendorId: 0x0403,
  usbProductId: 0x6001,
} as const;

// 보드 펌웨어가 v1.3+ (V/X/F/? 명령 지원) 인지 판정.
// 펌웨어가 BOOT:Ami5_V01:FW1.3 또는 ? 진단 응답으로 FW 채워줌.
// fw 값 미감지 시 v1.0 가정 (보수적 호환 모드).
export function isV13Plus(fw: string | null | undefined): boolean {
  if (!fw) return false;
  const m = fw.match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 3);
}
