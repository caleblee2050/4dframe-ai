// JSON DSL 인터프리터 — Program 을 펌웨어 시리얼 명령 시퀀스로 실행.
//
// 핵심 책임:
//   1. validateProgram() 통과한 Program 만 받는다 (호출자 보장).
//   2. 학생 SpeedLabel 을 보드 캘리브레이션으로 V level 보정.
//   3. say/calibrate step 은 펌웨어로 안 가고 onEvent 콜백으로 호출자에게 전달.
//   4. 중간에 abort 가능 (학생이 정지 누르면).
//
// 펌웨어는 단일 바이트 슬레이브이므로 본 인터프리터가 시간 의존 시퀀싱을 책임진다.

import type {
  Program, Step, MotorId, SpeedLabel,
  SpinStep, DriveStep, ServoStep, SpeedStep, StopStep, WaitStep,
  WaitForDistanceStep, RepeatStep, SayStep, CalibrateStep, PlaySoundStep, PlayTuneStep,
} from './schema';
import {
  MOTORS, SERVOS, GLOBAL, SPEED_BASE_LEVEL, pwmCommand,
} from '@/lib/commands/commands';
import { calibratedPwmLevel, useCalibrationStore } from '@/lib/calibration/store';
import { useBoardStore } from '@/lib/serial/webSerial';

export type InterpreterEvent =
  | { type: 'say'; text: string }
  | { type: 'calibrate'; reason: CalibrateStep['reason'] }
  | { type: 'play_sound'; sound: PlaySoundStep['sound']; volume: number }
  | { type: 'play_tune'; tune: PlayTuneStep['tune']; tempo: number; await_melody: boolean }
  | { type: 'step_start'; step: Step; index: number }
  | { type: 'step_end'; step: Step; index: number }
  | { type: 'aborted' }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface RunOptions {
  signal?: AbortSignal;
  // void 또는 Promise — Promise 리턴 시 인터프리터가 await 한다.
  // say 이벤트에 Promise 리턴하면 "음성 끝까지 기다린 후 다음 step" 흐름.
  onEvent?: (e: InterpreterEvent) => void | Promise<void>;
  // 테스트 시 send/대기 함수를 주입할 수 있도록 (기본은 useBoardStore)
  send?: (payload: string) => Promise<void>;
  delay?: (ms: number) => Promise<void>;
  readDistanceCm?: () => number | null;
}

export async function runProgram(program: Program, opts: RunOptions = {}): Promise<void> {
  const send = opts.send ?? ((p: string) => useBoardStore.getState().send(p));
  const delay = opts.delay ?? defaultDelay;
  const readDistance = opts.readDistanceCm ?? (() => useBoardStore.getState().lastDistanceCm);
  const signal = opts.signal;
  // emit 가 Promise 를 리턴하면 인터프리터가 await — say step 의 음성 종료 대기에 사용.
  const emit: (e: InterpreterEvent) => void | Promise<void> = opts.onEvent ?? (() => {});

  // intro 자동 emit 제거 — page.tsx 가 onExecute 시작 시 별도로 await speakText(intro) 처리.
  // (이중 재생 방지)

  // 인터프리터 로컬 상태 — speed step 만으로 다음 spin/drive 의 기본 속도가 바뀜
  let currentSpeed: SpeedLabel | null = null;

  const runSteps = async (steps: Step[], pathPrefix: string) => {
    for (let i = 0; i < steps.length; i++) {
      if (signal?.aborted) {
        await emit({ type: 'aborted' });
        await safeStop(send);
        return;
      }
      const step = steps[i];
      await emit({ type: 'step_start', step, index: i });
      try {
        await executeStep(step, {
          getSpeed: () => currentSpeed,
          setSpeed: (s) => { currentSpeed = s; },
          send, delay, readDistance, emit, signal,
          runSubSteps: (sub, prefix) => runSteps(sub, prefix),
        }, `${pathPrefix}[${i}]`);
      } catch (e) {
        await emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        await safeStop(send);
        return;
      }
      await emit({ type: 'step_end', step, index: i });
    }
  };

  await runSteps(program.steps, '$');
  await emit({ type: 'done' });
}

interface StepCtx {
  getSpeed: () => SpeedLabel | null;
  setSpeed: (s: SpeedLabel) => void;
  send: (payload: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  readDistance: () => number | null;
  // Promise 리턴 시 인터프리터가 await — say step 음성 종료 대기에 사용.
  emit: (e: InterpreterEvent) => void | Promise<void>;
  signal?: AbortSignal;
  runSubSteps: (steps: Step[], path: string) => Promise<void>;
}

async function executeStep(step: Step, ctx: StepCtx, path: string): Promise<void> {
  switch (step.do) {
    case 'spin':
      return execSpin(step, ctx);
    case 'drive':
      return execDrive(step, ctx);
    case 'servo':
      return execServo(step, ctx);
    case 'speed':
      return execSpeed(step, ctx);
    case 'stop':
      return execStop(step, ctx);
    case 'wait':
      return execWait(step, ctx);
    case 'wait_for_distance':
      return execWaitForDistance(step, ctx);
    case 'repeat':
      return execRepeat(step, ctx, path);
    case 'say':
      return execSay(step, ctx);
    case 'calibrate':
      return execCalibrate(step, ctx);
    case 'play_sound':
      return execPlaySound(step, ctx);
    case 'play_tune':
      return execPlayTune(step, ctx);
  }
}

async function execSpin(step: SpinStep, ctx: StepCtx) {
  const motorCfg = MOTORS[step.motor];
  const dirOverride = useCalibrationStore.getState().current.dirOverride[step.motor];

  // 학생이 'reverse' 라고 한 의도와 보드 dirOverride 둘 다 반영.
  const forwardByte = motorCfg.forwardByte;
  const reverseByte = motorCfg.reverseByte;
  const directionByte = (step.direction === 'reverse') ? reverseByte : forwardByte;

  // 🚨 펌웨어 v1.0(원본, 학생 보드) 호환 모드:
  //   - V0~V9 PWM 명령은 v1.0 에 없음. 보내면 펌웨어가 무시하고 'V'/숫자를 알 수 없는 명령으로 처리.
  //   - 따라서 PWM 명령 안 보내고 펌웨어 기본 globalPwm(=255, 100%)로 풀파워 동작.
  //   - 이전 작동하는 Python 코드(keyboard_controller.py) 도 V 명령 안 씀 — 동일 패턴.
  // 추후 펌웨어 v1.4 일괄 표준화 시 V 명령 도입 검토.
  await ctx.send(directionByte);

  if (step.duration_ms !== undefined) {
    await ctx.delay(step.duration_ms);
    await ctx.send(GLOBAL.stopAll);
  }

  // dirOverride 는 상태 추적용. 펌웨어에 미리 토글 보낸 상태를 가정.
  // 학생이 캘리브레이션 위저드에서 toggleDir 누를 때 webSerial 로 F{n} 직접 전송.
  void dirOverride;
}

async function execDrive(step: DriveStep, ctx: StepCtx) {
  // 🚨 v1.0 호환 모드 — V 명령 안 보냄. 펌웨어 globalPwm 기본(255)로 풀파워 4WD.
  const headingByte = {
    forward: GLOBAL.carForward,
    backward: GLOBAL.carBackward,
    turn_left: GLOBAL.turnLeft,
    turn_right: GLOBAL.turnRight,
  }[step.heading];
  await ctx.send(headingByte);

  if (step.duration_ms !== undefined) {
    await ctx.delay(step.duration_ms);
    await ctx.send(GLOBAL.stopAll);
  }
}

async function execServo(step: ServoStep, ctx: StepCtx) {
  const cfg = SERVOS[step.servo];
  // SG90 한 스텝(±15도) 안정화 시간 ~150ms. 200ms 권장 (Python 키 반복률보다 길게).
  // 너무 짧으면 빠른 batch 시 stall 또는 명령 누락 발생.
  const SERVO_STEP_DELAY_MS = 200;
  if (step.to_degrees !== undefined) {
    const targetSteps = Math.round((step.to_degrees - cfg.defaultPos) / cfg.stepDegrees);
    const byte = targetSteps >= 0 ? cfg.stepUpByte : cfg.stepDownByte;
    for (let n = 0; n < Math.abs(targetSteps); n++) {
      await ctx.send(byte);
      await ctx.delay(SERVO_STEP_DELAY_MS);
    }
  } else if (step.step !== undefined) {
    const byte = step.step >= 0 ? cfg.stepUpByte : cfg.stepDownByte;
    for (let n = 0; n < Math.abs(step.step); n++) {
      await ctx.send(byte);
      await ctx.delay(SERVO_STEP_DELAY_MS);
    }
  }
}

async function execSpeed(step: SpeedStep, ctx: StepCtx) {
  // 🚨 v1.0 호환 모드 — V 명령 보내지 않음. 인터프리터 로컬 상태만 추적.
  ctx.setSpeed(step.level);
}

async function execStop(step: StopStep, ctx: StepCtx) {
  if (step.scope === undefined || step.scope === 'all') {
    await ctx.send(GLOBAL.stopAll);
    return;
  }
  // 단일 모터 정지는 펌웨어 "정지 코드" 가 없음 — forward 바이트를 한 번 더 보낸 뒤 0 글로벌은 과함.
  // 임시: 해당 모터 dirToggle 없이 forward+reverse 모두 끄려면 펌웨어 1바이트 명령으론 불가능.
  // v1.3 한계로 단일 모터 정지는 글로벌 정지로 fallback.
  await ctx.send(GLOBAL.stopAll);
}

async function execWait(step: WaitStep, ctx: StepCtx) {
  await ctx.delay(step.ms);
}

async function execWaitForDistance(step: WaitForDistanceStep, ctx: StepCtx) {
  const timeout = step.timeout_ms ?? 10000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (ctx.signal?.aborted) return;
    const cm = ctx.readDistance();
    if (cm !== null && cm < step.cm_below) return;
    await ctx.delay(50);
  }
}

async function execRepeat(step: RepeatStep, ctx: StepCtx, path: string) {
  for (let i = 0; i < step.times; i++) {
    if (ctx.signal?.aborted) return;
    await ctx.runSubSteps(step.steps, `${path}.iter[${i}]`);
  }
}

async function execSay(step: SayStep, ctx: StepCtx) {
  // 음성 재생 끝까지 await — onEvent (page.tsx) 가 Promise 리턴.
  // 이렇게 해야 학생이 "음성으로 먼저 설명하고 동작" 의도를 정확히 표현.
  await ctx.emit({ type: 'say', text: step.text });
}

async function execCalibrate(step: CalibrateStep, ctx: StepCtx) {
  await ctx.emit({ type: 'calibrate', reason: step.reason });
}

async function execPlaySound(step: PlaySoundStep, ctx: StepCtx) {
  // 효과음은 짧고 분위기용이라 await 안 함 — 다음 step 과 동시 진행.
  ctx.emit({ type: 'play_sound', sound: step.sound, volume: step.volume ?? 1.0 });
}

async function execPlayTune(step: PlayTuneStep, ctx: StepCtx) {
  // await_melody=true 면 멜로디 끝까지 기다림 (학생 "음악 끝나면 다음 동작" 의도).
  // 기본은 false — 멜로디와 모터 동작이 동시 진행 (학생 "음악 맞춰서 흔들어줘" 의도).
  const awaitMelody = step.await_melody ?? false;
  if (awaitMelody) {
    await ctx.emit({ type: 'play_tune', tune: step.tune, tempo: step.tempo ?? 1.0, await_melody: true });
  } else {
    ctx.emit({ type: 'play_tune', tune: step.tune, tempo: step.tempo ?? 1.0, await_melody: false });
  }
}

async function safeStop(send: (p: string) => Promise<void>) {
  try { await send(GLOBAL.stopAll); } catch {}
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
