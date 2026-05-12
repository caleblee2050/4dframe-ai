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

// 펌웨어 (`MechatronicsController.ino`) ↔ Ami5_V01 회로도 매핑 (5/11 PM 회로도 입수):
//   M1 (forwardByte '1') → 방향핀 D8/A0  → LM_A → 앞왼쪽 (Left Front)  → PWM D5
//   M2 (forwardByte '2') → 방향핀 A1/A2  → LM_B → 뒤왼쪽 (Left Back)   → PWM D6
//   M3 (forwardByte '3') → 방향핀 A3/A4  → RM_A → 앞오른쪽 (Right Front)→ PWM D9
//   M4 (forwardByte '4') → 방향핀 D13/A5 → RM_B → 뒤오른쪽 (Right Back) → PWM D10
//
// ⚠ 5/11 PM 이전: M1.pwmPin/M2.pwmPin 이 거꾸로 매핑돼 X 명령 시 PWM 이 엉뚱한 모터로 감.
//   조이스틱 차동 조향이 안 돌던 원인 (좌/우 페어가 앞/뒤 페어로 적용됨).
//   회로도 입수 후 정정.
export const MOTORS: Record<MotorId, MotorConfig> = {
  M1: {
    id: 'M1', labelKr: '앞왼쪽',
    forwardByte: '1', reverseByte: '!', dirToggleSeq: 'F1',
    defaultDir: 1, typicalStartPwmLevel: 3,
    pwmPin: 5, pwmIndex: 0,
  },
  M2: {
    id: 'M2', labelKr: '뒤왼쪽',
    forwardByte: '2', reverseByte: '@', dirToggleSeq: 'F2',
    defaultDir: 1, typicalStartPwmLevel: 3,
    pwmPin: 6, pwmIndex: 1,
  },
  M3: {
    id: 'M3', labelKr: '앞오른쪽',
    forwardByte: '3', reverseByte: '#', dirToggleSeq: 'F3',
    // 회로도 (5/11 PM 입수) 기준 정방향 1. 펌웨어 부팅 default 가 -1 (v1.0 라우팅 잔재) 라
    // webSerial 의 syncMotorDirsToFirmware 가 BOOT 시 F3 토글 1회 송신해 펌웨어를 1 로 맞춤.
    defaultDir: 1, typicalStartPwmLevel: 3,
    pwmPin: 9, pwmIndex: 2,
  },
  M4: {
    id: 'M4', labelKr: '뒤오른쪽',
    forwardByte: '4', reverseByte: '$', dirToggleSeq: 'F4',
    defaultDir: 1, typicalStartPwmLevel: 5,  // 빡빡한 개체 (개체차)
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
//
// 5/11 PM 재설계 — 학생 자연어 "아주 느리게/더 느리게" 단계 적용:
//   아주 느리게   = V1 (절대값)  — 모터가 안 돌 수도 있지만 "초저속 시도" 의 학생 의도 그대로.
//                                 학생이 "안 가네" 깨달으면 "조금 빠르게" 로 올리는 학습 흐름.
//   느리게        = threshold     — 모터가 막 시동 걸리는 최저 속도.
//   보통          = mid(threshold, 9)
//   빠르게        = 8
//   아주 빠르게   = 9 (풀파워)
//
// 예) 시동 V=3 모터 → V1 / V3 / V6 / V8 / V9 (PWM 28/84/168/224/255)
//     시동 V=5 모터 → V1 / V5 / V7 / V8 / V9 (PWM 28/140/196/224/255)
//
// drive (자동차 4모터) 는 maxThreshold 기준 — 한 모터라도 안 돌면 차가 불균형.
// "아주 느리게" 는 maxThreshold 무시하고 V1 그대로 → 학생 직감 우선.
export function speedToLevel(label: SpeedLabel, threshold: number): number {
  const t = Math.max(0, Math.min(9, threshold));
  switch (label) {
    case '아주 느리게': return 1;
    case '느리게':      return t;
    case '보통':        return Math.round((t + 9) / 2);
    case '빠르게':      return 8;
    case '아주 빠르게': return 9;
  }
}

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
// fw 값 미감지 시 v1.3+ 가정 — 모든 사용자 보드는 v1.4.1 플래시 완료 (5/12 PM 기준).
// v1.0 레거시는 BLE 미지원이므로 어차피 USB 연결만 가능 + BOOT 라인 즉시 수신됨.
// 이전 false 기본값은 BOOT 라인 늦게 도착 시 V 명령 skip → 속도 변화 안 보이는 버그 유발.
export function isV13Plus(fw: string | null | undefined): boolean {
  if (!fw) return true;
  const m = fw.match(/^(\d+)\.(\d+)/);
  if (!m) return true;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 3);
}
