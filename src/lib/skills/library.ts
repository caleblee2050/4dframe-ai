// 4 기본 모델 스킬 라이브러리 — AI 안 거치고 즉시 실행 가능한 기본 동작.
// 학생이 작품 선택 + "기본 동작 ▶" 누르면 미리 정의된 시퀀스 그대로 실행.
// LLM 비용 0, 응답 시간 0, 동작 일관성 보장 — 데모 안전망.
//
// 자연어 모드와 공존: 학생이 "다른 동작 해줘" 등 발화 시 AI 가 새 DSL 만들어 덮어씀.

import type { Program } from '@/lib/dsl/schema';

type Artwork = NonNullable<Program['artwork']>;

export interface Skill {
  id: string;
  artwork: Artwork;
  label: string;       // UI 칩 텍스트 (10자 이내 권장)
  emoji: string;
  description: string; // 학생용 짧은 설명
  program: Program;
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
    description: '학교종이 땡땡땡에 맞춰 흔들어줘',
    program: {
      schema_version: 1,
      artwork: 'viking',
      intro: '[happy]노래에 맞춰 흔들거야!',
      steps: [
        { do: 'play_tune', tune: 'school_bell' },
        { do: 'repeat', times: 12, steps: [
          { do: 'spin', motor: 'M1', speed: '보통', direction: 'forward', duration_ms: 400 },
          { do: 'spin', motor: 'M1', speed: '보통', direction: 'reverse', duration_ms: 400 },
        ]},
        { do: 'stop' },
        { do: 'say', text: '[excited]노래랑 같이 흔들렸지? 한 번 더?' },
      ],
      variation_chips: ['반짝반짝으로', '나비야로', '더 빠르게', '곰세마리도'],
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

  // ─────── 발레리나 (오르골) ───────
  {
    id: 'ballerina_musicbox',
    artwork: 'ballerina',
    label: '오르골 발레리나',
    emoji: '🩰',
    description: '오르골 음악과 함께 점점 천천히 회전',
    program: {
      schema_version: 1,
      artwork: 'ballerina',
      intro: '[happy]오르골 풀어줄게!',
      steps: [
        { do: 'play_tune', tune: 'music_box', await_melody: false },
        { do: 'speed', level: '빠르게' },
        { do: 'spin', motor: 'M1', speed: '빠르게', direction: 'forward', duration_ms: 2500 },
        { do: 'speed', level: '보통' },
        { do: 'spin', motor: 'M1', speed: '보통', direction: 'forward', duration_ms: 3500 },
        { do: 'speed', level: '천천히' },
        { do: 'spin', motor: 'M1', speed: '천천히', direction: 'forward', duration_ms: 5000 },
        { do: 'stop' },
        { do: 'say', text: '[curious]태엽 다 풀렸네... 다시 감을까?' },
      ],
      variation_chips: ['다시 태엽 감기', '거꾸로 돌리기', '더 길게 돌리기', '반짝반짝으로'],
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
