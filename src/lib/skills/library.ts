// 4 기본 모델 스킬 라이브러리 — AI 안 거치고 즉시 실행 가능한 기본 동작.
// 학생이 작품 선택 + "기본 동작 ▶" 누르면 미리 정의된 시퀀스 그대로 실행.
// LLM 비용 0, 응답 시간 0, 동작 일관성 보장 — 데모 안전망.
//
// 자연어 모드와 공존: 학생이 "다른 동작 해줘" 등 발화 시 AI 가 새 DSL 만들어 덮어씀.

import type { Program } from '@/lib/dsl/schema';
import { melodyDurationMs } from '@/lib/sound/melodySynth';

type Artwork = NonNullable<Program['artwork']>;

// 스킬 executor — 음악-동작 정교 sync 가 필요한 스킬은 program 대신 executor 사용.
// 200ms tick 으로 V level 보간 등 실시간 제어.
export interface SkillExecutor {
  send: (payload: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
  signal: AbortSignal;
  speak: (text: string) => Promise<void>;
  // playMelody 가 Promise<void> 반환 — 음악 끝까지 await 가능 (sync 필요한 스킬용).
  playMelody: (tune: string) => Promise<void>;
  playEffect: (sound: string) => void;
  setStatus: (text: string) => void;
}

export interface Skill {
  id: string;
  artwork: Artwork;
  label: string;       // UI 칩 텍스트 (10자 이내 권장)
  emoji: string;
  description: string; // 학생용 짧은 설명
  program: Program;
  // optional: executor 정의 시 우선 호출 (program 무시).
  // 음악-동작 sync 같은 정교 제어용.
  execute?: (ctx: SkillExecutor) => Promise<void>;
}

export const SKILLS: Skill[] = [
  // ─────── 바이킹 (M1 + M3 듀얼 — 본 보드 viking 표준) ───────
  {
    id: 'viking_swing',
    artwork: 'viking',
    label: '신나게 흔들기',
    emoji: '🚣',
    description: '바이킹처럼 좌우로 점점 신나게 흔들어줘',
    program: {
      schema_version: 1,
      artwork: 'viking',
      intro: '[excited]좌우로 흔들거야!',
      steps: [
        { do: 'play_sound', sound: 'creak' },
        { do: 'speed', level: '보통' },
        { do: 'repeat', times: 6, steps: [
          { do: 'spin', motor: 'M1', speed: '보통', direction: 'forward', duration_ms: 400 },
          { do: 'spin', motor: 'M1', speed: '보통', direction: 'reverse', duration_ms: 400 },
        ]},
        { do: 'repeat', times: 6, steps: [
          { do: 'spin', motor: 'M1', speed: '빠르게', direction: 'forward', duration_ms: 350 },
          { do: 'spin', motor: 'M1', speed: '빠르게', direction: 'reverse', duration_ms: 350 },
        ]},
        { do: 'stop' },
        { do: 'play_sound', sound: 'cheer' },
        { do: 'say', text: '[happy]와! 출렁출렁! 어땠어?' },
      ],
      variation_chips: ['더 신나게!', '학교종 켜고', '거꾸로 흔들기', '천천히 8번'],
    },
  },

  {
    id: 'viking_school_bell',
    artwork: 'viking',
    label: '학교종에 맞춰',
    emoji: '🔔',
    description: '학교종 음악과 동시에 좌우 흔들기 (음악-동작 sync)',
    program: {
      schema_version: 1,
      artwork: 'viking',
      intro: '[happy]노래에 맞춰 흔들거야!',
      steps: [{ do: 'say', text: '[happy]노래에 맞춰 흔들거야!' }],
      variation_chips: ['반짝반짝으로', '나비야로', '더 빠르게', '곰세마리도'],
    },
    // 음악-동작 정확 sync — 음악 길이만큼 좌우 흔들기, 음악 끝 = 모터 정지.
    execute: async (ctx) => {
      ctx.setStatus('🔔 노래에 맞춰 흔들거야!');
      await ctx.speak('[happy]노래에 맞춰 흔들거야!');
      if (ctx.signal.aborted) return;

      const totalMs = melodyDurationMs('school_bell');
      const SWING_MS = 400;
      // 음악 + 흔들기 동시 시작
      const musicPromise = ctx.playMelody('school_bell');
      const startedAt = Date.now();

      let dir = 1;
      while (true) {
        if (ctx.signal.aborted) { await ctx.send('0'); return; }
        const elapsed = Date.now() - startedAt;
        if (elapsed >= totalMs - SWING_MS) break;   // 마지막 한 번 더 안 가게 여유
        await ctx.send('V6');
        // M1 + M3 듀얼 (Ami5_V01 viking 표준 — M3_DIR=-1 로 회전축 정합)
        await ctx.send(dir > 0 ? '1' : '!');
        await ctx.send(dir > 0 ? '3' : '#');
        await ctx.delay(SWING_MS);
        dir *= -1;
      }
      await ctx.send('0');
      await musicPromise.catch(() => {});
      ctx.setStatus('🔔 끝!');
      await ctx.speak('[excited]노래랑 같이 흔들렸지? 한 번 더?');
    },
  },

  // ─────── 자동차 (4WD) ───────
  {
    id: 'car_explore',
    artwork: 'car_4wd',
    label: '한 바퀴 탐험',
    emoji: '🚗',
    description: '앞으로 → 오른쪽 → 뒤로 → 왼쪽 한 바퀴',
    program: {
      schema_version: 1,
      artwork: 'car_4wd',
      intro: '[excited]붕붕! 한 바퀴 돌아볼게!',
      steps: [
        { do: 'play_sound', sound: 'engine_start' },
        { do: 'speed', level: '보통' },
        { do: 'drive', heading: 'forward', speed: '보통', duration_ms: 1500 },
        { do: 'drive', heading: 'turn_right', speed: '보통', duration_ms: 800 },
        { do: 'drive', heading: 'forward', speed: '보통', duration_ms: 1500 },
        { do: 'drive', heading: 'turn_right', speed: '보통', duration_ms: 800 },
        { do: 'drive', heading: 'forward', speed: '보통', duration_ms: 1500 },
        { do: 'stop' },
        { do: 'say', text: '[happy]도착! 더 멀리 가볼까?' },
      ],
      variation_chips: ['반대로 도는 코스', '음악 켜고 가기', '느리게 한 바퀴', '더 멀리 더 빠르게'],
    },
  },

  // ─────── 악어 (서보 입+꼬리) ───────
  {
    id: 'crocodile_chomp',
    artwork: 'crocodile',
    label: '으르렁 입 벌리기',
    emoji: '🐊',
    description: '입 크게 벌렸다 다물기 + 꼬리 흔들기',
    program: {
      schema_version: 1,
      artwork: 'crocodile',
      intro: '[curious]으르렁! 잡아먹을 거야!',
      steps: [
        { do: 'calibrate', reason: 'servo_power' },
        { do: 'play_sound', sound: 'crocodile' },
        { do: 'servo', servo: 'SA', step: 5 },     // 입 크게 벌림
        { do: 'wait', ms: 600 },
        { do: 'servo', servo: 'SB', step: 4 },     // 꼬리 흔들기
        { do: 'wait', ms: 300 },
        { do: 'servo', servo: 'SB', step: -4 },
        { do: 'wait', ms: 300 },
        { do: 'servo', servo: 'SA', step: -5 },    // 입 다물기
        { do: 'say', text: '[happy]와! 무서웠어? 또 잡아먹을까?' },
      ],
      variation_chips: ['죠스 음악 켜고', '꼬리만 흔들기', '입 빠르게 짝짝', '천천히 한 번'],
    },
  },

  // ─────── 악어 + 죠스 음악 (긴장감 점증 + 마지막에 입 크게) ───────
  {
    id: 'crocodile_jaws',
    artwork: 'crocodile',
    label: '죠스가 다가온다',
    emoji: '🦈',
    description: '죠스 음악 긴장감 점증 + 음악 끝에 입 크게 벌리기 (음악-동작 sync)',
    program: {
      schema_version: 1,
      artwork: 'crocodile',
      intro: '[whispers]쉿... 죠스가 다가오고 있어...',
      steps: [{ do: 'say', text: '[whispers]쉿... 죠스가 다가오고 있어...' }],
      variation_chips: ['더 무섭게', '입만 크게', '꼬리도 흔들면서', '한 번 더'],
    },
    execute: async (ctx) => {
      ctx.setStatus('🦈 쉿... 죠스가 다가와...');
      await ctx.speak('[whispers]쉿... 죠스가 다가오고 있어...');
      if (ctx.signal.aborted) return;

      const totalMs = melodyDurationMs('jaws');
      // 음악 시작 — 모터/서보는 잠깐 후 점진 시작
      const musicPromise = ctx.playMelody('jaws');
      const startedAt = Date.now();

      // 음악 80% 까지는 입 미세 떨림 (긴장감)
      const buildUpEnd = totalMs * 0.8;
      let mouthOpen = false;
      while (Date.now() - startedAt < buildUpEnd) {
        if (ctx.signal.aborted) { await ctx.send('0'); return; }
        // 작은 진폭 — SA ±15도 토글로 입 미세 떨림
        await ctx.send(mouthOpen ? '5' : '%');
        mouthOpen = !mouthOpen;
        await ctx.delay(500);
      }
      // 마지막 20% — 클라이맥스 입 크게 벌림 + 효과음
      ctx.setStatus('🦈 으르렁!!!');
      ctx.playEffect('crocodile');
      // SA 두 번 % (15도 ×2 = 30도 더) → 입 크게
      await ctx.send('%');
      await ctx.send('%');
      await ctx.send('%');
      await ctx.delay(400);
      // 음악 끝까지 입 크게 벌린 채 대기
      await musicPromise.catch(() => {});
      // 입 다물기
      await ctx.send('5');
      await ctx.send('5');
      await ctx.send('5');
      ctx.setStatus('🦈 끝!');
      await ctx.speak('[happy]휴, 살았다! 한 번 더?');
    },
  },

  // ─────── 발레리나 (오르골) ───────
  {
    id: 'ballerina_musicbox',
    artwork: 'ballerina',
    label: '오르골 발레리나',
    emoji: '🩰',
    description: '오르골 음악과 함께 점점 천천히 회전 (음악-동작 정교 sync)',
    program: {
      schema_version: 1,
      artwork: 'ballerina',
      intro: '[happy]오르골 풀어줄게!',
      steps: [{ do: 'say', text: '[happy]태엽 풀어줄게!' }],
      variation_chips: ['다시 태엽 감기', '거꾸로 돌리기', '더 길게 돌리기', '반짝반짝으로'],
    },
    // 음악-동작 정확 sync — 음악 진행률에 모터 V level 정확히 매핑.
    // 핵심: 음악과 회전을 같은 시점에 시작, 같은 시점에 끝낸다.
    //   - speak 는 음악 시작 전에 1번 (음악 시작 후엔 안 끼게)
    //   - 음악 시작 = 회전 시작 = startedAt
    //   - 진행률 0~1 동안 V9 → V2 linear 감속
    //   - 음악 끝 = 회전 끝 (정지 명령) — 같은 timestamp.
    execute: async (ctx) => {
      ctx.setStatus('🩰 오르골 풀어줄게!');
      // ① 짧은 인사말 — 음악 시작 전에 끝냄 (음악 위에 안 겹치도록)
      await ctx.speak('[happy]태엽 풀어줄게!');
      if (ctx.signal.aborted) return;

      // ② 음악 길이 정확 측정 (BASE_BEAT_MS 기반, 정확)
      const totalMs = melodyDurationMs('music_box');

      // ③ 모터 시동 — 음악 시작 직전에 V9 + W 보내고 그 다음 음악 시작
      //    이러면 학생이 보기에 음악과 회전이 동시에 시작되는 것처럼 보임
      await ctx.send('V9');
      await ctx.send('W');

      // ④ 음악 시작 (await X — 뒤에서 await 함)
      const musicPromise = ctx.playMelody('music_box');
      const startedAt = Date.now();

      // ⑤ 진행률 따라 V level 감속 (250ms 마다 갱신)
      while (true) {
        if (ctx.signal.aborted) {
          await ctx.send('0');
          return;
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed >= totalMs) break;

        const progress = elapsed / totalMs;
        const v = Math.max(2, Math.round(9 - progress * 7));
        await ctx.send(`V${v}`);
        ctx.setStatus(`🩰 ${Math.round(progress * 100)}%`);
        await ctx.delay(250);
      }
      // ⑥ 음악 끝 == 회전 끝. 정지 + 음악 마무리 await
      await ctx.send('0');
      await musicPromise.catch(() => {});
      ctx.setStatus('🩰 끝!');
      await ctx.speak('[curious]태엽 다 풀렸네... 다시 감을까?');
    },
  },

  // ─────── 자유 / 회전그네 — 단순 ───────
  {
    id: 'swing_round',
    artwork: 'swing',
    label: '한 방향 회전',
    emoji: '🎠',
    description: 'M1 한 방향으로 6초 돌리기',
    program: {
      schema_version: 1,
      artwork: 'swing',
      intro: '[excited]빙글빙글 돌게!',
      steps: [
        { do: 'speed', level: '보통' },
        { do: 'spin', motor: 'M1', speed: '보통', direction: 'forward', duration_ms: 6000 },
        { do: 'stop' },
        { do: 'say', text: '[happy]어지러우면 거꾸로 돌려볼까?' },
      ],
      variation_chips: ['거꾸로 돌리기', '음악 같이', '점점 빠르게', '천천히 길게'],
    },
  },
];

export function skillsForArtwork(artwork: Artwork | undefined): Skill[] {
  if (!artwork || artwork === 'free') return [];
  return SKILLS.filter((s) => s.artwork === artwork);
}
