'use client';

// 학생용 메인 페이지 — 자연어로 4D프레임 작품을 동작시킨다.
//
// 흐름: 자연어 입력 → /api/chat 스트리밍 → JSON DSL 누적 → validateProgram → 미리보기 → ▶ 실행 → 보드 송신
// 보조: 모터 캘리브 카드 (시동 V 조절), 거리센서 위젯 + 거리 반응 토글, 보드 연결 헤더.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Joystick } from '@/components/play/Joystick';
import { CameraPanel } from '@/components/play/CameraPanel';
import { isV13Plus } from '@/lib/commands/commands';
import { skillsForArtwork, type Skill } from '@/lib/skills/library';
import { useCustomSkillsStore, type CustomSkill } from '@/lib/skills/customStore';
import { useGestureMappingStore, ACTIONS, actionById, fingerCountToKey, GESTURE_LABELS, type GestureKey, type ActionId } from '@/lib/gestures/mappingStore';
import { useBoardStore } from '@/lib/serial/webSerial';
import { useCalibrationStore } from '@/lib/calibration/store';
import { runProgram, type InterpreterEvent } from '@/lib/dsl/interpreter';
import { validateProgram, type Program, type Step, type MotorId } from '@/lib/dsl/schema';
import { palette, radius, shadow, border, motion as m } from '@/lib/design/tokens';
import { MOTORS, GLOBAL } from '@/lib/commands/commands';
import type { PromptContext } from '@/lib/ai/systemPrompt';
import { useSoundStore, playEffect, speakText, stopSpeaking, stripAudioTags, prefetchProgramAudio } from '@/lib/sound/soundManager';
import { playMelody } from '@/lib/sound/melodySynth';

const MOTOR_IDS: MotorId[] = ['M1', 'M2', 'M3', 'M4'];

const ARTWORKS: Array<{ id: PromptContext['artwork']; label: string; emoji: string }> = [
  { id: 'free', label: '자유', emoji: '🛠️' },
  { id: 'viking', label: '바이킹', emoji: '🚣' },
  { id: 'car_4wd', label: '자동차', emoji: '🚗' },
  { id: 'swing', label: '회전그네', emoji: '🎠' },
  { id: 'crocodile', label: '악어', emoji: '🐊' },
  { id: 'ballerina', label: '발레리나', emoji: '🩰' },
];

const SAMPLE_PROMPTS = [
  '바이킹을 더 신나게 흔들어줘',
  '자동차로 앞으로 1초 갔다가 오른쪽으로 돌아줘',
  'M1을 천천히 3초 돌려줘',
  '악어 입을 한 번 벌렸다 다물게 해줘',
];

const card: React.CSSProperties = {
  background: palette.panel,
  border: border.brutal,
  borderRadius: radius.md,
  boxShadow: shadow.brutal,
  padding: 16,
};

// 손 동작 매핑 한 줄 (emoji + 라벨 + 동작 드롭다운)
function GestureMapRow({
  emoji, label, gesture, value, onChange, colors,
}: {
  emoji: string;
  label: string;
  gesture: GestureKey;
  value: ActionId;
  onChange: (v: ActionId) => void;
  colors: { bg: string; panel: string; textMain: string; textMuted: string; accent: string };
}) {
  void gesture;   // 디버그용 (접두 표시 등). 현재는 미사용.
  const current = actionById(value);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: colors.bg, padding: '8px 10px',
      border: `2px solid ${colors.textMain}`, borderRadius: 8,
    }}>
      <span style={{ fontSize: 22 }}>{emoji}</span>
      <span style={{ fontSize: 13, fontWeight: 800, minWidth: 56 }}>{label}</span>
      <span style={{ fontSize: 13, color: colors.textMuted }}>→</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ActionId)}
        style={{
          flex: 1, fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
          background: colors.panel, color: colors.textMain,
          border: `2px solid ${colors.textMain}`, borderRadius: 6,
          padding: '6px 8px', cursor: 'pointer',
        }}
      >
        {ACTIONS.map((a) => (
          <option key={a.id} value={a.id}>{a.emoji} {a.label}</option>
        ))}
      </select>
      <span style={{ fontSize: 18 }}>{current.emoji}</span>
    </div>
  );
}

// 사진 dataURL → maxSide 픽셀 너비/높이로 리사이즈. JPEG 0.85 품질.
async function resizeImageDataURL(dataURL: string, maxSide: number): Promise<string> {
  if (typeof window === 'undefined') return dataURL;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataURL;
  });
  const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (ratio === 1) return dataURL;
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataURL;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const stepIcon: Record<Step['do'], string> = {
  spin: '🔄', drive: '🚗', servo: '🎚', speed: '⚡',
  stop: '⏹', wait: '⏱', wait_for_distance: '👀', repeat: '🔁',
  say: '💬', calibrate: '🔧', play_sound: '🔊', play_tune: '🎵',
};

function describeStep(step: Step): string {
  switch (step.do) {
    case 'spin': {
      const dir = step.direction === 'reverse' ? ' 거꾸로' : '';
      const dur = step.duration_ms ? ` ${(step.duration_ms / 1000).toFixed(1)}초` : '';
      return `${step.motor} 를${dir} ${step.speed} 속도로 돌림${dur}`;
    }
    case 'drive': {
      const map = { forward: '앞으로', backward: '뒤로', turn_left: '왼쪽 회전', turn_right: '오른쪽 회전' };
      const dur = step.duration_ms ? ` ${(step.duration_ms / 1000).toFixed(1)}초` : '';
      return `자동차 ${map[step.heading]} ${step.speed}${dur}`;
    }
    case 'servo':
      if (step.to_degrees !== undefined) return `서보 ${step.servo} 를 ${step.to_degrees}도로`;
      return `서보 ${step.servo} ${step.step! > 0 ? '+' : ''}${step.step! * 15}도`;
    case 'speed': return `기본 속도 → ${step.level}`;
    case 'stop': return step.scope && step.scope !== 'all' ? `${step.scope} 정지` : '전체 정지';
    case 'wait': return `${(step.ms / 1000).toFixed(1)}초 대기`;
    case 'wait_for_distance': return `${step.cm_below}cm 안에 들어올 때까지 대기`;
    case 'repeat': return `${step.times}번 반복 (안에 ${step.steps.length}개 동작)`;
    case 'say': return `학생에게 한마디: "${step.text}"`;
    case 'calibrate':
      return ({
        motor_individual_variance: '모터 개체차 안내',
        motor_direction_mirror: '모터 방향 안내',
        servo_power: '서보 전원 (9V) 점검 안내',
      })[step.reason];
    case 'play_sound':
      return `효과음: ${step.sound}`;
    case 'play_tune': {
      const tuneMap: Record<string, string> = {
        school_bell: '학교종', twinkle: '반짝반짝', butterfly: '나비야',
        mountain_rabbit: '산토끼', three_bears: '곰세마리', beep_pattern: '띠띠띠',
        music_box: '오르골', jaws: '죠스 등장음',
      };
      return `🎵 ${tuneMap[step.tune] ?? step.tune}`;
    }
  }
}

export default function PlayPage() {
  const board = useBoardStore();
  const cal = useCalibrationStore();
  const sound = useSoundStore();
  const customSkills = useCustomSkillsStore();
  const gestureMapping = useGestureMappingStore();

  const [artwork, setArtwork] = useState<PromptContext['artwork']>('free');
  const [distanceReactivity, setDistanceReactivity] = useState(false);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [program, setProgram] = useState<Program | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // 대화 누적 — AI 와의 코딩 세션 history
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [sayMessages, setSayMessages] = useState<Array<{ text: string; ts: number }>>([]);
  const [showTrace, setShowTrace] = useState(false);   // 실행 과정 펼침 여부
  const [showJoystick, setShowJoystick] = useState(false);   // 직접 조종 카드 표시 (작품 무관 토글)
  const [showCamera, setShowCamera] = useState(false);   // 카메라 동작 인식 토글
  const [showMappingAdvanced, setShowMappingAdvanced] = useState(false);   // 고급 매핑 펼침
  // 카메라 제스처 → 보드 명령 매핑 (마지막 명령 sig 비교로 시리얼 포화 방지)
  const lastGestureSigRef = useRef<string>('');
  const [gestureStatus, setGestureStatus] = useState<string>('');   // 화면 진단
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  // 제안 칩 클릭 → input 에 채우고 textarea focus + 끝에 커서. 자동 전송 X — 학생이 추가 주문 작성.
  const onPickSuggestion = useCallback((chip: string) => {
    setInput((prev) => {
      const trimmed = prev.trim();
      // 이미 비슷하면 그냥 chip 만, 아니면 prev + " " + chip 으로 누적도 고려 가능. v1 = 그냥 chip 으로 교체.
      void trimmed;
      return chip;
    });
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  }, []);
  const abortRef = useRef<AbortController | null>(null);

  const isConnected = board.status === 'connected';

  const promptContext: PromptContext = useMemo(() => ({
    artwork,
    distanceReactivityEnabled: distanceReactivity,
    motorThresholds: cal.current.startThreshold,
    lastDistanceCm: board.lastDistanceCm,
  }), [artwork, distanceReactivity, cal, board.lastDistanceCm]);

  const sendPrompt = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || isGenerating) return;
    setIsGenerating(true);
    setStreamedText('');
    setProgram(null);
    setGenError(null);
    setInput('');

    // 사용자 메시지 history 에 즉시 추가 (낙관적 업데이트)
    const newHistory = [...history, { role: 'user' as const, content: prompt }];
    setHistory(newHistory);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: promptContext, history }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`AI 응답 실패: ${res.status} ${await res.text()}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamedText(acc);
      }
      const cleaned = acc.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        throw new Error(`JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}\n\n원문:\n${cleaned}`);
      }
      const valid = validateProgram(parsed);
      setProgram(valid);
      setHistory([...newHistory, { role: 'assistant', content: cleaned }]);
      void prefetchProgramAudio(valid);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGenerating(false);
    }
  };

  const onGenerate = () => sendPrompt(input);

  const onResetSession = () => {
    setHistory([]);
    setProgram(null);
    setStreamedText('');
    setGenError(null);
    setSayMessages([]);
    setInput('');
  };

  const onExecute = async () => {
    if (!program || isExecuting) return;
    if (!isConnected) {
      alert('보드를 먼저 연결해주세요.');
      return;
    }
    setIsExecuting(true);
    setSayMessages([]);
    setCurrentStepIndex(null);

    // intro 음성을 끝까지 await 한 뒤 첫 step 시작.
    // → "음성으로 먼저 설명 → 동작" 흐름을 학생 의도대로 강제.
    if (program.intro) {
      setSayMessages([{ text: stripAudioTags(program.intro), ts: Date.now() }]);
      await speakText(program.intro);
    }

    abortRef.current = new AbortController();
    await runProgram(program, {
      signal: abortRef.current.signal,
      onEvent: async (e: InterpreterEvent) => {
        if (e.type === 'step_start') setCurrentStepIndex(e.index);
        else if (e.type === 'step_end') setCurrentStepIndex(null);
        else if (e.type === 'say') {
          // UI 표시는 audio tag 제거. 음성은 원문 그대로 (오디오 태그 톤 반영).
          setSayMessages((s) => [...s, { text: stripAudioTags(e.text), ts: Date.now() }]);
          // ❗ 음성 끝까지 await — 인터프리터가 이 Promise 를 기다려 다음 step 으로.
          await speakText(e.text);
        }
        else if (e.type === 'play_sound') {
          playEffect(e.sound, e.volume);
        }
        else if (e.type === 'play_tune') {
          // 멜로디 재생. await_melody=true 면 멜로디 끝까지 대기 (interpreter 의 await 와 함께).
          const muted = useSoundStore.getState().muted;
          if (e.await_melody) {
            await playMelody(e.tune, e.tempo, muted);
          } else {
            void playMelody(e.tune, e.tempo, muted);
          }
        }
        else if (e.type === 'calibrate') {
          const msg = ({
            motor_individual_variance: '모터마다 시동 V 가 달라요. 안 돌면 + 로 한 칸씩 올려보세요.',
            motor_direction_mirror: '모터가 거꾸로 돌면 모터 카드의 [정방향/역방향] 버튼을 누르세요.',
            servo_power: '서보가 약해요. 9V 배터리가 꽂혀 있는지 확인해주세요.',
          })[e.reason];
          setSayMessages((s) => [...s, { text: `🔧 ${msg}`, ts: Date.now() }]);
        }
      },
    });
    setIsExecuting(false);
    setCurrentStepIndex(null);
    // 동작 끝나면 후속 제안으로 시선 끌기
    requestAnimationFrame(() => {
      suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const onStopExecution = async () => {
    abortRef.current?.abort();
    stopSpeaking();
    if (isConnected) { try { await board.send(GLOBAL.stopAll); } catch {} }
    setIsExecuting(false);
  };

  const onAdjustThreshold = (motor: MotorId, delta: 1 | -1) => {
    const cur = cal.current.startThreshold[motor];
    const next = Math.max(0, Math.min(9, cur + delta));
    if (next !== cur) cal.setStartThreshold(motor, next);
  };

  const onTestStart = async (motor: MotorId) => {
    if (!isConnected) return;
    const cfg = MOTORS[motor];
    const level = cal.current.startThreshold[motor];
    await board.send(`X${cfg.pwmIndex}${level}`);
    await new Promise((r) => setTimeout(r, 30));
    await board.send(cfg.forwardByte);
    setTimeout(() => { void board.send(GLOBAL.stopAll); }, 1000);
  };

  const onToggleDir = async (motor: MotorId) => {
    if (isConnected) await board.send(MOTORS[motor].dirToggleSeq);
    cal.toggleDir(motor);
  };

  // ▶ 스킬 실행 — built-in (Skill) 또는 custom (CustomSkill) 모두 처리.
  // user gesture chain 안에서 즉시 실행 → AudioContext.resume() 통과 → 멜로디 재생.
  const onRunSkill = (skill: Skill | CustomSkill) => {
    if (isExecuting) return;
    if (!isConnected) {
      alert('보드를 먼저 연결해주세요.');
      return;
    }
    abortRef.current?.abort();
    setProgram(skill.program);
    setInput(`${skill.emoji} ${skill.label}`);
    // 정교 sync 가 필요한 스킬은 execute 사용 (program 무시)
    if ('execute' in skill && typeof skill.execute === 'function') {
      void runSkillExecutor(skill);
    } else {
      void runProgramDirect(skill.program);
    }
  };

  // 스킬 executor 호출 — 음악-동작 sync 등 정교 제어.
  const runSkillExecutor = async (skill: Skill) => {
    if (!skill.execute) return;
    setIsExecuting(true);
    setSayMessages([]);
    setCurrentStepIndex(null);
    abortRef.current = new AbortController();
    const ctx = {
      send: (p: string) => useBoardStore.getState().send(p),
      delay: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      signal: abortRef.current.signal,
      speak: async (text: string) => {
        setSayMessages((s) => [...s, { text: stripAudioTags(text), ts: Date.now() }]);
        await speakText(text);
      },
      playMelody: (tune: string) => {
        const muted = useSoundStore.getState().muted;
        void playMelody(tune as Parameters<typeof playMelody>[0], 1.0, muted);
      },
      playEffect: (sound: string) => {
        playEffect(sound as Parameters<typeof playEffect>[0], 1.0);
      },
      setStatus: (text: string) => {
        setSayMessages((s) => {
          const last = s[s.length - 1];
          if (last && last.text.startsWith('🩰 ')) return [...s.slice(0, -1), { text, ts: Date.now() }];
          return [...s, { text, ts: Date.now() }];
        });
      },
    };
    try {
      await skill.execute(ctx);
    } catch (e) {
      console.warn('[skill executor] error', e);
      try { await ctx.send(GLOBAL.stopAll); } catch {}
    }
    setIsExecuting(false);
    setCurrentStepIndex(null);
    requestAnimationFrame(() => {
      suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // 💾 현재 program 을 내 스킬로 저장 — localStorage persist (4dframe-custom-skills)
  const onSaveSkill = () => {
    if (!program) return;
    const defaultLabel = stripAudioTags(program.intro ?? '').slice(0, 16) || '내 동작';
    const label = window.prompt('이 동작에 이름을 붙여줘! (1~16자)', defaultLabel);
    if (!label || label.trim().length === 0) return;
    const trimmed = label.trim().slice(0, 16);
    const emojiInput = window.prompt('이모지 하나 골라줘 (예: 🌟 🎯 💖 🚀)', '⭐');
    const emoji = (emojiInput?.trim() || '⭐').slice(0, 4);
    const saved = customSkills.add({
      artwork: (program.artwork ?? artwork ?? 'free') as NonNullable<PromptContext['artwork']>,
      label: trimmed,
      emoji,
      program,
    });
    // 진단 — 실제 localStorage 에 저장됐는지 확인
    const storeAfter = customSkills.skills;
    const lsRaw = typeof window !== 'undefined' ? window.localStorage.getItem('4dframe-custom-skills') : null;
    const lsCount = lsRaw ? (JSON.parse(lsRaw).state?.skills?.length ?? '?') : '없음';
    console.log('[save-skill]', { saved: saved.id, storeCount: storeAfter.length, lsCount, lsExists: !!lsRaw });
    alert(
      `저장 완료! "${emoji} ${trimmed}"\n\n` +
      `메모리: ${storeAfter.length}개 / localStorage: ${lsCount}개\n` +
      `(localStorage 가 "없음" 이면 시크릿 모드일 수 있어요)`
    );
  };

  // 외부에서 program 받아 즉시 실행 — 스킬 칩이 user gesture 안에서 호출.
  const runProgramDirect = async (prog: Program) => {
    if (isExecuting) return;
    setIsExecuting(true);
    setSayMessages([]);
    setCurrentStepIndex(null);

    // intro 음성 끝까지 await — "음성으로 먼저 → 동작" 흐름.
    if (prog.intro) {
      setSayMessages([{ text: stripAudioTags(prog.intro), ts: Date.now() }]);
      await speakText(prog.intro);
    }

    abortRef.current = new AbortController();
    await runProgram(prog, {
      signal: abortRef.current.signal,
      onEvent: async (e: InterpreterEvent) => {
        if (e.type === 'step_start') setCurrentStepIndex(e.index);
        else if (e.type === 'step_end') setCurrentStepIndex(null);
        else if (e.type === 'say') {
          setSayMessages((s) => [...s, { text: stripAudioTags(e.text), ts: Date.now() }]);
          await speakText(e.text);
        }
        else if (e.type === 'play_sound') playEffect(e.sound, e.volume);
        else if (e.type === 'play_tune') {
          const muted = useSoundStore.getState().muted;
          if (e.await_melody) await playMelody(e.tune, e.tempo, muted);
          else void playMelody(e.tune, e.tempo, muted);
        }
        else if (e.type === 'calibrate') {
          const msg = ({
            motor_individual_variance: '모터마다 시동 V 가 달라요. 안 돌면 + 로 한 칸씩 올려보세요.',
            motor_direction_mirror: '모터가 거꾸로 돌면 모터 카드의 [정방향/역방향] 버튼을 누르세요.',
            servo_power: '서보가 약해요. 9V 배터리가 꽂혀 있는지 확인해주세요.',
          })[e.reason];
          setSayMessages((s) => [...s, { text: `🔧 ${msg}`, ts: Date.now() }]);
        }
      },
    });
    setIsExecuting(false);
    setCurrentStepIndex(null);
    requestAnimationFrame(() => {
      suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  // 🎤 음성 입력 — MediaRecorder + 서버 STT (/api/stt → Gemini 2.5 Flash multimodal).
  //
  // 두 가지 모드:
  //   1. 🎤 단발 마이크 — 클릭 시 녹음 → 침묵 자동 종료 → input 에 텍스트 채움 (학생이 보내기 누름)
  //   2. 💬 대화모드 — ON 동안 자동 루프: 듣기 → 자동 보내기 → AI 응답 → 동작 실행 → 다시 듣기.
  //      유치원생도 손 안 대고 음성으로만 작품과 대화. (대화모드는 conversationModeRef 로 STT onstop 분기)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [listening, setListening] = useState(false);
  const [micStatus, setMicStatus] = useState<string>('');
  const [conversationMode, setConversationMode] = useState(false);
  // ref 들 — onstop closure 와 자동 흐름 effect 에서 stale state 회피
  const conversationModeRef = useRef(false);
  const listeningRef = useRef(false);
  useEffect(() => { conversationModeRef.current = conversationMode; }, [conversationMode]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  // sendPrompt 는 함수 선언이 위에 있지만 ref 로 stale 회피
  const sendPromptRef = useRef<(p: string) => Promise<void>>(() => Promise.resolve());
  useEffect(() => { sendPromptRef.current = sendPrompt; });

  const cleanupMic = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const stopMicRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') mr.stop();
  }, []);

  const startMicRecording = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (listeningRef.current) return; // 중복 시작 방지
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('이 브라우저는 음성 입력을 지원하지 않아요. 크롬/엣지/사파리 최신 버전을 써주세요!');
      return;
    }

    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        cleanupMic();
        setListening(false);
        const isConvo = conversationModeRef.current;
        if (blob.size < 2000) {
          // 대화모드일 땐 너무 짧은 녹음은 그냥 조용히 넘어가고 다음 effect 가 다시 시작
          if (!isConvo) {
            setMicStatus('너무 짧아요 — 다시 눌러 주세요');
            setTimeout(() => setMicStatus(''), 2000);
          } else {
            setMicStatus('');
          }
          return;
        }
        setMicStatus('🤔 듣고 있어요…');
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const res = await fetch('/api/stt', { method: 'POST', body: fd });
          const data: { text?: string; error?: string } = await res.json();
          if (!res.ok || data.error) {
            setMicStatus(`❌ ${data.error ?? '변환 실패'}`);
            setTimeout(() => setMicStatus(''), 3000);
            return;
          }
          const txt = (data.text ?? '').trim();
          if (!txt) {
            setMicStatus(isConvo ? '' : '🤷 들리는 말이 없었어요');
            if (!isConvo) setTimeout(() => setMicStatus(''), 2000);
            return;
          }
          if (isConvo) {
            // 대화모드 — 자동 보내기. input 에는 보여주기만 하고 sendPrompt 가 비움.
            setMicStatus('');
            setInput(txt);
            void sendPromptRef.current(txt);
          } else {
            // 단발 모드 — input 에 누적, 학생이 보내기 클릭
            setInput((prev) => (prev ? prev + ' ' : '') + txt);
            setMicStatus('');
            requestAnimationFrame(() => {
              textareaRef.current?.focus();
              const len = textareaRef.current?.value.length ?? 0;
              textareaRef.current?.setSelectionRange(len, len);
            });
          }
        } catch (e) {
          console.warn('[stt] fetch 실패', e);
          setMicStatus('❌ 변환 서버 오류');
          setTimeout(() => setMicStatus(''), 3000);
        }
      };

      mr.start();
      setListening(true);
      setMicStatus(conversationModeRef.current
        ? '👂 듣고 있어요… 말해 보세요!'
        : '🎤 말해 보세요… (멈추면 자동 변환)');

      // VAD — 침묵 자동 종료
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const recordingStart = Date.now();
      let lastSpokeAt = 0;
      const SPEECH_THRESHOLD = 18;
      const SILENCE_AFTER_SPEECH_MS = 1200;
      const MIN_RECORDING_MS = 800;
      // 대화모드는 30초 hard limit (학생이 길게 말할 수 있음), 단발은 15초
      const HARD_MAX_MS = conversationModeRef.current ? 30000 : 15000;

      const tick = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return;
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const now = Date.now();
        if (avg > SPEECH_THRESHOLD) lastSpokeAt = now;

        const elapsed = now - recordingStart;
        const silenceFor = lastSpokeAt > 0 ? now - lastSpokeAt : 0;

        if (
          (elapsed > MIN_RECORDING_MS && lastSpokeAt > 0 && silenceFor > SILENCE_AFTER_SPEECH_MS) ||
          elapsed > HARD_MAX_MS
        ) {
          if (mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
          return;
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch (e: unknown) {
      cleanupMic();
      setListening(false);
      const name = (e as Error)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicStatus('🚫 마이크 권한 차단됨');
        alert('마이크 권한이 차단되어 있어요. 자물쇠 아이콘 → 마이크 허용으로 바꿔주세요.');
      } else if (name === 'NotFoundError') {
        setMicStatus('🚫 마이크 장치 없음');
        alert('마이크 장치를 찾지 못했어요. 시스템 입력 장치를 확인해 주세요.');
      } else {
        setMicStatus(`❌ ${(e as Error)?.message ?? '시작 실패'}`);
      }
    }
  }, [cleanupMic]);

  const onMicToggle = useCallback(() => {
    if (listening) stopMicRecording();
    else void startMicRecording();
  }, [listening, startMicRecording, stopMicRecording]);

  const onConversationToggle = useCallback(() => {
    if (conversationMode) {
      setConversationMode(false);
      stopMicRecording();
    } else {
      setConversationMode(true);
      if (!listening) void startMicRecording();
    }
  }, [conversationMode, listening, startMicRecording, stopMicRecording]);

  // 💬 대화모드 자동 흐름 ① — program 생성되면 자동 실행 (학생이 ▶ 클릭 안 해도 됨)
  useEffect(() => {
    if (!conversationMode) return;
    if (!program || isExecuting) return;
    if (currentStepIndex !== null) return;
    if (!isConnected) return;
    const t = setTimeout(() => {
      if (conversationModeRef.current) void onExecute();
    }, 250);
    return () => clearTimeout(t);
    // onExecute 는 매 render 새 closure 지만 program 트리거에만 반응 — deps 단순.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationMode, program, isExecuting, isConnected]);

  // 💬 대화모드 자동 흐름 ② — 모든 게 idle 일 때 자동 다시 듣기
  useEffect(() => {
    if (!conversationMode) return;
    if (listening || isGenerating || isExecuting) return;
    const t = setTimeout(() => {
      if (conversationModeRef.current && !listeningRef.current) {
        void startMicRecording();
      }
    }, 700);
    return () => clearTimeout(t);
  }, [conversationMode, listening, isGenerating, isExecuting, startMicRecording]);

  // ⚙️ 설정 모달
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 🎯 서보 각도 — 펌웨어가 ±15도 increment 만 지원하므로 클라이언트에서 누적 추적.
  // 페이지 진입 시 펌웨어의 posA/posB (default 90도) 와 동기화 가정.
  const [servoA, setServoA] = useState(90);
  const [servoB, setServoB] = useState(90);
  const onServoAdjust = useCallback(async (axis: 'A' | 'B', delta: -15 | 15) => {
    if (!isConnected) return;
    const cmd = axis === 'A'
      ? (delta > 0 ? '%' : '5')
      : (delta > 0 ? '^' : '6');
    try { await board.send(cmd); } catch {}
    if (axis === 'A') setServoA((v) => Math.max(0, Math.min(180, v + delta)));
    else setServoB((v) => Math.max(0, Math.min(180, v + delta)));
  }, [isConnected, board]);
  // 90도(중앙) 로 복귀 — ±15도 단위로 여러 번 보냄
  const onServoCenter = useCallback(async (axis: 'A' | 'B') => {
    if (!isConnected) return;
    const cur = axis === 'A' ? servoA : servoB;
    const diff = 90 - cur;
    const steps = Math.round(diff / 15);
    for (let i = 0; i < Math.abs(steps); i++) {
      await onServoAdjust(axis, steps > 0 ? 15 : -15);
      await new Promise((r) => setTimeout(r, 80));
    }
  }, [isConnected, servoA, servoB, onServoAdjust]);

  // 작품 변경 시 이전 작품 메시지/프로그램/입력 초기화 (이전 멘트가 남는 버그 fix).
  // 자동차 작품 진입 시 직접 조종 자동 ON — OFF 누르면 카드/키보드 모두 진짜 꺼지도록 SSoT 일원화.
  const onArtworkChange = useCallback((next: PromptContext['artwork']) => {
    if (artwork === next) return;
    abortRef.current?.abort();
    setArtwork(next);
    setProgram(null);
    setInput('');
    setSayMessages([]);
    setCurrentStepIndex(null);
    if (next === 'car_4wd') setShowJoystick(true);
  }, [artwork]);

  // /play/identify 페이지에서 ?artwork=xxx 로 돌아오면 자동 선택. (window.location 으로 SSR 우회)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const a = new URLSearchParams(window.location.search).get('artwork');
    if (a && (['viking','car_4wd','swing','crocodile','ballerina','free'] as const).includes(a as never)) {
      setArtwork(a as PromptContext['artwork']);
      if (a === 'car_4wd') setShowJoystick(true);
    }
  }, []);

  // 🕹 직접 조종 — 차동 조향 (skid steering).
  // 좌/우 가상 모터 = 4WD 의 (M1+M3) / (M2+M4). 한 축 두 바퀴 자동차도 같은 매핑으로 직진/제자리회전.
  // PWM 개별 변조 (X{idx}{duty}) 는 v1.3+ 만 지원 → fw 자동 분기.
  // 🚨 deps 비움: useBoardStore.getState() 직접 호출 (zustand 의 비반응적 접근).
  // board 객체를 deps 에 넣으면 거리센서 cm 100ms 갱신마다 onJoystickMove 새 ref →
  // useEffect re-run → cleanup 의 stopAll 호출 → 키보드 누르고 있어도 끊어짐(타다다다).
  const lastJoyRef = useRef<{ t: number; signature: string }>({ t: 0, signature: '' });
  const onJoystickMove = useCallback((x: number, y: number, mag: number) => {
    const b = useBoardStore.getState();
    if (b.status !== 'connected') return;
    const now = Date.now();

    // 정지 명령 (mag=0) 은 throttle 우회 — 키 떼는 즉시 멈춰야 함
    if (mag === 0) {
      const sig = 'STOP';
      if (lastJoyRef.current.signature === sig) return;
      lastJoyRef.current = { t: now, signature: sig };
      void b.send(GLOBAL.stopAll);
      return;
    }

    if (now - lastJoyRef.current.t < 80) return;   // 80ms throttle

    // 화면 좌표 → 차동 조향. y 화면 아래가 양수, 우리는 forward = 위 = y<0.
    const fwd = -y;
    const turn = x;
    let left = fwd + turn;
    let right = fwd - turn;
    const norm = Math.max(Math.abs(left), Math.abs(right), 1);
    left /= norm; right /= norm;

    const v13 = isV13Plus(b.lastBoot?.fw);

    // ★ V level 은 조이스틱 거리(mag) 기반 — 조금 밀면 V3, 끝까지 밀면 V9.
    //   "조금 밀었을 때와 끝까지 밀었을 때 속도가 달라야" 직관 fix.
    //   좌/우 모터 ratio (left/right 부호+크기) 는 dir 와 한쪽 stop 여부로만 반영.
    const speedLevel = Math.max(1, Math.min(9, Math.round(mag * 9)));
    const lDir = left > 0.10 ? 1 : left < -0.10 ? -1 : 0;
    const rDir = right > 0.10 ? 1 : right < -0.10 ? -1 : 0;
    // 한 쪽이 정지면 그 쪽 PWM 0, 도는 쪽만 speedLevel.
    const lLevel = lDir !== 0 ? speedLevel : 0;
    const rLevel = rDir !== 0 ? speedLevel : 0;

    // 같은 명령 반복 송신 방지 (시리얼 포화 + 펌웨어 race 회피)
    const sig = `${lLevel}.${lDir}|${rLevel}.${rDir}`;
    if (lastJoyRef.current.signature === sig) return;
    lastJoyRef.current = { t: now, signature: sig };

    const cmds: string[] = [];
    if (v13) {
      cmds.push(`X1${lLevel}`, `X2${lLevel}`, `X0${rLevel}`, `X3${rLevel}`);
    }
    if (lLevel > 0 && lDir !== 0) {
      cmds.push(lDir > 0 ? '1' : '!');
      cmds.push(lDir > 0 ? '3' : '#');
    }
    if (rLevel > 0 && rDir !== 0) {
      cmds.push(rDir > 0 ? '2' : '@');
      cmds.push(rDir > 0 ? '4' : '$');
    }
    if (cmds.length > 0) void b.send(cmds.join(''));
  }, []);   // ★ deps 비움 — 이게 핵심 fix

  // 🖐 카메라 제스처 → 보드 명령. 학생이 매핑 store 에서 정한 동작 송신.
  // openness >= 0.65 = 활짝(hand_open), <= 0.3 = 주먹(hand_fist), 사이는 무시 (전이 영역).
  // sig 비교로 같은 명령 반복 송신 방지.
  const onCameraGesture = useCallback((g: { type: 'hand' | 'head_tilt'; openness?: number; fingerCount?: number; dx?: number }) => {
    if (g.type !== 'hand' || g.fingerCount === undefined || !Number.isFinite(g.fingerCount)) {
      setGestureStatus('🙅 손 인식 안 됨 — 카메라에 손 또렷이 보여주세요');
      return;
    }
    const fc = g.fingerCount;
    const key = fingerCountToKey(fc);
    const b = useBoardStore.getState();
    const meta = key ? GESTURE_LABELS[key] : null;
    const head = meta ? `${meta.emoji} ${meta.label}` : `손가락 ${fc}개`;

    if (b.status !== 'connected') {
      setGestureStatus(`${head} — 보드 미연결`);
      return;
    }
    if (!key) {
      setGestureStatus(head);
      return;
    }

    if (lastGestureSigRef.current === key) {
      setGestureStatus(`${head} · 유지`);
      return;
    }
    lastGestureSigRef.current = key;

    const mapping = useGestureMappingStore.getState().mapping;
    const action = actionById(mapping[key]);
    setGestureStatus(`${head} → ${action.emoji} ${action.label}`);
    console.log('[gesture]', key, '→', action.id, action.bytes);
    if (!action.bytes) return;
    void b.send(action.bytes);
  }, []);

  // ⌨️ 키보드 화살표 → 조이스틱 — 직접 조종 ON 또는 자동차 작품 시 활성.
  // textarea/input focus 중에는 무시 (입력 방해 X).
  useEffect(() => {
    const joystickActive = showJoystick;
    if (!joystickActive || !isConnected) return;

    const keysPressed = new Set<string>();
    const updateFromKeys = () => {
      const ax = (keysPressed.has('ArrowRight') ? 1 : 0) + (keysPressed.has('ArrowLeft') ? -1 : 0);
      const ay = (keysPressed.has('ArrowDown') ? 1 : 0) + (keysPressed.has('ArrowUp') ? -1 : 0);
      const len = Math.sqrt(ax * ax + ay * ay);
      if (len === 0) onJoystickMove(0, 0, 0);
      else onJoystickMove(ax / len, ay / len, 1);
    };
    const isInputFocused = () => {
      const ae = document.activeElement;
      const tag = (ae as HTMLElement)?.tagName;
      return tag === 'TEXTAREA' || tag === 'INPUT' || (ae as HTMLElement)?.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      if (isInputFocused()) return;
      e.preventDefault();
      if (!keysPressed.has(e.key)) {
        keysPressed.add(e.key);
        updateFromKeys();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      if (keysPressed.delete(e.key)) updateFromKeys();
    };
    const onBlur = () => {
      if (keysPressed.size > 0) {
        keysPressed.clear();
        onJoystickMove(0, 0, 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      // 조이스틱/작품 OFF 또는 페이지 떠날 때 모터 강제 정지 (안전)
      if (keysPressed.size > 0) {
        keysPressed.clear();
        onJoystickMove(0, 0, 0);
      }
    };
    // onJoystickMove 는 deps 비운 stable 콜백 — 여기 deps 에 넣어도 영향 없음.
    // showJoystick / artwork / isConnected 변경 시만 re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showJoystick, artwork, isConnected]);

  // 페이지 unmount 시 마이크 cleanup — MediaStream/AudioContext leak 방지
  useEffect(() => {
    return () => {
      cleanupMic();
    };
  }, [cleanupMic]);

  // 어디서든 Enter → textarea focus (조이스틱/일반 div 등에서 엔터 누르면 채팅창으로 이동).
  // textarea/input/contentEditable/button 안에서는 그쪽 onKeyDown 우선이라 무시.
  useEffect(() => {
    const onGlobalEnter = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return;
      const tag = ae.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON' || ae.isContentEditable) return;
      // body / div / section 등 일반 요소에서 Enter → textarea focus + 끝 커서
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    };
    window.addEventListener('keydown', onGlobalEnter);
    return () => window.removeEventListener('keydown', onGlobalEnter);
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: palette.bg,
        backgroundImage: 'radial-gradient(#E8E0CE 2px, transparent 2px)',
        backgroundSize: '30px 30px',
        color: palette.textMain,
        padding: 24,
        fontFamily: "'Nunito', system-ui, sans-serif",
        fontWeight: 600,
      }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 헤더 + 보드 연결 */}
        <header style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 48, height: 48, borderRadius: radius.sm,
            background: palette.secondary, border: border.brutal,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>4D</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>4D프레임 AI 짝코더</h1>
            <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
              내가 만든 작품을 말로 움직여 보세요.
            </div>
          </div>
          {/* 거리센서 미니 위젯 — 보드 연결 시만 노출. 클릭하면 거리 반응 모드 토글. */}
          {isConnected && (
            <button
              onClick={() => setDistanceReactivity((v) => !v)}
              title={distanceReactivity
                ? '거리 반응 모드 ON — AI 가 거리에 반응해요. 클릭하면 끔.'
                : '거리 반응 모드 OFF — 클릭하면 켬'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: distanceReactivity ? palette.accent : palette.tilePink,
                border: border.brutal, borderRadius: radius.sm,
                padding: '6px 10px', boxShadow: shadow.brutalSm,
                fontWeight: 800, fontSize: 13,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              <span>{distanceReactivity ? '👀' : '🙈'}</span>
              <span style={{ minWidth: 32, textAlign: 'right' }}>
                {board.lastDistanceCm ?? '—'}
              </span>
              <span style={{ fontSize: 11, color: palette.textMuted }}>cm</span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: distanceReactivity ? palette.textMain : palette.textMuted,
                marginLeft: 2,
              }}>
                {distanceReactivity ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          {!isConnected ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => board.connect()}
                title="USB 케이블로 연결 (PC/노트북)"
                style={{ ...btn(palette.tertiary, '#fff'), padding: '8px 12px', fontSize: 13 }}
                disabled={board.status === 'requesting' || board.status === 'opening'}
              >
                {board.status === 'requesting' ? '선택 중…' :
                 board.status === 'opening' ? '연결 중…' : '🔌 USB'}
              </button>
              <button
                onClick={() => board.connectBle()}
                title="블루투스로 연결 (휴대폰/PC, 보드의 BLE 모듈 LED 깜박이는지 확인)"
                style={{ ...btn(palette.accent, palette.textMain), padding: '8px 12px', fontSize: 13 }}
                disabled={board.status === 'requesting' || board.status === 'opening'}
              >
                📶 블루투스
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                {board.lastBoot ? `FW${board.lastBoot.fw}` : 'connected'}
              </span>
              <button onClick={() => board.disconnect()} style={{ ...btn(palette.primary, '#fff'), padding: '6px 10px', fontSize: 12 }}>끊기</button>
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            title="설정 (모터 길들이기 / 거리 반응)"
            style={{
              fontFamily: 'inherit', fontSize: 18,
              width: 38, height: 38,
              background: palette.panel, border: border.brutal, borderRadius: '50%',
              cursor: 'pointer', boxShadow: shadow.brutalSm,
            }}
          >
            ⚙️
          </button>
        </header>

        {board.errorMessage && (
          <div style={{ ...card, background: '#FFE6E6', borderColor: palette.primary }}>
            <strong style={{ color: palette.primary }}>오류:</strong> {board.errorMessage}
          </div>
        )}

        {/* 🛠 도구 바 — 작품과 무관한 글로벌 토글들 */}
        <section style={{
          ...card, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginRight: 4 }}>
            🛠 도구
          </span>
          {/* 💬 대화모드 — 학생이 가장 자주 켤 핵심 버튼이라 첫 자리. */}
          <button
            onClick={onConversationToggle}
            title={conversationMode
              ? '대화모드 ON — 말하면 자동 실행. 끄려면 클릭.'
              : '대화모드 켜기 — 말로 모든 걸 시키기 (유치원생 OK)'}
            style={{
              fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
              background: conversationMode ? palette.primary : palette.tilePink,
              color: conversationMode ? '#fff' : palette.textMain,
              border: border.brutal, borderRadius: radius.sm,
              padding: '8px 14px', cursor: 'pointer',
              boxShadow: shadow.brutalSm,
              animation: conversationMode ? 'pulse 1.4s ease-in-out infinite' : 'none',
            }}
          >
            💬 대화모드 {conversationMode ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => sound.toggleMute()}
            title={sound.muted ? '소리 켜기' : '소리 끄기'}
            style={{
              fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
              background: sound.muted ? palette.tilePink : palette.tileBlue,
              border: border.brutal, borderRadius: radius.sm,
              padding: '8px 12px', cursor: 'pointer',
              boxShadow: shadow.brutalSm,
            }}
          >
            {sound.muted ? '🔇 소리 꺼짐' : '🔊 소리 켜짐'}
          </button>
          <Link
            href="/play/identify"
            title="작품을 직접 카메라로 찍어 보여주면 AI 가 알아맞혀요"
            style={{
              ...btn(palette.tileBlue, palette.textMain),
              padding: '8px 12px', fontSize: 13, textDecoration: 'none',
            }}
          >
            📷 사진으로 알려줄게
          </Link>
          <button
            onClick={() => setShowJoystick((v) => !v)}
            title="조이스틱으로 직접 조종"
            style={{
              ...btn(showJoystick ? palette.tertiary : palette.tileBlue,
                     showJoystick ? '#fff' : palette.textMain),
              padding: '8px 12px', fontSize: 13,
            }}
          >
            🕹 직접 조종 {showJoystick ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => setShowCamera((v) => !v)}
            title="손 동작으로 조종 — 손 활짝 펴면 빠르게, 주먹 쥐면 정지"
            style={{
              ...btn(showCamera ? palette.tertiary : palette.tileBlue,
                     showCamera ? '#fff' : palette.textMain),
              padding: '8px 12px', fontSize: 13,
            }}
          >
            🖐 손 동작 {showCamera ? 'ON' : 'OFF'}
          </button>
        </section>

        {/* 🎨 작품 카드 — 작품 선택 + 바로 실행 + 내 스킬 (학생용 핵심) */}
        <section style={card}>
          <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 6, fontWeight: 700 }}>
            🎨 내 작품
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ARTWORKS.map((a) => (
              <button
                key={a.id}
                onClick={() => onArtworkChange(a.id)}
                style={{
                  ...btn(artwork === a.id ? palette.tertiary : palette.panel,
                          artwork === a.id ? '#fff' : palette.textMain),
                  padding: '6px 10px', fontSize: 13,
                }}
              >
                {a.emoji} {a.label}
              </button>
            ))}
          </div>
          {/* 스킬 칩 — 작품 선택 시 즉시 실행 가능한 standard 동작. AI 안 거침. */}
          {skillsForArtwork(artwork).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <span style={{ fontSize: 11, color: palette.textMuted, alignSelf: 'center' }}>
                바로 실행 ▶
              </span>
              {skillsForArtwork(artwork).map((s) => (
                <button
                  key={s.id}
                  onClick={() => onRunSkill(s)}
                  disabled={!isConnected || isExecuting}
                  title={s.description}
                  style={{
                    ...btn(palette.tilePink, palette.textMain),
                    padding: '6px 10px', fontSize: 12,
                    opacity: (!isConnected || isExecuting) ? 0.4 : 1,
                  }}
                >
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          )}

          {/* 내 스킬 칩 — 학생이 저장한 커스텀 동작 */}
          {customSkills.skills.filter((s) => s.artwork === artwork).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: palette.textMuted, alignSelf: 'center' }}>
                💖 내 스킬
              </span>
              {customSkills.skills.filter((s) => s.artwork === artwork).map((s) => (
                <span key={s.id} style={{ position: 'relative', display: 'inline-flex' }}>
                  <button
                    onClick={() => onRunSkill(s)}
                    disabled={!isConnected || isExecuting}
                    style={{
                      ...btn(palette.accent, palette.textMain),
                      padding: '6px 24px 6px 10px', fontSize: 12,
                      opacity: (!isConnected || isExecuting) ? 0.4 : 1,
                    }}
                  >
                    {s.emoji} {s.label}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm(`"${s.emoji} ${s.label}" 지울까?`)) customSkills.remove(s.id); }}
                    title="삭제"
                    style={{
                      position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                      width: 16, height: 16, fontSize: 10, lineHeight: 1,
                      background: 'transparent', border: 'none',
                      color: palette.textMuted, cursor: 'pointer',
                    }}
                  >✕</button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* 🕹 직접 조종 — 토글 ON 시 노출 (자동차 작품 진입 시 자동 ON, OFF 누르면 진짜 꺼짐). */}
        {showJoystick && (
          <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 4 }}>🕹 직접 조종</div>
              <div style={{ fontSize: 11, color: palette.textMuted, lineHeight: 1.4 }}>
                위/아래 = 전후진<br/>
                좌/우 = 회전<br/>
                대각선 = 속도+회전<br/>
                <strong>⌨️ 화살표 키도 OK</strong>
              </div>
            </div>
            <Joystick
              onMove={onJoystickMove}
              disabled={!isConnected}
              colors={{
                primary: palette.primary,
                primaryLight: palette.tilePink,
                border: palette.textMain,
                textMuted: palette.textMuted,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: palette.textMuted }}>
                ※ AI 와 동시에 사용해도 됩니다. 조이스틱이 가장 마지막에 보낸 명령이 이김.
              </div>
            </div>
          </section>
        )}

        {/* 🖐 손 동작 인식 — 카메라 켜고 손 펼침 정도로 보드 조종 */}
        {showCamera && (
          <section style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 320px' }}>
              <CameraPanel
                onGesture={onCameraGesture}
                colors={{
                  primary: palette.primary,
                  primaryDark: palette.textMain,
                  primaryLight: palette.tilePink,
                  border: palette.textMain,
                  accent: palette.accent,
                  textMuted: palette.textMuted,
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>🖐 손가락 개수로 조종</div>

              {/* 실시간 진단 — 손가락 N개 + 매핑된 동작 */}
              <div style={{
                fontSize: 14, fontWeight: 800,
                background: gestureStatus.includes('보드 미연결') ? '#FFE6E6' : palette.tileBlue,
                border: border.brutal, borderRadius: radius.sm,
                padding: '10px 12px',
                minHeight: 44,
              }}>
                {gestureStatus || '🖐 손을 카메라에 비춰주세요'}
              </div>

              {/* 기본 매핑 미리보기 — 항상 보임 (학생이 어떤 손가락 → 어떤 동작인지 즉시 인지) */}
              <div style={{ fontSize: 12, color: palette.textMuted, fontWeight: 700 }}>기본 동작</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                {(['finger_0', 'finger_1', 'finger_2', 'finger_3', 'finger_4', 'finger_5'] as const).map((k) => {
                  const action = actionById(gestureMapping.mapping[k]);
                  const meta = GESTURE_LABELS[k];
                  return (
                    <div key={k} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      fontSize: 11, padding: '3px 6px',
                      background: palette.bg, borderRadius: 4,
                    }}>
                      <span>{meta.emoji}</span>
                      <span style={{ color: palette.textMuted }}>→</span>
                      <span style={{ fontWeight: 700 }}>{action.emoji} {action.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* 고급 매핑 — 기본 접힘. 클릭 시 펼침 */}
              <button
                onClick={() => setShowMappingAdvanced((v) => !v)}
                style={{
                  alignSelf: 'flex-start', fontSize: 11, color: palette.textMuted,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textDecoration: 'underline', padding: 0, marginTop: 4,
                }}
              >
                {showMappingAdvanced ? '▲ 매핑 닫기' : '⚙️ 고급 — 매핑 바꾸기'}
              </button>
              {showMappingAdvanced && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {(['finger_0', 'finger_1', 'finger_2', 'finger_3', 'finger_4', 'finger_5'] as const).map((k) => (
                    <GestureMapRow
                      key={k}
                      emoji={GESTURE_LABELS[k].emoji}
                      label={GESTURE_LABELS[k].label}
                      gesture={k}
                      value={gestureMapping.mapping[k]}
                      onChange={(v) => gestureMapping.setMapping(k, v)}
                      colors={palette}
                    />
                  ))}
                  <button
                    onClick={() => gestureMapping.reset()}
                    style={{
                      alignSelf: 'flex-start', fontSize: 11, color: palette.textMuted,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      textDecoration: 'underline', padding: 0,
                    }}
                  >
                    기본으로 되돌리기
                  </button>
                </div>
              )}
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 4 }}>
                ※ 처음엔 모델 다운로드 살짝 느려요.
              </div>
            </div>
          </section>
        )}

        {/* 자연어 입력 */}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>
              💬 짝코더와 이야기하기
              {history.length > 0 && (
                <span style={{ fontSize: 11, color: palette.textMuted, marginLeft: 8, fontWeight: 600 }}>
                  · 이번 세션 {Math.floor(history.length / 2) + (history.length % 2)}턴
                </span>
              )}
            </div>
            {history.length > 0 && (
              <button
                onClick={onResetSession}
                style={{
                  fontFamily: 'inherit', fontWeight: 700, fontSize: 11,
                  background: palette.panel, border: border.brutal, borderRadius: radius.sm,
                  padding: '4px 10px', cursor: 'pointer',
                }}
              >🔄 새로 시작</button>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter = 실행. Shift+Enter = 줄바꿈.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!isGenerating && input.trim().length > 0) {
                    void onGenerate();
                  }
                }
              }}
              placeholder={listening ? '듣고 있어요…' : '예: 악어가 앙 물게 해주세요  (엔터로 실행)'}
              disabled={isGenerating}
              style={{
                width: '100%',
                minHeight: 80,
                fontFamily: 'inherit',
                fontSize: 15,
                fontWeight: 600,
                padding: 12,
                paddingRight: 56,   // 마이크 버튼 자리
                border: border.brutal,
                borderRadius: radius.sm,
                background: listening ? '#FFE6E6' : palette.bg,
                boxShadow: shadow.brutalSm,
                resize: 'vertical',
              }}
            />
            <button
              onClick={onMicToggle}
              disabled={isGenerating}
              title={listening ? '듣기 멈춤' : '음성으로 말하기'}
              style={{
                position: 'absolute', top: 8, right: 8,
                width: 40, height: 40, fontSize: 20,
                background: listening ? palette.primary : palette.tileBlue,
                color: listening ? '#fff' : palette.textMain,
                border: border.brutal, borderRadius: '50%',
                cursor: 'pointer', boxShadow: shadow.brutalSm,
                animation: listening ? 'pulse 1.2s ease-in-out infinite' : 'none',
              }}
            >
              {listening ? '⏸' : '🎤'}
            </button>
          </div>
          <style jsx>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.08); }
            }
          `}</style>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button
              onClick={onGenerate}
              disabled={isGenerating || input.trim().length === 0}
              style={{
                ...btn(palette.primary, '#fff'),
                opacity: (isGenerating || input.trim().length === 0) ? 0.5 : 1,
              }}
            >
              {isGenerating ? '생각 중…' : '🪄 보내기 (엔터)'}
            </button>
            {micStatus && (
              <span style={{
                fontSize: 11, color: palette.textMain,
                background: palette.tilePink, border: border.brutal, borderRadius: 999,
                padding: '4px 10px', fontWeight: 700,
              }}>{micStatus}</span>
            )}
            <span style={{ fontSize: 11, color: palette.textMuted }}>또는 예시 누르기:</span>
            {SAMPLE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setInput(p)}
                disabled={isGenerating}
                style={{
                  fontFamily: 'inherit', fontSize: 11,
                  background: palette.tileBlue, border: border.brutal, borderRadius: radius.sm,
                  padding: '4px 8px', cursor: 'pointer',
                }}
              >{p}</button>
            ))}
          </div>
        </section>

        {/* AI 마지막 한마디 — program 무관 항상 노출 (실행 중 멘트가 가려지지 않게) */}
        {sayMessages.length > 0 && (
          <section style={{
            ...card,
            background: palette.accent,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 22 }}>💬</span>
            <div style={{ flex: 1, fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
              {sayMessages[sayMessages.length - 1].text}
            </div>
            <button
              onClick={() => setSayMessages([])}
              title="닫기"
              style={{
                fontSize: 11, color: palette.textMuted,
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >✕</button>
          </section>
        )}

        {/* AI 응답 영역 — 단순화: intro + 실행/제안. 디테일은 토글. */}
        {(isGenerating || streamedText || program || genError) && (
          <section style={card}>
            {genError ? (
              <div style={{ background: '#FFE6E6', border: border.brutal, borderRadius: radius.sm, padding: 12, fontSize: 13 }}>
                <strong style={{ color: palette.primary }}>오류:</strong>
                <pre style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {genError}
                </pre>
              </div>
            ) : program ? (
              <div>
                {/* 시작 한마디 (intro) */}
                {program.intro && (
                  <div style={{ background: palette.tileBlue, border: border.brutal, borderRadius: radius.sm, padding: 12, marginBottom: 10, fontSize: 14, fontWeight: 700 }}>
                    💭 {stripAudioTags(program.intro)}
                  </div>
                )}

                {program.steps.length === 0 && (
                  <div style={{ fontSize: 13, color: palette.textMuted, fontStyle: 'italic', marginBottom: 10 }}>
                    (먼저 물어볼게요. 아래 칩을 누르거나 답해주세요.)
                  </div>
                )}

                {/* 실행 / 정지 버튼 — 가장 큰 액션, 위로 */}
                {program.steps.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {!isExecuting ? (
                      <button onClick={onExecute} disabled={!isConnected} style={{ ...btn(palette.tertiary, '#fff'), fontSize: 16, padding: '10px 20px' }}>
                        ▶ 실행
                      </button>
                    ) : (
                      <button onClick={onStopExecution} style={{ ...btn(palette.primary, '#fff'), fontSize: 16, padding: '10px 20px' }}>⏹ 정지</button>
                    )}
                    <span style={{ fontSize: 12, color: palette.textMuted }}>
                      동작 {program.steps.length}개 준비됨
                    </span>
                    <button
                      onClick={onSaveSkill}
                      disabled={isExecuting}
                      title="이 동작을 내 스킬로 저장"
                      style={{
                        fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
                        background: palette.accent, color: palette.textMain,
                        border: border.brutal, borderRadius: radius.sm,
                        padding: '6px 10px', cursor: 'pointer',
                        boxShadow: shadow.brutalSm,
                        opacity: isExecuting ? 0.4 : 1,
                      }}
                    >
                      💾 내 스킬로 저장
                    </button>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={() => setShowTrace((v) => !v)}
                      style={{
                        fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                        background: 'transparent', border: 'none',
                        color: palette.textMuted, cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      {showTrace ? '▲ 실행 과정 숨기기' : '▼ 실행 과정 보기'}
                    </button>
                  </div>
                )}

                {/* 다음 동작 제안 (variation_chips) — 동작 종료 후 큰 카드로 강조. */}
                {program.variation_chips && program.variation_chips.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    style={{
                      marginBottom: 10,
                      background: !isExecuting && currentStepIndex === null && program.steps.length > 0
                        ? palette.tilePink   // 실행 끝났을 때 강조
                        : palette.bg,
                      border: border.brutal, borderRadius: radius.sm,
                      padding: 12,
                      transition: 'background 0.3s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>
                      ✨ 이어서 이런 거 어때?  <span style={{ fontSize: 10, color: palette.textMuted, fontWeight: 600 }}>(눌러서 더 적어봐)</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {program.variation_chips.map((chip, i) => (
                        <button
                          key={i}
                          onClick={() => onPickSuggestion(chip)}
                          disabled={isGenerating}
                          style={{
                            fontFamily: 'inherit', fontWeight: 800, fontSize: 14,
                            background: palette.secondary,
                            border: border.brutal, borderRadius: 999,
                            padding: '8px 16px', cursor: 'pointer',
                            boxShadow: shadow.brutalSm,
                          }}
                        >{chip}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 짝코더가 물어보는 질문 */}
                {program.questions && program.questions.length > 0 && (
                  <div style={{
                    background: palette.tilePink,
                    border: border.brutal, borderRadius: radius.sm,
                    padding: 12, marginBottom: 10,
                    boxShadow: shadow.brutalSm,
                  }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>🤔 같이 정해볼까?</div>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {program.questions.map((q, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 실행 과정 — 토글로 펼침. 기본 닫힘. */}
                {showTrace && program.steps.length > 0 && (
                  <ol style={{ paddingLeft: 0, listStyle: 'none', margin: '12px 0 0' }}>
                    {program.steps.map((step, i) => {
                      const active = currentStepIndex === i;
                      return (
                        <li
                          key={i}
                          style={{
                            padding: '6px 10px',
                            marginBottom: 4,
                            borderRadius: radius.sm,
                            border: border.brutal,
                            background: active ? palette.secondary : palette.bg,
                            fontWeight: active ? 900 : 500,
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <span style={{ fontSize: 14 }}>{stepIcon[step.do]}</span>
                          <span style={{ color: palette.textMuted, minWidth: 22 }}>#{i + 1}</span>
                          <span>{describeStep(step)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            ) : (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: palette.textMuted, whiteSpace: 'pre-wrap' }}>
                {streamedText || '생각 중…'}
              </div>
            )}
          </section>
        )}

        {/* 모터 캘리브 + 거리 반응 = 설정 모달로 이동 (아래 backdrop) */}

      </div>

      {/* ⚙️ 설정 모달 — backdrop + 가운데 카드 */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              ...card,
              width: '100%', maxWidth: 720, maxHeight: '90vh',
              overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>⚙️</span>
              <strong style={{ fontSize: 16 }}>설정</strong>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 800,
                  background: palette.panel, border: border.brutal, borderRadius: radius.sm,
                  padding: '4px 10px', cursor: 'pointer',
                }}
              >닫기 ✕</button>
            </div>

            {/* 거리 반응 모드 */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              background: distanceReactivity ? palette.accent : palette.tilePink,
              border: border.brutal, borderRadius: radius.sm, padding: '12px 14px',
              boxShadow: shadow.brutalSm,
            }}>
              <input
                type="checkbox"
                checked={distanceReactivity}
                onChange={(e) => setDistanceReactivity(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>👀 거리 반응 모드</div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                  AI 가 앞에 있는 물체와의 거리에 따라 동작을 바꿔요.
                </div>
              </div>
              <div style={{ fontWeight: 900, fontSize: 22, minWidth: 60, textAlign: 'right' }}>
                {board.lastDistanceCm ?? '—'} <span style={{ fontSize: 11, color: palette.textMuted }}>cm</span>
              </div>
            </label>

            {/* 모터 길들이기 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔧 모터 길들이기 (어른용)</div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 10 }}>
                ▶ 시동 눌러보고, 안 돌면 + 로 한 칸씩 올려보세요. 천천히/보통/빠르게 매핑이 즉시 갱신됩니다.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {MOTOR_IDS.map((id) => {
                  const dir = cal.current.dirOverride[id];
                  const v = cal.current.startThreshold[id];
                  return (
                    <div key={id} style={{
                      ...card,
                      background: dir === 1 ? palette.accent : palette.tilePink,
                      padding: 10, gap: 6,
                      display: 'flex', flexDirection: 'column',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 900, fontSize: 14 }}>{id}</span>
                        <button
                          onClick={() => onToggleDir(id)}
                          style={{
                            fontFamily: 'inherit', fontWeight: 700, fontSize: 10,
                            background: palette.panel, border: border.brutal, borderRadius: radius.sm,
                            padding: '2px 5px', cursor: 'pointer',
                          }}
                        >{dir === 1 ? '정' : '역'}</button>
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: palette.textMuted, marginTop: 2 }}>시동</div>
                      <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 22, lineHeight: 1 }}>V{v}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                        <button onClick={() => onAdjustThreshold(id, -1)} disabled={v <= 0}
                          style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: palette.panel, border: border.brutal, borderRadius: radius.sm, padding: '3px 0', cursor: 'pointer', opacity: v <= 0 ? 0.4 : 1 }}>−</button>
                        <button onClick={() => onAdjustThreshold(id, +1)} disabled={v >= 9}
                          style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: palette.panel, border: border.brutal, borderRadius: radius.sm, padding: '3px 0', cursor: 'pointer', opacity: v >= 9 ? 0.4 : 1 }}>+</button>
                      </div>
                      <button onClick={() => onTestStart(id)} disabled={!isConnected || isExecuting}
                        style={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 11, background: palette.tertiary, color: '#fff', border: border.brutal, borderRadius: radius.sm, padding: '5px 0', cursor: 'pointer', opacity: (!isConnected || isExecuting) ? 0.5 : 1 }}>
                        ▶ 시동
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 🎯 서보 각도 캘리브레이션 — 악어 입(SA), 꼬리(SB) ±15도 미세 조정 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🎯 서보 각도 (어른용)</div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 10 }}>
                악어 입(SA), 꼬리(SB) 각도를 ±15도 단위로 조정. 90도 = 중립.
                값은 보드 재부팅하면 90도 로 초기화됩니다.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([
                  { axis: 'A' as const, label: 'SA — 악어 입 / 입 같은 부분', value: servoA },
                  { axis: 'B' as const, label: 'SB — 꼬리 / 흔드는 부분', value: servoB },
                ]).map(({ axis, label, value }) => (
                  <div key={axis} style={{
                    ...card,
                    background: palette.tilePink,
                    padding: 10, gap: 6,
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ fontSize: 11, color: palette.textMuted, lineHeight: 1.3 }}>{label}</div>
                    <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 26, lineHeight: 1 }}>{value}°</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <button
                        onClick={() => void onServoAdjust(axis, -15)}
                        disabled={!isConnected || value <= 0}
                        style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: palette.panel, border: border.brutal, borderRadius: radius.sm, padding: '4px 0', cursor: 'pointer', opacity: (!isConnected || value <= 0) ? 0.4 : 1 }}
                      >−15°</button>
                      <button
                        onClick={() => void onServoAdjust(axis, +15)}
                        disabled={!isConnected || value >= 180}
                        style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: palette.panel, border: border.brutal, borderRadius: radius.sm, padding: '4px 0', cursor: 'pointer', opacity: (!isConnected || value >= 180) ? 0.4 : 1 }}
                      >+15°</button>
                    </div>
                    <button
                      onClick={() => void onServoCenter(axis)}
                      disabled={!isConnected || value === 90}
                      style={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 11, background: palette.tertiary, color: '#fff', border: border.brutal, borderRadius: radius.sm, padding: '5px 0', cursor: 'pointer', opacity: (!isConnected || value === 90) ? 0.5 : 1 }}
                    >
                      90° 중앙
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 거리 그래프 */}
            {isConnected && (
              <div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 6 }}>
                  거리 시각화 (0~75cm 범위)
                </div>
                <div style={{
                  height: 12, borderRadius: 6, background: palette.bg, border: border.brutal, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(100, ((board.lastDistanceCm ?? 0) / 75) * 100)}%`,
                    background: palette.tertiary,
                    transition: `width ${m.fast}`,
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function btn(bg: string, fg: string): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontWeight: 800,
    border: border.brutal,
    borderRadius: radius.sm,
    background: bg,
    color: fg,
    padding: '8px 14px',
    cursor: 'pointer',
    boxShadow: shadow.brutalSm,
  };
}
