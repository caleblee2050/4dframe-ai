// 4DFrame AI — JSON DSL v0
//
// 학생의 자연어를 AI가 받아서 펌웨어 명령으로 가는 중간 표현(IR).
// 핵심 원칙:
//   1. AI는 절대 Python/JS 코드를 생성하지 않는다. JSON만 생성한다.
//   2. 인터프리터(src/lib/dsl/interpreter.ts)는 이 JSON만 받아서
//      commands.yaml의 어휘로 펌웨어에 시리얼 바이트를 보낸다.
//   3. AI가 만든 JSON이 schema에 맞지 않으면 거부한다 — eval 안 함.
//
// 펌웨어 어휘는 src/lib/commands/commands.yaml 가 SSoT.

// ─────────────────────────────────────────────────────────────
// 액추에이터 식별자
// ─────────────────────────────────────────────────────────────
export type MotorId = 'M1' | 'M2' | 'M3' | 'M4';
export type ServoId = 'SA' | 'SB';
export type SpeedLabel = '천천히' | '보통' | '빠르게';
export type Direction = 'forward' | 'reverse';

// ─────────────────────────────────────────────────────────────
// 스텝 (한 동작 단위)
// ─────────────────────────────────────────────────────────────

// 모든 step 공통 — 학생이 코드 카드를 보면서 "이 줄이 왜 있는지" 이해하도록.
// AI 가 step 마다 1줄 한국어로 채움. 학생 어휘, 30자 이내 권장.
export interface BaseStep {
  hint?: string;
}

// 모터를 한 방향으로 돌리기. duration_ms 없으면 다음 step 또는 stop_all 까지 계속.
export interface SpinStep extends BaseStep {
  do: 'spin';
  motor: MotorId;
  speed: SpeedLabel;        // 학생 어휘. 인터프리터가 보드 캘리브레이션으로 V_n 변환.
  direction?: Direction;    // 기본 forward
  duration_ms?: number;     // 1~30000
}

// 4WD 자동차 이동 (W/A/S/D 매크로 활용)
export interface DriveStep extends BaseStep {
  do: 'drive';
  heading: 'forward' | 'backward' | 'turn_left' | 'turn_right';
  speed: SpeedLabel;
  duration_ms?: number;
}

// 서보 각도 조절. 절대 각도 또는 상대 스텝(±15도 단위).
export interface ServoStep extends BaseStep {
  do: 'servo';
  servo: ServoId;
  // 둘 중 하나만:
  to_degrees?: number;      // 0~180 절대
  step?: number;            // ±1, ±2 ... (펌웨어가 ±15도 단위로 처리)
}

// 글로벌 속도 변경. 다음 spin/drive에 적용.
export interface SpeedStep extends BaseStep {
  do: 'speed';
  level: SpeedLabel;
}

// 정지
export interface StopStep extends BaseStep {
  do: 'stop';
  scope?: 'all' | MotorId;  // 기본 'all'
}

// 일정 시간 대기
export interface WaitStep extends BaseStep {
  do: 'wait';
  ms: number;               // 1~30000
}

// 거리 센서 값이 임계값보다 작아질 때까지 대기 (예: "장애물 만나면")
export interface WaitForDistanceStep extends BaseStep {
  do: 'wait_for_distance';
  cm_below: number;         // 1~200
  timeout_ms?: number;      // 기본 10000
}

// 반복 (단순한 N회 반복만 — 임의의 while/if 는 의도적으로 제외)
export interface RepeatStep extends BaseStep {
  do: 'repeat';
  times: number;            // 1~50
  steps: Step[];
}

// AI가 학생에게 친절히 한마디 (왜 이렇게 동작하는지 설명).
// 인터프리터가 speech-bubble UI에 표시. 펌웨어로는 안 나간다.
export interface SayStep extends BaseStep {
  do: 'say';
  text: string;             // 한국어 한 문장 권장. 1~140자.
}

// 학생 보드의 어떤 모터가 안 돌면 캘리브레이션 위저드 호출.
// AI가 "제어가 안 먹힐 수 있다"고 판단할 때 선제적으로 emit.
export interface CalibrateStep extends BaseStep {
  do: 'calibrate';
  reason: 'motor_individual_variance' | 'motor_direction_mirror' | 'servo_power';
}

// 정적 효과음 라이브러리에서 한 개 재생. 클라이언트 Web Audio API 로 재생.
// 펌웨어로 안 나감.
export type SoundEffectId =
  | 'cheer'         // 박수/환호
  | 'engine_start'  // 자동차 시동
  | 'engine_run'    // 자동차 주행 루프
  | 'creak'         // 바이킹 삐걱
  | 'splash'        // 물 첨벙
  | 'whoosh'        // 휙 (회전, 빠른 움직임)
  | 'crocodile'     // 악어 으르렁
  | 'beep'          // 알림음
  | 'ding'          // 띵 (성공)
  | 'wobble'        // 진동 떨림
  ;

export interface PlaySoundStep extends BaseStep {
  do: 'play_sound';
  sound: SoundEffectId;
  // 선택적 볼륨 (0.0~1.0). 기본 1.0.
  volume?: number;
}

export type Step =
  | SpinStep
  | DriveStep
  | ServoStep
  | SpeedStep
  | StopStep
  | WaitStep
  | WaitForDistanceStep
  | RepeatStep
  | SayStep
  | CalibrateStep
  | PlaySoundStep;

// ─────────────────────────────────────────────────────────────
// 프로그램 (AI가 한 번에 뱉는 단위)
// ─────────────────────────────────────────────────────────────
export interface Program {
  schema_version: 1;
  // 학생이 선택한 작품 (commands.yaml artwork_aliases 키). 모터 알리아스 해석에 쓰임.
  artwork?: 'viking' | 'car_4wd' | 'swing' | 'crocodile' | 'free';
  // AI가 학생에게 거는 첫 한 문장. SayStep 도 사용 가능. 둘 다 옵셔널.
  intro?: string;
  // 코드. **0개도 허용** — AI 가 코드 안 만들고 질문만 할 때 사용 (대화형 세션).
  steps: Step[];
  // "오늘 배운 것" — 코딩 개념/동작 원리/변형 제안 등 1~3개. 학생용 한 문장 (40자 이내 권장).
  // 실행 후 별도 카드로 표시되어 학습 정리.
  learning_points?: string[];
  // 학생에게 던지는 후속 질문. 1~3개. AI 가 학생 의도를 더 알고 싶거나
  // 더 멋진 결과를 위해 함께 결정하고 싶을 때 사용.
  // 예: "어떻게 흔들면 좋을까? 점점 빠르게? 똑같이?"
  questions?: string[];
  // 학생이 클릭만 하면 다음 입력으로 들어가는 짧은 제안 (12자 이내 권장). 1~5개.
  // 학부모-아이가 함께 보면서 "이거 해볼까?" 결정 가능.
  // 예: ["더 빨리", "반대로", "10번 반복"]
  variation_chips?: string[];
}

// ─────────────────────────────────────────────────────────────
// 검증 — 인터프리터 진입 직전 항상 통과해야 함
// ─────────────────────────────────────────────────────────────
export class DslValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`[${path}] ${message}`);
  }
}

const SPEED_LABELS: SpeedLabel[] = ['천천히', '보통', '빠르게'];
const MOTOR_IDS: MotorId[] = ['M1', 'M2', 'M3', 'M4'];
const SERVO_IDS: ServoId[] = ['SA', 'SB'];

function assertInRange(path: string, value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new DslValidationError(path, `${value} 는 [${min}, ${max}] 범위 밖`);
  }
}

function validateStep(step: Step, path: string): void {
  // 모든 step 공통: hint (선택)
  if (step.hint !== undefined && (typeof step.hint !== 'string' || step.hint.length > 100)) {
    throw new DslValidationError(`${path}.hint`, 'hint 는 0~100자 문자열');
  }
  switch (step.do) {
    case 'spin':
      if (!MOTOR_IDS.includes(step.motor)) throw new DslValidationError(`${path}.motor`, `잘못된 모터: ${step.motor}`);
      if (!SPEED_LABELS.includes(step.speed)) throw new DslValidationError(`${path}.speed`, `잘못된 속도: ${step.speed}`);
      if (step.direction && step.direction !== 'forward' && step.direction !== 'reverse')
        throw new DslValidationError(`${path}.direction`, `잘못된 방향: ${step.direction}`);
      if (step.duration_ms !== undefined) assertInRange(`${path}.duration_ms`, step.duration_ms, 1, 30000);
      return;
    case 'drive':
      if (!['forward','backward','turn_left','turn_right'].includes(step.heading))
        throw new DslValidationError(`${path}.heading`, `잘못된 heading: ${step.heading}`);
      if (!SPEED_LABELS.includes(step.speed)) throw new DslValidationError(`${path}.speed`, `잘못된 속도`);
      if (step.duration_ms !== undefined) assertInRange(`${path}.duration_ms`, step.duration_ms, 1, 30000);
      return;
    case 'servo':
      if (!SERVO_IDS.includes(step.servo)) throw new DslValidationError(`${path}.servo`, `잘못된 서보`);
      if (step.to_degrees === undefined && step.step === undefined)
        throw new DslValidationError(path, 'servo step 은 to_degrees 또는 step 중 하나 필요');
      if (step.to_degrees !== undefined && step.step !== undefined)
        throw new DslValidationError(path, 'servo step 은 to_degrees 와 step 동시 사용 불가');
      if (step.to_degrees !== undefined) assertInRange(`${path}.to_degrees`, step.to_degrees, 0, 180);
      if (step.step !== undefined) assertInRange(`${path}.step`, step.step, -12, 12);
      return;
    case 'speed':
      if (!SPEED_LABELS.includes(step.level)) throw new DslValidationError(`${path}.level`, `잘못된 level`);
      return;
    case 'stop':
      if (step.scope && step.scope !== 'all' && !MOTOR_IDS.includes(step.scope as MotorId))
        throw new DslValidationError(`${path}.scope`, `잘못된 scope`);
      return;
    case 'wait':
      assertInRange(`${path}.ms`, step.ms, 1, 30000);
      return;
    case 'wait_for_distance':
      assertInRange(`${path}.cm_below`, step.cm_below, 1, 200);
      if (step.timeout_ms !== undefined) assertInRange(`${path}.timeout_ms`, step.timeout_ms, 100, 60000);
      return;
    case 'repeat':
      assertInRange(`${path}.times`, step.times, 1, 50);
      if (!Array.isArray(step.steps) || step.steps.length === 0)
        throw new DslValidationError(`${path}.steps`, 'repeat 은 비어있는 steps 불가');
      step.steps.forEach((s, i) => validateStep(s, `${path}.steps[${i}]`));
      return;
    case 'say':
      if (typeof step.text !== 'string' || step.text.length < 1 || step.text.length > 140)
        throw new DslValidationError(`${path}.text`, 'say.text 는 1~140자');
      return;
    case 'calibrate':
      if (!['motor_individual_variance','motor_direction_mirror','servo_power'].includes(step.reason))
        throw new DslValidationError(`${path}.reason`, '잘못된 reason');
      return;
    case 'play_sound':
      if (!['cheer','engine_start','engine_run','creak','splash','whoosh','crocodile','beep','ding','wobble'].includes(step.sound))
        throw new DslValidationError(`${path}.sound`, `잘못된 sound: ${step.sound}`);
      if (step.volume !== undefined) assertInRange(`${path}.volume`, step.volume, 0, 1);
      return;
    default: {
      const exhaustive: never = step;
      throw new DslValidationError(path, `알 수 없는 step.do: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function validateProgram(input: unknown): Program {
  if (typeof input !== 'object' || input === null) {
    throw new DslValidationError('$', 'Program 은 object 여야 함');
  }
  const p = input as Record<string, unknown>;
  if (p.schema_version !== 1) {
    throw new DslValidationError('$.schema_version', `지원 버전 1 필요, got ${p.schema_version}`);
  }
  if (!Array.isArray(p.steps)) {
    throw new DslValidationError('$.steps', 'steps 는 배열');
  }
  // 0 허용 — 대화형 모드: AI 가 코드 없이 질문만 응답할 수 있음.
  if (p.steps.length > 200) {
    throw new DslValidationError('$.steps', `steps 길이 0~200, got ${p.steps.length}`);
  }
  if (p.artwork !== undefined && !['viking','car_4wd','swing','crocodile','free'].includes(p.artwork as string)) {
    throw new DslValidationError('$.artwork', `잘못된 artwork: ${p.artwork}`);
  }
  if (p.intro !== undefined && (typeof p.intro !== 'string' || p.intro.length > 280)) {
    throw new DslValidationError('$.intro', 'intro 는 0~280자 문자열');
  }
  if (p.learning_points !== undefined) {
    if (!Array.isArray(p.learning_points)) {
      throw new DslValidationError('$.learning_points', '배열이어야 함');
    }
    if (p.learning_points.length > 5) {
      throw new DslValidationError('$.learning_points', '최대 5개');
    }
    p.learning_points.forEach((lp, i) => {
      if (typeof lp !== 'string' || lp.length === 0 || lp.length > 120) {
        throw new DslValidationError(`$.learning_points[${i}]`, '1~120자 문자열');
      }
    });
  }
  if (p.questions !== undefined) {
    if (!Array.isArray(p.questions)) throw new DslValidationError('$.questions', '배열');
    if (p.questions.length > 5) throw new DslValidationError('$.questions', '최대 5개');
    p.questions.forEach((q, i) => {
      if (typeof q !== 'string' || q.length === 0 || q.length > 100)
        throw new DslValidationError(`$.questions[${i}]`, '1~100자');
    });
  }
  if (p.variation_chips !== undefined) {
    if (!Array.isArray(p.variation_chips)) throw new DslValidationError('$.variation_chips', '배열');
    if (p.variation_chips.length > 8) throw new DslValidationError('$.variation_chips', '최대 8개');
    p.variation_chips.forEach((c, i) => {
      if (typeof c !== 'string' || c.length === 0 || c.length > 30)
        throw new DslValidationError(`$.variation_chips[${i}]`, '1~30자');
    });
  }
  (p.steps as Step[]).forEach((s, i) => validateStep(s, `$.steps[${i}]`));
  return p as unknown as Program;
}
