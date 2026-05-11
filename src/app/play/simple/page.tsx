'use client';

// 학생용 단순 모드 — 디자인 이미지 그대로 구현.
// 좌측: 로고 + 나만의 AI 스킬 (3개) + AI 기본 스킬 (C/O/P)
// 우측: 프로젝트 + 컨트롤 보드 + 입력 박스 + 캐릭터 메시지
//
// 고급 기능 (조이스틱/카메라/사진 인식/캘리브 등) 은 /play 어드밴스드 모드.
// 학생은 여기에 머물고, 어른만 좌하단 링크로 advanced 진입.

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { skillsForArtwork, type Skill } from '@/lib/skills/library';
import { useCustomSkillsStore, type CustomSkill } from '@/lib/skills/customStore';
import { useBoardStore } from '@/lib/serial/webSerial';
import { useCalibrationStore } from '@/lib/calibration/store';
import { runProgram, type InterpreterEvent } from '@/lib/dsl/interpreter';
import { validateProgram, type Program } from '@/lib/dsl/schema';
import type { PromptContext } from '@/lib/ai/systemPrompt';
import { useSoundStore, playEffect, speakText, stripAudioTags, prefetchProgramAudio } from '@/lib/sound/soundManager';
import { playMelody } from '@/lib/sound/melodySynth';
import { GLOBAL, isV13Plus, MOTORS } from '@/lib/commands/commands';
import type { MotorId } from '@/lib/dsl/schema';
import { useI18nStore } from '@/lib/i18n/store';
import { LOCALES } from '@/lib/i18n/dict';
import { Joystick } from '@/components/play/Joystick';
import { CameraPanel } from '@/components/play/CameraPanel';
import { useGestureMappingStore, actionById, fingerCountToKey, GESTURE_LABELS } from '@/lib/gestures/mappingStore';

const ARTWORKS: Array<{ id: NonNullable<PromptContext['artwork']>; tKey: string; emoji: string }> = [
  { id: 'free',      tKey: 'artwork.free',      emoji: '🛠️' },
  { id: 'viking',    tKey: 'artwork.viking',    emoji: '🚣' },
  { id: 'car_4wd',   tKey: 'artwork.car_4wd',   emoji: '🚗' },
  { id: 'swing',     tKey: 'artwork.swing',     emoji: '🎠' },
  { id: 'crocodile', tKey: 'artwork.crocodile', emoji: '🐊' },
  { id: 'ballerina', tKey: 'artwork.ballerina', emoji: '🩰' },
];

const C = {
  sideBg: '#9BE4E1',
  mainBg: '#FFF3DF',
  dotColor: '#94DDDF',
  purple: '#3F087F',
  purpleLight: '#6B4FBE',
  yellow: '#FFEF35',
  orange: '#FFC391',
  pink: '#FFC9F5',
  mint: '#DDF8EF',
  textDark: '#110514',
  textMuted: '#6B4A88',
  greenOn: '#B6EBB0',
  greetingTeal: '#88E8E6',
};

const SKILL_BG = [C.orange, C.pink, C.mint];
const MOTOR_IDS: MotorId[] = ['M1', 'M2', 'M3', 'M4'];

export default function SimplePlayPage() {
  // === Stores ===
  const board = useBoardStore();
  const customSkillsStore = useCustomSkillsStore();
  const cal = useCalibrationStore();
  const { locale, setLocale, t } = useI18nStore();

  // === State ===
  const [artwork, setArtwork] = useState<NonNullable<PromptContext['artwork']>>('crocodile');
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [projectOpen, setProjectOpen] = useState(false);
  // 거리 반응 모드 — AI 가 거리센서 값에 반응하는 program 생성 가능 (sendPrompt context 에 전달)
  const [distanceReactivity, setDistanceReactivity] = useState(false);
  // 설정 모달 (부모용)
  const [settingsOpen, setSettingsOpen] = useState(false);

  // === Refs ===
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  // 마지막 실행한 program — save_skill step 이 이 program 을 customSkill 로 저장
  const lastProgramRef = useRef<Program | null>(null);

  // === Connected flag (effect deps 용 — Computed 보다 먼저 필요) ===
  const isConnectedEarly = board.status === 'connected';

  // === Joystick (자동차 작품 시 자동 노출) ===
  const lastJoyRef = useRef<{ t: number; signature: string }>({ t: 0, signature: '' });
  const onJoystickMove = useCallback((x: number, y: number, mag: number) => {
    const b = useBoardStore.getState();
    if (b.status !== 'connected') return;
    const now = Date.now();
    if (mag === 0) {
      const sig = 'STOP';
      if (lastJoyRef.current.signature === sig) return;
      lastJoyRef.current = { t: now, signature: sig };
      void b.send(GLOBAL.stopAll);
      return;
    }
    if (now - lastJoyRef.current.t < 80) return;
    const fwd = -y;
    const turn = x;
    let left = fwd + turn, right = fwd - turn;
    const norm = Math.max(Math.abs(left), Math.abs(right), 1);
    left /= norm; right /= norm;
    const v13 = isV13Plus(b.lastBoot?.fw);
    const speedLevel = Math.max(1, Math.min(9, Math.ceil(mag * 9 - 1e-6)));
    const lDir = left > 0.10 ? 1 : left < -0.10 ? -1 : 0;
    const rDir = right > 0.10 ? 1 : right < -0.10 ? -1 : 0;
    const lLevel = lDir !== 0 ? speedLevel : 0;
    const rLevel = rDir !== 0 ? speedLevel : 0;
    const sig = `${lLevel}.${lDir}|${rLevel}.${rDir}`;
    if (lastJoyRef.current.signature === sig) return;
    lastJoyRef.current = { t: now, signature: sig };
    const cmds: string[] = [];
    // 차동 조향 — 회로도 (5/11 PM) 기준 좌=M1+M2 (LF+LB), 우=M3+M4 (RF+RB).
    if (v13) cmds.push(`X0${lLevel}`, `X1${lLevel}`, `X2${rLevel}`, `X3${rLevel}`);
    if (lLevel > 0 && lDir !== 0) cmds.push(lDir > 0 ? '1' : '!', lDir > 0 ? '2' : '@');
    if (rLevel > 0 && rDir !== 0) cmds.push(rDir > 0 ? '3' : '#', rDir > 0 ? '4' : '$');
    if (cmds.length > 0) void b.send(cmds.join(''));
  }, []);

  // === Camera gesture (🖐 토글) ===
  const [showCamera, setShowCamera] = useState(false);
  const lastGestureSigRef = useRef('');
  const onCameraGesture = useCallback((g: { type: 'hand' | 'head_tilt'; openness?: number; fingerCount?: number; dx?: number }) => {
    const tt = useI18nStore.getState().t;
    if (g.type !== 'hand') return;
    const b = useBoardStore.getState();

    // 🐊 악어 작품일 때 — 단순 두 가지: 손 펼침 → 입 벌리기 / 주먹 → 입 다물기
    if (artwork === 'crocodile') {
      const o = g.openness;
      if (o === undefined || !Number.isFinite(o)) {
        setStatusMessage(tt('gesture.notRecognized'));
        return;
      }
      // hysteresis 영역 — 0.3 이하 = 주먹, 0.6 이상 = 펼침. 사이 (0.3~0.6) 는 무시.
      let key: 'open' | 'close' | null = null;
      if (o >= 0.6) key = 'open';
      else if (o <= 0.3) key = 'close';
      if (!key) return;
      if (b.status !== 'connected') {
        setStatusMessage(`${key === 'open' ? '✋' : '✊'} — ${tt('gesture.boardOff')}`);
        return;
      }
      if (lastGestureSigRef.current === key) return;
      lastGestureSigRef.current = key;
      if (key === 'open') {
        setStatusMessage(`✋ → ${tt('basic.openMouth')}`);
        void b.send('%');   // SA +15° (입 벌리기)
      } else {
        setStatusMessage(`✊ → ${tt('basic.closeMouth')}`);
        void b.send('5');   // SA -15° (입 다물기)
      }
      return;
    }

    // 그 외 작품 — 기존 손가락 개수 0~5 매핑 (mappingStore)
    if (g.fingerCount === undefined || !Number.isFinite(g.fingerCount)) {
      setStatusMessage(tt('gesture.notRecognized'));
      return;
    }
    const fc = g.fingerCount;
    const key = fingerCountToKey(fc);
    const meta = key ? GESTURE_LABELS[key] : null;
    const head = meta ? `${meta.emoji} ${meta.label}` : tt('gesture.fingerCount').replace('{n}', String(fc));
    if (b.status !== 'connected') { setStatusMessage(`${head} — ${tt('gesture.boardOff')}`); return; }
    if (!key) { setStatusMessage(head); return; }
    if (lastGestureSigRef.current === key) return;
    lastGestureSigRef.current = key;
    const mapping = useGestureMappingStore.getState().mapping;
    const action = actionById(mapping[key]);
    setStatusMessage(`${head} → ${action.emoji} ${action.label}`);
    if (action.bytes) void b.send(action.bytes);
  }, [artwork]);

  // ⌨️ 키보드 화살표 — 자동차 작품 + 보드 연결 시 활성
  useEffect(() => {
    if (artwork !== 'car_4wd' || !isConnectedEarly) return;
    const keys = new Set<string>();
    // 직진/후진: 9V 있으면 V2, 없으면 V3. 좌/우 단독 (제자리 회전) 은 V5 boost (4WD 토크).
    const update = () => {
      const ax = (keys.has('ArrowRight') ? 1 : 0) + (keys.has('ArrowLeft') ? -1 : 0);
      const ay = (keys.has('ArrowDown') ? 1 : 0) + (keys.has('ArrowUp') ? -1 : 0);
      const len = Math.sqrt(ax * ax + ay * ay);
      if (len === 0) onJoystickMove(0, 0, 0);
      else {
        const has9V = useCalibrationStore.getState().current.has9VBattery;
        const pureTurn = ay === 0 && ax !== 0;
        const level = pureTurn ? 5 : (has9V ? 2 : 3);
        const mag = level / 9;
        onJoystickMove(ax / len * mag, ay / len * mag, mag);
      }
    };
    const isInputFocused = () => {
      const ae = document.activeElement;
      const tag = (ae as HTMLElement)?.tagName;
      return tag === 'TEXTAREA' || tag === 'INPUT' || (ae as HTMLElement)?.isContentEditable;
    };
    const kd = (e: KeyboardEvent) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
      if (isInputFocused()) return;
      e.preventDefault();
      if (!keys.has(e.key)) { keys.add(e.key); update(); }
    };
    const ku = (e: KeyboardEvent) => {
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
      if (keys.delete(e.key)) update();
    };
    const blur = () => { if (keys.size > 0) { keys.clear(); onJoystickMove(0, 0, 0); } };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      if (keys.size > 0) { keys.clear(); onJoystickMove(0, 0, 0); }
    };
  }, [artwork, isConnectedEarly, onJoystickMove]);

  // === Mic ===
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [listening, setListening] = useState(false);
  const [micStatus, setMicStatus] = useState('');

  // === Computed ===
  const isConnected = board.status === 'connected';
  const builtIn = skillsForArtwork(artwork);
  // 쉬운 모드 스킬 = 어른이 고급 모드에서 등록/삭제한 customSkills + built-in.
  // customSkills 우선 (어른 의도) → 부족하면 built-in 채움. 최대 3개 슬롯.
  // simpleHidden=true 인 customSkill 은 노출 X — 설정 모달에서 토글.
  // built-in 도 hiddenBuiltinIds 에 있으면 노출 X — 설정 모달에서 토글.
  const hiddenBuiltinSet = new Set(customSkillsStore.hiddenBuiltinIds);
  const customs = customSkillsStore.skills.filter((s) => s.artwork === artwork && !s.simpleHidden);
  const visibleBuiltIn = builtIn.filter((s) => !hiddenBuiltinSet.has(s.id));
  const allSkills: (Skill | CustomSkill)[] = [...customs, ...visibleBuiltIn].slice(0, 3);
  // 설정 모달의 "내 스킬 관리" 용 — hidden 포함 전체 list (custom + built-in)
  const allCustomsForArtwork = customSkillsStore.skills.filter((s) => s.artwork === artwork);

  // === Connect ===
  const onToggleConnect = async () => {
    if (isConnected) await board.disconnect();
    else await board.connect();
  };

  // === Execute Program ===
  const executeProgram = useCallback(async (prog: Program) => {
    if (isExecuting) return;
    // save_skill 이 포함된 program 은 "저장 명령" — 보드 미연결도 OK, lastProgramRef 도 갱신 X.
    // 저장 시 직전 동작 program (lastProgramRef) 을 customSkill 로 저장한다.
    const hasSaveSkill = prog.steps.some((s) => s.do === 'save_skill');
    if (!hasSaveSkill && board.status !== 'connected') {
      setStatusMessage(t('panel.connectFirst'));
      return;
    }
    setIsExecuting(true);
    if (!hasSaveSkill) {
      lastProgramRef.current = prog;
    }
    if (prog.intro) {
      setStatusMessage(stripAudioTags(prog.intro));
      await speakText(prog.intro);
    }
    abortRef.current = new AbortController();
    await runProgram(prog, {
      signal: abortRef.current.signal,
      onEvent: async (e: InterpreterEvent) => {
        if (e.type === 'say') {
          setStatusMessage(stripAudioTags(e.text));
          await speakText(e.text);
        } else if (e.type === 'play_sound') {
          playEffect(e.sound, e.volume);
        } else if (e.type === 'play_tune') {
          const muted = useSoundStore.getState().muted;
          if (e.await_melody) await playMelody(e.tune, e.tempo, muted, e.custom);
          else void playMelody(e.tune, e.tempo, muted, e.custom);
        } else if (e.type === 'save_skill') {
          // 마지막 실행한 program 을 customSkill 로 저장 (Turso 서버 sync)
          const last = lastProgramRef.current;
          if (!last) {
            setStatusMessage('❌ 저장할 동작이 없어요. 먼저 동작을 만들어보세요!');
            return;
          }
          const saved = await customSkillsStore.add({
            artwork: (last.artwork ?? artwork ?? 'free') as NonNullable<PromptContext['artwork']>,
            label: e.label.slice(0, 16),
            emoji: e.emoji.slice(0, 4),
            program: last,
          });
          if (saved) {
            setStatusMessage(`💾 "${saved.emoji} ${saved.label}" 저장됨!`);
          } else {
            setStatusMessage('❌ 저장 실패 — 네트워크/DB 확인');
          }
        }
      },
    });
    setIsExecuting(false);
    // 동작 끝나면 다음 명령 입력하기 쉽게 textarea focus 복원
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isExecuting, board.status, customSkillsStore, artwork, t]);

  // === Send to AI ===
  const sendPrompt = useCallback(async (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    setIsGenerating(true);
    setStatusMessage('');
    setInput('');
    const newHistory = [...history, { role: 'user' as const, content: trimmed }];
    setHistory(newHistory);
    try {
      const ctx: PromptContext = {
        artwork,
        distanceReactivityEnabled: distanceReactivity,
        motorThresholds: cal.current.startThreshold,
        lastDistanceCm: board.lastDistanceCm,
        locale,
      };
      // 최근 8턴만 보냄 (context 부풀어서 응답 끊기는 문제 방지)
      const recentHistory = history.slice(-8);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed, context: ctx, history: recentHistory }),
      });
      if (!res.ok || !res.body) throw new Error(`AI ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }
      const cleaned = acc.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      if (!cleaned) {
        throw new Error('AI 가 응답을 안 줬어요. 다시 시도해 주세요.');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch (jsonErr) {
        throw new Error(`AI 응답 형식 오류 — 다시 시도해주세요. (${(jsonErr as Error).message})`);
      }
      const valid = validateProgram(parsed);
      // history 도 누적 8턴까지만 유지
      setHistory([...newHistory, { role: 'assistant' as const, content: cleaned }].slice(-16));
      void prefetchProgramAudio(valid);
      // 자동 실행
      setTimeout(() => void executeProgram(valid), 150);
    } catch (e) {
      setStatusMessage(`❌ ${(e as Error).message}`);
    } finally {
      setIsGenerating(false);
      // AI 응답 직후 textarea 포커스 복원 — 학생이 곧바로 다음 입력 시작 가능.
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isGenerating, history, artwork, cal, board.lastDistanceCm, executeProgram]);

  // === Skill ===
  // executor 스킬 (음악-동작 정교 sync, 예: 발레리나 오르골) 분기 — program 무시하고 직접 제어.
  const runSkillExecutor = useCallback(async (skill: Skill) => {
    if (!skill.execute) return;
    setIsExecuting(true);
    setStatusMessage('');
    abortRef.current = new AbortController();
    const ctx = {
      send: (p: string) => useBoardStore.getState().send(p),
      delay: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      signal: abortRef.current.signal,
      speak: async (text: string) => {
        setStatusMessage(stripAudioTags(text));
        await speakText(text);
      },
      playMelody: (tune: string) => {
        const muted = useSoundStore.getState().muted;
        return playMelody(tune as Parameters<typeof playMelody>[0], 1.0, muted);
      },
      playEffect: (sound: string) => {
        playEffect(sound as Parameters<typeof playEffect>[0], 1.0);
      },
      setStatus: (text: string) => setStatusMessage(text),
      t: (key: string) => useI18nStore.getState().t(key),
    };
    try {
      await skill.execute(ctx);
    } catch (e) {
      console.warn('[skill executor] error', e);
      try { await ctx.send(GLOBAL.stopAll); } catch {}
    }
    setIsExecuting(false);
  }, []);

  const onRunSkill = (skill: Skill | CustomSkill) => {
    if (isExecuting) return;
    if (!isConnected) {
      setStatusMessage(t('panel.connectFirst'));
      return;
    }
    abortRef.current?.abort();
    // 정교 sync 가 필요한 스킬은 executor 사용 (program 무시)
    if ('execute' in skill && typeof skill.execute === 'function') {
      void runSkillExecutor(skill as Skill);
    } else {
      void executeProgram(skill.program);
    }
  };

  // === Mic ===
  const cleanupMic = useCallback(() => {
    if (vadRafRef.current !== null) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((tr) => tr.stop()); mediaStreamRef.current = null; }
    mediaRecorderRef.current = null;
  }, []);

  const stopMic = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') mr.stop();
  }, []);

  const startMic = useCallback(async () => {
    if (mediaRecorderRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicStatus('❌'); return;
    }
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' });
        cleanupMic();
        setListening(false);
        if (blob.size < 2000) { setMicStatus(''); return; }
        setMicStatus(t('mic.transcribing'));
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const res = await fetch('/api/stt', { method: 'POST', body: fd });
          const data: { text?: string; error?: string } = await res.json();
          if (!res.ok || data.error) { setMicStatus(`❌ ${data.error ?? ''}`); setTimeout(() => setMicStatus(''), 2500); return; }
          const txt = (data.text ?? '').trim();
          if (txt) {
            setInput((prev) => (prev ? prev + ' ' : '') + txt);
            setMicStatus('');
            requestAnimationFrame(() => textareaRef.current?.focus());
          } else setMicStatus('');
        } catch {
          setMicStatus('❌');
          setTimeout(() => setMicStatus(''), 2500);
        }
      };
      mr.start();
      setListening(true);
      setMicStatus(t('mic.listening'));
      // VAD
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const start = Date.now();
      let lastSpoke = 0;
      const tick = () => {
        if (mediaRecorderRef.current?.state !== 'recording') return;
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length;
        const now = Date.now();
        if (avg > 18) lastSpoke = now;
        const elapsed = now - start;
        const silence = lastSpoke > 0 ? now - lastSpoke : 0;
        if ((elapsed > 800 && lastSpoke > 0 && silence > 1500) || elapsed > 15000) {
          stopMic();
          return;
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {
      cleanupMic();
      setMicStatus('🚫');
      setTimeout(() => setMicStatus(''), 2500);
    }
  }, [cleanupMic, stopMic, t]);

  const onMicToggle = () => { if (listening) stopMic(); else void startMic(); };
  useEffect(() => () => cleanupMic(), [cleanupMic]);

  // 페이지 mount 시 Turso 서버에서 스킬 fetch — 새로고침해도 + 다른 PC 도 같은 스킬
  useEffect(() => {
    if (!customSkillsStore.loaded) {
      void customSkillsStore.fetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 페이지 진입 시 textarea 에 자동 focus — 학생이 즉시 입력 가능
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!projectOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setProjectOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [projectOpen]);

  // === Basic skill 명령 송신 (서보 ±15도) ===
  const onBasicCmd = async (cmd: string) => {
    if (!isConnected) { setStatusMessage(t('panel.connectFirst')); return; }
    try { await board.send(cmd); } catch {}
  };

  // === 설정 모달 — 모터 길들이기 / 서보 캘리브 / 거리 반응 ===
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
  // 서보 각도 (클라이언트 누적 추적)
  const [servoA, setServoA] = useState(90);
  const [servoB, setServoB] = useState(90);
  const onServoAdjust = useCallback(async (axis: 'A' | 'B', delta: -15 | 15) => {
    if (!isConnected) return;
    const cmdChar = axis === 'A'
      ? (delta > 0 ? '%' : '5')
      : (delta > 0 ? '^' : '6');
    try { await board.send(cmdChar); } catch {}
    if (axis === 'A') setServoA((v) => Math.max(0, Math.min(180, v + delta)));
    else setServoB((v) => Math.max(0, Math.min(180, v + delta)));
  }, [isConnected, board]);
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

  return (
    <div className="thinkgen-simple">
      {/* ════════════ 좌측 사이드바 ════════════ */}
      <aside className="tg-sidebar">
        {/* 로고 */}
        <div className="tg-logo-wrap">
          <div className="tg-logo-subtitle">{t('thinkgen.subtitle')}</div>
          <Image
            className="tg-logo-img"
            src="/thinkgen/logo-source-crop-tight.png"
            alt={t('thinkgen.brand')}
            width={485}
            height={145}
            priority
          />
        </div>

        {/* 나만의 AI 스킬 */}
        <section>
          <h2 className="tg-section-title">{t('skills.my')}</h2>
          <div className="tg-skill-list">
            {allSkills.length === 0 ? (
              <div className="tg-empty-text">{t('skills.empty')}</div>
            ) : (
              allSkills.map((skill, i) => {
                // built-in 스킬은 i18n key (skill.{id}), custom 스킬은 학생이 붙인 이름 그대로
                const isBuiltIn = !('createdAt' in skill);
                const dictKey = `skill.${skill.id}`;
                const translated = isBuiltIn ? t(dictKey) : skill.label;
                const display = translated === dictKey ? skill.label : translated;
                return (
                  <div key={skill.id} style={{ position: 'relative' }}>
                    <button
                      className="tg-skill-btn"
                      onClick={() => onRunSkill(skill)}
                      disabled={!isConnected || isExecuting}
                      style={{ background: SKILL_BG[i] ?? C.mint, width: '100%' }}
                    >
                      <span className="tg-skill-index">{i + 1}</span>
                      <span style={{ flex: 1 }}>{display}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isBuiltIn) {
                          void customSkillsStore.toggleBuiltinHidden(skill.id);
                        } else {
                          void customSkillsStore.toggleSimpleHidden(skill.id);
                        }
                      }}
                      title={t('skills.hide')}
                      aria-label={t('skills.hide')}
                      style={{
                        position: 'absolute', top: 6, right: 8,
                        width: 22, height: 22, borderRadius: '50%',
                        background: '#fff', color: C.textDark,
                        border: `2px solid ${C.textDark}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 900, cursor: 'pointer',
                        padding: 0, lineHeight: 1,
                        fontFamily: 'inherit',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 화면 하단 — AI 기본 스킬 (서보 ±15° 두 버튼) */}
        <section style={{ marginTop: 'auto' }}>
          <h2 className="tg-section-title">{t('skills.basic')}</h2>
          <div className="tg-basic-card">
            {[
              { id: 'open',  label: t('basic.openMouth'),  cmd: '%', emoji: '😮' },
              { id: 'close', label: t('basic.closeMouth'), cmd: '5', emoji: '😐' },
            ].map((b) => (
              <button
                key={b.id}
                className="tg-basic-btn"
                onClick={() => void onBasicCmd(b.cmd)}
                disabled={!isConnected}
              >
                <span className="tg-basic-key" style={{ fontSize: 18 }}>{b.emoji}</span>
                <span>{b.label}</span>
              </button>
            ))}
          </div>
          {/* 작은 advanced 진입 링크 */}
          <Link href="/play" className="tg-advanced-link">
            {t('mode.advanced')} →
          </Link>
        </section>
      </aside>

      {/* ════════════ 우측 메인 ════════════ */}
      <main className="tg-main">
        {/* ─── 상단 ─── */}
        <header className="tg-topbar">
          {/* 프로젝트 */}
          <div>
            <div className="tg-label">{t('project.label')}</div>
            <div className="tg-project-select-wrap" ref={projectMenuRef}>
              <button
                type="button"
                className="tg-project-select"
                aria-haspopup="listbox"
                aria-expanded={projectOpen}
                onClick={() => setProjectOpen((v) => !v)}
              >
                {t(ARTWORKS.find((a) => a.id === artwork)?.tKey ?? 'artwork.crocodile')}
              </button>
              {projectOpen && (
                <div className="tg-project-menu" role="listbox">
                  {ARTWORKS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="option"
                      aria-selected={artwork === a.id}
                      className={`tg-project-option ${artwork === a.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setArtwork(a.id);
                        setProjectOpen(false);
                      }}
                    >
                      <span className="tg-project-emoji">{a.emoji}</span>
                      <span>{t(a.tKey)}</span>
                    </button>
                  ))}
                </div>
              )}
              <select
                className="tg-project-native"
                value={artwork}
                onChange={(e) => setArtwork(e.target.value as NonNullable<PromptContext['artwork']>)}
                aria-label={t('project.label')}
                tabIndex={-1}
              >
                {ARTWORKS.map((a) => (
                  <option key={a.id} value={a.id} style={{ background: '#fff', color: C.textDark }}>
                    {t(a.tKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="tg-utility-row" aria-label="보조 도구">
            <button
              className={`tg-icon-btn ${showCamera ? 'is-active' : ''}`}
              onClick={() => setShowCamera((v) => !v)}
              title={t('tool.gesture')}
            >
              🖐
            </button>
            {LOCALES.map((l) => (
              <button
                key={l.code}
                className={`tg-locale-btn ${locale === l.code ? 'is-active' : ''}`}
                onClick={() => setLocale(l.code)}
                title={l.label}
              >
                {l.emoji}
              </button>
            ))}
          </div>

          {/* 컨트롤 보드 */}
          <div className="tg-control">
            <div className="tg-label">{t('control.label')}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className={`tg-connect-btn ${isConnected ? '' : 'is-off'}`}
                onClick={() => void onToggleConnect()}
                disabled={board.status === 'requesting' || board.status === 'opening'}
              >
                <span>{isConnected ? t('control.on') :
                       board.status === 'requesting' ? t('connect.requesting') :
                       board.status === 'opening' ? t('connect.opening') :
                       t('control.off')}</span>
                <span className="tg-connect-dot" />
              </button>
              {/* 📶 BLE 무선 연결 — 펌웨어 v1.4+ 필요. 연결 끊김 시에만 노출. */}
              {!isConnected && board.status !== 'requesting' && board.status !== 'opening' && (
                <button
                  onClick={() => void board.connectBle()}
                  title={t('control.bleHint')}
                  aria-label="Bluetooth"
                  style={{
                    fontFamily: 'inherit', cursor: 'pointer',
                    width: 38, height: 38, borderRadius: '50%',
                    background: '#fff', color: C.textDark,
                    border: `3px solid ${C.textDark}`,
                    fontSize: 18, fontWeight: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0,
                  }}
                >📶</button>
              )}
            </div>
          </div>
        </header>

        {/* 🚗 자동차 작품 시 조이스틱 자동 노출 (입력 박스 위) */}
        {artwork === 'car_4wd' && (
          <div className="tg-floating-panel">
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.purple, marginBottom: 4 }}>
                🕹 직접 조종
              </div>
              <div style={{ fontSize: 15, color: C.textMuted, lineHeight: 1.4 }}>
                화살표 키도 OK
              </div>
            </div>
            <Joystick
              onMove={onJoystickMove}
              disabled={!isConnected}
              colors={{
                primary: C.purple,
                primaryLight: C.pink,
                border: C.textDark,
                textMuted: C.textMuted,
              }}
            />
          </div>
        )}

        {/* 🖐 카메라 제스처 (토글 ON 시) */}
        {showCamera && (
          <div className="tg-floating-panel" style={{ padding: 12 }}>
            <CameraPanel
              onGesture={onCameraGesture}
              colors={{
                primary: C.purple,
                primaryDark: C.textDark,
                primaryLight: C.pink,
                border: C.textDark,
                accent: C.yellow,
                textMuted: C.textMuted,
              }}
            />
          </div>
        )}

        {/* ─── 가운데 입력 박스 (마이크 버튼 우측 하단 통합) ─── */}
        <div className="tg-prompt-card">
          <textarea
            ref={textareaRef}
            className="tg-prompt-input"
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('input.placeholder')}
            onKeyDown={(e) => {
              const isComp = (e.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing;
              if (e.key === 'Enter' && !e.shiftKey && !isComp && input.trim().length > 0 && !isGenerating && !isExecuting) {
                e.preventDefault();
                void sendPrompt(input);
              }
            }}
            disabled={isGenerating || isExecuting}
          />
          {(isGenerating || isExecuting) && (
            <div className="tg-state-line">
              {isGenerating ? `💭 ${t('send.thinking')}` : '▶ ...'}
            </div>
          )}
          {/* 마이크 버튼 — 입력 박스 우측 하단 */}
          <button
            className={`tg-mic-btn ${listening ? 'is-listening' : ''}`}
            onClick={onMicToggle}
            disabled={isGenerating || isExecuting}
            title={listening ? t('mic.listening') : t('mic.start')}
            style={{ animation: listening ? 'pulse 1.2s ease-in-out infinite' : 'none' }}
          >
            🎤
          </button>
        </div>

        {/* ─── 하단 — 캐릭터 + 메시지 + 표정 도구 (화면 맨 아래 고정) ─── */}
        <div className="tg-character-bar">
          {/* 캐릭터 */}
          <Image
            className="tg-character-img"
            src="/fdland/main_ill.png"
            alt="ThinkGen 캐릭터"
            width={138}
            height={138}
            priority
          />

          {/* 메시지 */}
          <div className="tg-character-message">
            {micStatus || statusMessage || t('character.greeting')}
          </div>

          {/* 우측 하단 — 표정 도구 (라벨 + 상태 포함, 직관적) */}
          <div className="tg-bottom-icons" aria-label="작품 도구">
            {/* 입 아이콘 — 설정 열기 */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <button
                className="tg-bottom-icon-btn"
                onClick={() => setSettingsOpen(true)}
                title={t('settings.title')}
              >
                <Image
                  className="tg-mouth-img"
                  src="/thinkgen/mouth-icon.png"
                  alt={t('panel.settings')}
                  width={112}
                  height={82}
                />
              </button>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.textDark, letterSpacing: 0.3 }}>
                {t('panel.settings')}
              </span>
            </div>

            {/* 눈 아이콘 — 거리 반응 토글 + cm + ON/OFF */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <button
                className={`tg-bottom-icon-btn ${distanceReactivity ? 'is-active' : ''}`}
                onClick={() => {
                  if (isConnected) setDistanceReactivity((v) => !v);
                }}
                aria-disabled={!isConnected}
                title={
                  !isConnected ? t('panel.boardOff') :
                  distanceReactivity ? `${t('settings.distanceReact')} ON` :
                  `${t('settings.distanceReact')} OFF`
                }
                style={{ opacity: isConnected ? 1 : 0.55 }}
              >
                <Image
                  className="tg-eyes-img"
                  src="/thinkgen/eyes-icon.png"
                  alt={t('panel.distance')}
                  width={120}
                  height={104}
                />
              </button>
              <span style={{
                fontSize: 12, fontWeight: 800, color: C.textDark,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>{isConnected ? `${board.lastDistanceCm ?? '—'} ${t('distance.label')}` : '—'}</span>
                <span style={{
                  fontSize: 10, fontWeight: 900, letterSpacing: 0.5,
                  padding: '1px 6px', borderRadius: 8,
                  background: distanceReactivity ? C.purple : '#fff',
                  color: distanceReactivity ? '#fff' : C.textMuted,
                  border: `1.5px solid ${C.textDark}`,
                }}>
                  {distanceReactivity ? 'ON' : 'OFF'}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 키프레임 */}
        <style jsx global>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.08); opacity: 0.85; }
          }
        `}</style>
      </main>

      {/* ⚙️ 설정 모달 — 부모용 */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.mainBg, border: `4px solid ${C.textDark}`, borderRadius: 24,
              padding: 24, maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto',
              boxShadow: `4px 4px 0 ${C.textDark}`,
              display: 'flex', flexDirection: 'column', gap: 20,
            }}
          >
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: C.textDark }}>
                ⚙️ {t('settings.title').replace('⚙️ ', '')}
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  fontFamily: 'inherit', cursor: 'pointer',
                  background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: '50%',
                  width: 36, height: 36, fontSize: 16, fontWeight: 900, color: C.textDark,
                }}
              >✕</button>
            </div>

            {/* 거리 반응 모드 */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: distanceReactivity ? C.mint : '#fff',
              border: `3px solid ${C.textDark}`, borderRadius: 16,
              padding: '12px 16px', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={distanceReactivity}
                onChange={(e) => setDistanceReactivity(e.target.checked)}
                style={{ width: 20, height: 20, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.textDark }}>
                  👀 {t('settings.distanceReact')}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  {t('settings.distanceReact.desc')}
                </div>
              </div>
            </label>

            {/* 9V 배터리 — 키보드 화살표 기본 속도 결정 */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: cal.current.has9VBattery ? C.mint : '#fff',
              border: `3px solid ${C.textDark}`, borderRadius: 16,
              padding: '12px 16px', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={cal.current.has9VBattery}
                onChange={(e) => cal.setHas9VBattery(e.target.checked)}
                style={{ width: 20, height: 20, cursor: 'pointer' }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.textDark }}>
                  🔋 {t('settings.has9V')}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                  {t('settings.has9V.desc')}
                </div>
              </div>
            </label>

            {/* 모터 길들이기 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, color: C.textDark }}>
                🔧 {t('settings.motorCalib')}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                {t('settings.motorCalib.desc')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {MOTOR_IDS.map((id) => {
                  const dir = cal.current.dirOverride[id];
                  const v = cal.current.startThreshold[id];
                  return (
                    <div key={id} style={{
                      background: dir === 1 ? C.mint : C.pink,
                      border: `3px solid ${C.textDark}`, borderRadius: 12,
                      padding: 10, gap: 6,
                      display: 'flex', flexDirection: 'column',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 900, fontSize: 14, color: C.textDark }}>{id}</span>
                        <button
                          onClick={() => void onToggleDir(id)}
                          style={{
                            fontFamily: 'inherit', fontWeight: 700, fontSize: 10,
                            background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6,
                            padding: '2px 5px', cursor: 'pointer', color: C.textDark,
                          }}
                        >{dir === 1 ? t('settings.label.dirForward') : t('settings.label.dirReverse')}</button>
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 10, color: C.textMuted, marginTop: 2 }}>{t('settings.label.startup')}</div>
                      <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 22, lineHeight: 1, color: C.textDark }}>V{v}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                        <button onClick={() => onAdjustThreshold(id, -1)} disabled={v <= 0}
                          style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '3px 0', cursor: 'pointer', opacity: v <= 0 ? 0.4 : 1, color: C.textDark }}>−</button>
                        <button onClick={() => onAdjustThreshold(id, +1)} disabled={v >= 9}
                          style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '3px 0', cursor: 'pointer', opacity: v >= 9 ? 0.4 : 1, color: C.textDark }}>+</button>
                      </div>
                      <button onClick={() => void onTestStart(id)} disabled={!isConnected || isExecuting}
                        style={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 11, background: C.purple, color: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '5px 0', cursor: 'pointer', opacity: (!isConnected || isExecuting) ? 0.5 : 1 }}>
                        {t('settings.label.startBtn')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 서보 각도 */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, color: C.textDark }}>
                🎯 {t('settings.servoCalib')}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                {t('settings.servoCalib.desc')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([
                  { axis: 'A' as const, label: t('settings.servoA'), value: servoA },
                  { axis: 'B' as const, label: t('settings.servoB'), value: servoB },
                ]).map(({ axis, label, value }) => (
                  <div key={axis} style={{
                    background: C.pink, border: `3px solid ${C.textDark}`, borderRadius: 12,
                    padding: 10, gap: 6, display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.3 }}>{label}</div>
                    <div style={{ textAlign: 'center', fontWeight: 900, fontSize: 26, lineHeight: 1, color: C.textDark }}>{value}°</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <button onClick={() => void onServoAdjust(axis, -15)} disabled={!isConnected || value <= 0}
                        style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '4px 0', cursor: 'pointer', opacity: (!isConnected || value <= 0) ? 0.4 : 1, color: C.textDark }}>−15°</button>
                      <button onClick={() => void onServoAdjust(axis, +15)} disabled={!isConnected || value >= 180}
                        style={{ fontFamily: 'inherit', fontWeight: 900, fontSize: 14, background: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '4px 0', cursor: 'pointer', opacity: (!isConnected || value >= 180) ? 0.4 : 1, color: C.textDark }}>+15°</button>
                    </div>
                    <button onClick={() => void onServoCenter(axis)} disabled={!isConnected || value === 90}
                      style={{ fontFamily: 'inherit', fontWeight: 800, fontSize: 11, background: C.purple, color: '#fff', border: `2px solid ${C.textDark}`, borderRadius: 6, padding: '5px 0', cursor: 'pointer', opacity: (!isConnected || value === 90) ? 0.5 : 1 }}>
                      {t('settings.label.center90')}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 💖 내 스킬 관리 — 작품별로 노출/숨김/삭제 (custom + built-in 통합 list) */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, color: C.textDark }}>
                {t('settings.mySkills')}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
                {t('settings.mySkills.desc')}
              </div>
              {(() => {
                // 통합 list — custom 먼저 (사용자 우선), 그 다음 built-in
                type ManageRow =
                  | { kind: 'custom'; skill: CustomSkill; hidden: boolean }
                  | { kind: 'builtin'; skill: Skill; hidden: boolean };
                const customRows: ManageRow[] = allCustomsForArtwork.map((s) => ({
                  kind: 'custom' as const, skill: s, hidden: !!s.simpleHidden,
                }));
                const builtinRows: ManageRow[] = builtIn.map((s) => ({
                  kind: 'builtin' as const, skill: s, hidden: hiddenBuiltinSet.has(s.id),
                }));
                const rows: ManageRow[] = [...customRows, ...builtinRows];
                if (rows.length === 0) {
                  return (
                    <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic', padding: '10px 12px', background: '#fff', border: `2px dashed ${C.textDark}`, borderRadius: 10 }}>
                      {t('settings.mySkills.empty')}
                    </div>
                  );
                }
                const visibleCount = rows.filter((r) => !r.hidden).length;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map((r) => {
                      const id = r.skill.id;
                      const hidden = r.hidden;
                      const cannotShow = hidden && visibleCount >= 3;
                      const isBuiltIn = r.kind === 'builtin';
                      const dictKey = `skill.${id}`;
                      const builtinTranslated = isBuiltIn ? t(dictKey) : '';
                      const label = isBuiltIn
                        ? (builtinTranslated === dictKey ? (r.skill as Skill).label : builtinTranslated)
                        : (r.skill as CustomSkill).label;
                      const emoji = isBuiltIn ? (r.skill as Skill).emoji : (r.skill as CustomSkill).emoji;
                      return (
                        <div key={id} style={{
                          background: hidden ? C.mainBg : (isBuiltIn ? C.mint : C.pink),
                          border: `2.5px solid ${C.textDark}`, borderRadius: 12,
                          padding: '8px 12px',
                          display: 'flex', alignItems: 'center', gap: 10,
                          opacity: hidden ? 0.65 : 1,
                        }}>
                          <span style={{ fontSize: 20 }}>{emoji}</span>
                          <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: C.textDark }}>{label}</span>
                          {isBuiltIn && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, padding: '2px 6px', background: '#fff', borderRadius: 6, border: `1.5px solid ${C.textDark}` }}>
                              {t('settings.mySkills.builtinBadge')}
                            </span>
                          )}
                          <button
                            onClick={() => {
                              if (cannotShow) {
                                alert('쉬운 모드 칩은 최대 3개. 다른 스킬을 숨김 처리 후 다시 시도하세요.');
                                return;
                              }
                              if (isBuiltIn) {
                                void customSkillsStore.toggleBuiltinHidden(id);
                              } else {
                                void customSkillsStore.toggleSimpleHidden(id);
                              }
                            }}
                            title={hidden ? t('settings.mySkills.visible') : t('settings.mySkills.hidden')}
                            style={{
                              fontFamily: 'inherit', cursor: 'pointer',
                              background: hidden ? '#fff' : C.purple,
                              color: hidden ? C.textDark : '#fff',
                              border: `2px solid ${C.textDark}`, borderRadius: 8,
                              padding: '4px 10px', fontSize: 13, fontWeight: 800,
                              opacity: cannotShow ? 0.4 : 1,
                            }}
                          >
                            {hidden ? '🙈' : '⭐'}
                          </button>
                          {!isBuiltIn && (
                            <button
                              onClick={() => {
                                if (confirm(`"${emoji} ${label}" — ${t('settings.mySkills.deleteConfirm')}`)) {
                                  void customSkillsStore.remove(id);
                                }
                              }}
                              title={t('settings.mySkills.delete')}
                              style={{
                                fontFamily: 'inherit', cursor: 'pointer',
                                background: '#fff', color: C.textDark,
                                border: `2px solid ${C.textDark}`, borderRadius: 8,
                                padding: '4px 8px', fontSize: 13,
                              }}
                            >
                              🗑
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
