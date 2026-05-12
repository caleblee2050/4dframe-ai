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
  WaitForDistanceStep, RepeatStep, SayStep, CalibrateStep, PlaySoundStep, PlayTuneStep, TuneSyncStep,
  SetMotorDirStep, SetMotorThresholdStep,
} from './schema';
import {
  MOTORS, SERVOS, GLOBAL, pwmCommand, isV13Plus, speedToLevel,
} from '@/lib/commands/commands';
import { calibratedPwmLevel, useCalibrationStore } from '@/lib/calibration/store';
import { useBoardStore } from '@/lib/serial/webSerial';
import { melodyDurationMs, stopMelody } from '@/lib/sound/melodySynth';

export type InterpreterEvent =
  | { type: 'say'; text: string }
  | { type: 'calibrate'; reason: CalibrateStep['reason'] }
  | { type: 'play_sound'; sound: PlaySoundStep['sound']; volume: number }
  | { type: 'play_tune'; tune: PlayTuneStep['tune']; tempo: number; await_melody: boolean; custom?: PlayTuneStep['custom'] }
  | { type: 'save_skill'; label: string; emoji: string }
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
        try { stopMelody(); } catch {}
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
        try { stopMelody(); } catch {}
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
    case 'tune_sync':
      return execTuneSync(step, ctx, path);
    case 'save_skill':
      return ctx.emit({ type: 'save_skill', label: step.label, emoji: step.emoji });
    case 'set_motor_dir':
      return execSetMotorDir(step, ctx);
    case 'set_motor_threshold':
      return execSetMotorThreshold(step, ctx);
  }
}

// 모터 방향 영구 저장 + 펌웨어 F{n} 토글로 즉시 sync (현재 dirOverride 와 다를 때만).
async function execSetMotorDir(step: SetMotorDirStep, ctx: StepCtx) {
  const cal = useCalibrationStore.getState();
  const current = cal.current.dirOverride[step.motor];
  if (current !== step.dir) {
    cal.toggleDir(step.motor);
    // 펌웨어 측에도 F{n} 보내 즉시 반전 (다음 spin/drive 부터 적용).
    const n = step.motor.slice(1);   // 'M1' → '1'
    await ctx.send(`F${n}`);
  }
  await ctx.emit({ type: 'say', text: `${step.motor} 방향을 ${step.dir > 0 ? '정방향' : '역방향'} 으로 저장했어!` });
}

// 모터 시동 V 영구 저장 (다음 spin/drive 부터 속도 매핑에 즉시 반영).
async function execSetMotorThreshold(step: SetMotorThresholdStep, ctx: StepCtx) {
  const cal = useCalibrationStore.getState();
  cal.setStartThreshold(step.motor, step.level);
  await ctx.emit({ type: 'say', text: `${step.motor} 시동 V 를 ${step.level} 로 저장했어!` });
}

async function execSpin(step: SpinStep, ctx: StepCtx) {
  const motorCfg = MOTORS[step.motor];
  const dirOverride = useCalibrationStore.getState().current.dirOverride[step.motor];
  const threshold = useCalibrationStore.getState().current.startThreshold;

  const forwardByte = motorCfg.forwardByte;
  const reverseByte = motorCfg.reverseByte;
  const directionByte = (step.direction === 'reverse') ? reverseByte : forwardByte;

  // 🔀 펌웨어 버전 자동 분기:
  //   - v1.3+: V0~V9 PWM 명령 지원 → 학생 SpeedLabel 을 보드별 시동 V 보정해서 송신.
  //   - v1.0 (원본): V 명령 무시됨 → 안 보냄. 펌웨어 기본 globalPwm(=255, 100%)로 풀파워.
  // 자동 감지: useBoardStore.lastBoot.fw 가 "1.3" 이상이면 v1.3+ 가정.
  const fw = useBoardStore.getState().lastBoot?.fw;
  if (isV13Plus(fw)) {
    // 시동 V 균등 분배 — 천천히=시동V / 빠르게=V9 / 보통=중간 (5/9 D-1 결정)
    const level = calibratedPwmLevel(step.motor, step.speed, threshold);
    await ctx.send(pwmCommand(level));
  }

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
  const fw = useBoardStore.getState().lastBoot?.fw;
  if (isV13Plus(fw)) {
    // 4모터 동시 → 가장 빡빡한 시동 V 기준 매핑 (안 도는 모터 없게).
    const threshold = useCalibrationStore.getState().current.startThreshold;
    const motors: MotorId[] = ['M1', 'M2', 'M3', 'M4'];
    const maxThreshold = motors.reduce((acc, m) => Math.max(acc, threshold[m]), 0);
    const level = speedToLevel(step.speed, maxThreshold);
    await ctx.send(pwmCommand(level));
  }
  // v1.0: V 명령 안 보냄. 풀파워.

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
  ctx.setSpeed(step.level);
  const fw = useBoardStore.getState().lastBoot?.fw;
  if (isV13Plus(fw)) {
    const threshold = useCalibrationStore.getState().current.startThreshold;
    const motors: MotorId[] = ['M1', 'M2', 'M3', 'M4'];
    const maxThreshold = motors.reduce((acc, m) => Math.max(acc, threshold[m]), 0);
    const level = speedToLevel(step.level, maxThreshold);
    await ctx.send(pwmCommand(level));
  }
  // v1.0: 글로벌 PWM 그대로 (풀파워).
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
    await ctx.emit({ type: 'play_tune', tune: step.tune, tempo: step.tempo ?? 1.0, await_melody: true, custom: step.custom });
  } else {
    ctx.emit({ type: 'play_tune', tune: step.tune, tempo: step.tempo ?? 1.0, await_melody: false, custom: step.custom });
  }
}

// 모션 사이클 한 번이 대략 몇 ms 걸리는지 추정 — 마지막 사이클 시작이 음악 끝을 넘기는지 판단용.
// servo step 은 ±15도 당 200ms (interpreter SERVO_STEP_DELAY_MS 와 동일).
function estimateMotionCycleMs(steps: Step[]): number {
  let total = 0;
  for (const s of steps) {
    if (s.do === 'spin' || s.do === 'drive') {
      if (s.duration_ms) total += s.duration_ms;
    } else if (s.do === 'wait') {
      total += s.ms;
    } else if (s.do === 'servo') {
      const n = s.step !== undefined
        ? Math.abs(s.step)
        : s.to_degrees !== undefined
          ? Math.ceil(Math.abs(s.to_degrees - 90) / 15)
          : 0;
      total += n * 200;
    } else if (s.do === 'repeat') {
      total += s.times * estimateMotionCycleMs(s.steps);
    }
    // say/play_sound/calibrate/stop/speed/set_* 등은 거의 즉시 → 0
  }
  return total;
}

// tune_sync 전용 인라인 모션 실행 — 일반 execSpin/execDrive 는 duration_ms 끝에 stopAll 을
// 자동 송신해서 매 사이클 사이 모터가 멎었다 출발 → 음악과 어긋남 + 진동.
// 여기서는 stopAll 을 빼고 direction byte 만 흘려서 부드럽게 방향 전환 (viking_school_bell
// 스킬과 동일한 패턴). 마지막에 단 한 번 stopAll.
async function runMotionInline(steps: Step[], ctx: StepCtx, deadline: number) {
  const fw = useBoardStore.getState().lastBoot?.fw;
  const v13 = isV13Plus(fw);
  const threshold = useCalibrationStore.getState().current.startThreshold;

  for (const s of steps) {
    if (ctx.signal?.aborted) return;
    if (Date.now() >= deadline) return;

    if (s.do === 'spin') {
      const motorCfg = MOTORS[s.motor];
      const directionByte = s.direction === 'reverse' ? motorCfg.reverseByte : motorCfg.forwardByte;
      if (v13) {
        const level = calibratedPwmLevel(s.motor, s.speed, threshold);
        await ctx.send(pwmCommand(level));
      }
      await ctx.send(directionByte);
      const dur = s.duration_ms ?? 400;
      // deadline 까지만 대기 (음악이 먼저 끝나면 즉시 종료)
      const clamped = Math.min(dur, Math.max(0, deadline - Date.now()));
      if (clamped > 0) await ctx.delay(clamped);
      // ⚠ 의도적으로 stopAll 안 보냄 — 다음 step 의 direction byte 가 부드럽게 전환
    } else if (s.do === 'drive') {
      if (v13) {
        const motors: MotorId[] = ['M1', 'M2', 'M3', 'M4'];
        const maxThreshold = motors.reduce((acc, m) => Math.max(acc, threshold[m]), 0);
        const level = speedToLevel(s.speed, maxThreshold);
        await ctx.send(pwmCommand(level));
      }
      const headingByte = {
        forward: GLOBAL.carForward,
        backward: GLOBAL.carBackward,
        turn_left: GLOBAL.turnLeft,
        turn_right: GLOBAL.turnRight,
      }[s.heading];
      await ctx.send(headingByte);
      const dur = s.duration_ms ?? 400;
      const clamped = Math.min(dur, Math.max(0, deadline - Date.now()));
      if (clamped > 0) await ctx.delay(clamped);
    } else if (s.do === 'wait') {
      const clamped = Math.min(s.ms, Math.max(0, deadline - Date.now()));
      if (clamped > 0) await ctx.delay(clamped);
    } else if (s.do === 'servo' || s.do === 'speed' || s.do === 'stop' || s.do === 'say' || s.do === 'play_sound') {
      // 일반 execute 위임 — 짧고 stop 안 끼는 step 들. await 함.
      await executeStep(s, ctx, '$tune_sync.motion');
    }
    // repeat 등은 motion 안에 잘 안 쓰니 일단 무시 (필요시 추후 확장).
  }
}

// 거리 → tempo 보간. dt.near_cm 이하 = near_tempo, far_cm 이상 = far_tempo, 사이는 선형.
// 거리 센서 미가용(null) 이면 두 tempo 의 평균 사용.
function tempoFromDistance(
  cm: number | null,
  dt: NonNullable<TuneSyncStep['distance_tempo']>,
): number {
  if (cm === null || !Number.isFinite(cm)) return (dt.near_tempo + dt.far_tempo) / 2;
  if (cm <= dt.near_cm) return dt.near_tempo;
  if (cm >= dt.far_cm) return dt.far_tempo;
  const t = (cm - dt.near_cm) / (dt.far_cm - dt.near_cm);
  return dt.near_tempo + (dt.far_tempo - dt.near_tempo) * t;
}

// tune_sync 한 곡 실행 — 음악 시작, motion 사이클 반복, 끝나면 stop.
// 외부 abort / 외부 deadline 도달 시 중단. 반환: 자연 종료 여부 (true=음악 끝까지 / false=중단됨)
async function playTuneOnce(
  step: TuneSyncStep,
  ctx: StepCtx,
  effectiveTempo: number,
  outerDeadline: number,
): Promise<boolean> {
  const totalMs = melodyDurationMs(step.tune, effectiveTempo, step.custom);
  // motion duration_ms 도 tempo 비율로 스케일 — tempo 빠르면 모션도 빠르게.
  const scaledMotion = scaleMotionByTempo(step.motion, effectiveTempo);
  const trim = step.trim_to_music ?? true;
  const cycleMs = estimateMotionCycleMs(scaledMotion);

  ctx.emit({ type: 'play_tune', tune: step.tune, tempo: effectiveTempo, await_melody: false, custom: step.custom });
  const startedAt = Date.now();
  const innerDeadline = Math.min(startedAt + totalMs, outerDeadline);

  while (true) {
    if (ctx.signal?.aborted) return false;
    if (Date.now() >= outerDeadline) return false;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= totalMs) break;
    if (trim && cycleMs > 0 && elapsed + cycleMs > totalMs + 200) break;
    await runMotionInline(scaledMotion, ctx, innerDeadline);
  }

  // 음악 끝까지 정확히 대기 (모터 정지는 호출자 측에서)
  const remaining = totalMs - (Date.now() - startedAt);
  if (remaining > 0) {
    const clamped = Math.min(remaining, Math.max(0, outerDeadline - Date.now()));
    if (clamped > 0) await ctx.delay(clamped);
  }
  return true;
}

// tempo 변화에 맞춰 motion 의 duration_ms 를 비율 조정.
// tempo 2.0 (2배 빠름) → motion duration 절반.
function scaleMotionByTempo(steps: Step[], tempo: number): Step[] {
  if (Math.abs(tempo - 1.0) < 0.001) return steps;
  const scale = 1 / tempo;
  return steps.map((s): Step => {
    if (s.do === 'spin' && s.duration_ms !== undefined) {
      return { ...s, duration_ms: Math.max(50, Math.round(s.duration_ms * scale)) };
    }
    if (s.do === 'drive' && s.duration_ms !== undefined) {
      return { ...s, duration_ms: Math.max(50, Math.round(s.duration_ms * scale)) };
    }
    if (s.do === 'wait') {
      return { ...s, ms: Math.max(20, Math.round(s.ms * scale)) };
    }
    return s;
  });
}

async function execTuneSync(step: TuneSyncStep, ctx: StepCtx, _path: string) {
  // 🦈 distance_tempo 가 있으면 = loop 모드 (죠스 다가오기).
  if (step.distance_tempo) {
    const dt = step.distance_tempo;
    const stopCmBelow = dt.stop_cm_below ?? 5;
    const maxLoops = dt.max_loops ?? 10;
    const timeoutMs = dt.timeout_ms ?? 30000;
    const sessionStart = Date.now();
    const outerDeadline = sessionStart + timeoutMs;

    for (let loop = 0; loop < maxLoops; loop++) {
      if (ctx.signal?.aborted) break;
      if (Date.now() >= outerDeadline) break;
      const cm = ctx.readDistance();
      if (cm !== null && cm < stopCmBelow) break;
      const tempo = tempoFromDistance(cm, dt);
      const completed = await playTuneOnce(step, ctx, tempo, outerDeadline);
      // 자연 종료 안 됐으면 (abort/timeout) 루프도 종료.
      if (!completed) break;
      // 짧은 휴지 (한 loop 끝 → 다음 시작 사이 정적) — 거리감 살리는 호흡.
      if (loop < maxLoops - 1) await ctx.delay(150);
    }
    try { stopMelody(); } catch {}
    await safeStop(ctx.send);
    return;
  }

  // 일반 모드 — 한 곡 + motion 동기 + 끝나면 stop.
  const tempo = step.tempo ?? 1.0;
  const totalMs = melodyDurationMs(step.tune, tempo, step.custom);
  await playTuneOnce(step, ctx, tempo, Date.now() + totalMs + 2000);
  if (ctx.signal?.aborted) {
    try { stopMelody(); } catch {}
  }
  await ctx.send(GLOBAL.stopAll);
}

async function safeStop(send: (p: string) => Promise<void>) {
  try { await send(GLOBAL.stopAll); } catch {}
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
