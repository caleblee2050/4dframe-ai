'use client';

// 학생용 단순 모드 — 디자인 이미지 그대로 구현.
// 좌측: 로고 + 나만의 AI 스킬 (3개) + AI 기본 스킬 (C/O/P)
// 우측: 프로젝트 + 컨트롤 보드 + 입력 박스 + 캐릭터 메시지
//
// 고급 기능 (조이스틱/카메라/사진 인식/캘리브 등) 은 /play 어드밴스드 모드.
// 학생은 여기에 머물고, 어른만 좌하단 링크로 advanced 진입.

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { GLOBAL, isV13Plus } from '@/lib/commands/commands';
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
  sideBg: '#B5DDD4',
  mainBg: '#FAEFD9',
  dotColor: '#E8D9B5',
  purple: '#3F1F8C',
  purpleLight: '#6B4FBE',
  yellow: '#FFD93D',
  orange: '#FFB58A',
  pink: '#FFC8E1',
  mint: '#C5E8DC',
  textDark: '#3A2168',
  textMuted: '#8B7BA8',
  greenOn: '#7CDB7C',
  greetingTeal: '#5BB8B0',
};

const SKILL_BG = [C.orange, C.pink, C.mint];

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

  // === Refs ===
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
    const speedLevel = Math.max(1, Math.min(9, Math.round(mag * 9)));
    const lDir = left > 0.10 ? 1 : left < -0.10 ? -1 : 0;
    const rDir = right > 0.10 ? 1 : right < -0.10 ? -1 : 0;
    const lLevel = lDir !== 0 ? speedLevel : 0;
    const rLevel = rDir !== 0 ? speedLevel : 0;
    const sig = `${lLevel}.${lDir}|${rLevel}.${rDir}`;
    if (lastJoyRef.current.signature === sig) return;
    lastJoyRef.current = { t: now, signature: sig };
    const cmds: string[] = [];
    if (v13) cmds.push(`X1${lLevel}`, `X2${lLevel}`, `X0${rLevel}`, `X3${rLevel}`);
    if (lLevel > 0 && lDir !== 0) cmds.push(lDir > 0 ? '1' : '!', lDir > 0 ? '3' : '#');
    if (rLevel > 0 && rDir !== 0) cmds.push(rDir > 0 ? '2' : '@', rDir > 0 ? '4' : '$');
    if (cmds.length > 0) void b.send(cmds.join(''));
  }, []);

  // === Camera gesture (🖐 토글) ===
  const [showCamera, setShowCamera] = useState(false);
  const lastGestureSigRef = useRef('');
  const onCameraGesture = useCallback((g: { type: 'hand' | 'head_tilt'; openness?: number; fingerCount?: number; dx?: number }) => {
    if (g.type !== 'hand' || g.fingerCount === undefined || !Number.isFinite(g.fingerCount)) {
      setStatusMessage('🙅 손 인식 안 됨');
      return;
    }
    const fc = g.fingerCount;
    const key = fingerCountToKey(fc);
    const b = useBoardStore.getState();
    const meta = key ? GESTURE_LABELS[key] : null;
    const head = meta ? `${meta.emoji} ${meta.label}` : `손가락 ${fc}개`;
    if (b.status !== 'connected') { setStatusMessage(`${head} — 보드 미연결`); return; }
    if (!key) { setStatusMessage(head); return; }
    if (lastGestureSigRef.current === key) return;
    lastGestureSigRef.current = key;
    const mapping = useGestureMappingStore.getState().mapping;
    const action = actionById(mapping[key]);
    setStatusMessage(`${head} → ${action.emoji} ${action.label}`);
    if (action.bytes) void b.send(action.bytes);
  }, []);

  // ⌨️ 키보드 화살표 — 자동차 작품 + 보드 연결 시 활성
  useEffect(() => {
    if (artwork !== 'car_4wd' || !isConnectedEarly) return;
    const keys = new Set<string>();
    // 키보드는 단순 — V5 (보통 속도) 고정. 위치값 변속은 조이스틱 UI 만.
    const update = () => {
      const ax = (keys.has('ArrowRight') ? 1 : 0) + (keys.has('ArrowLeft') ? -1 : 0);
      const ay = (keys.has('ArrowDown') ? 1 : 0) + (keys.has('ArrowUp') ? -1 : 0);
      const len = Math.sqrt(ax * ax + ay * ay);
      if (len === 0) onJoystickMove(0, 0, 0);
      else onJoystickMove(ax / len, ay / len, 0.55);
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
  const customs = customSkillsStore.skills.filter((s) => s.artwork === artwork);
  const allSkills: (Skill | CustomSkill)[] = [...customs, ...builtIn].slice(0, 3);

  // === Connect ===
  const onToggleConnect = async () => {
    if (isConnected) await board.disconnect();
    else await board.connect();
  };

  // === Execute Program ===
  const executeProgram = useCallback(async (prog: Program) => {
    if (isExecuting) return;
    if (board.status !== 'connected') {
      setStatusMessage('🔌 보드를 먼저 연결해주세요!');
      return;
    }
    setIsExecuting(true);
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
          if (e.await_melody) await playMelody(e.tune, e.tempo, muted);
          else void playMelody(e.tune, e.tempo, muted);
        }
      },
    });
    setIsExecuting(false);
  }, [isExecuting, board.status]);

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
        distanceReactivityEnabled: false,
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
      setStatusMessage('🔌 보드를 먼저 연결해주세요!');
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

  // 페이지 진입 시 textarea 에 자동 focus — 학생이 즉시 입력 가능
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // === Basic skill 명령 송신 (C/O/P) ===
  const onBasicCmd = async (cmd: string) => {
    if (!isConnected) { setStatusMessage('🔌 보드를 먼저 연결해주세요!'); return; }
    try { await board.send(cmd); } catch {}
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'inherit' }}>
      {/* ════════════ 좌측 사이드바 ════════════ */}
      <aside style={{
        width: 320, background: C.sideBg, padding: '28px 24px',
        display: 'flex', flexDirection: 'column', gap: 28,
        borderRight: `4px solid ${C.textDark}`,
      }}>
        {/* 로고 */}
        <div>
          <div style={{ fontSize: 11, color: C.textDark, fontWeight: 700, marginBottom: 6 }}>
            {t('thinkgen.subtitle')}
          </div>
          <div style={{
            fontSize: 36, fontWeight: 900, color: C.purple,
            letterSpacing: '-1.5px', lineHeight: 0.95,
          }}>
            {t('thinkgen.brand')}
          </div>
        </div>

        {/* 나만의 AI 스킬 */}
        <section>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: C.textDark, margin: '0 0 12px 0' }}>
            {t('skills.my')}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {allSkills.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
                {t('skills.empty')}
              </div>
            ) : (
              allSkills.map((skill, i) => {
                // built-in 스킬은 i18n key (skill.{id}), custom 스킬은 학생이 붙인 이름 그대로
                const isBuiltIn = !('createdAt' in skill);
                const dictKey = `skill.${skill.id}`;
                const translated = isBuiltIn ? t(dictKey) : skill.label;
                const display = translated === dictKey ? skill.label : translated;
                return (
                  <button
                    key={skill.id}
                    onClick={() => onRunSkill(skill)}
                    disabled={!isConnected || isExecuting}
                    style={{
                      fontFamily: 'inherit',
                      cursor: isConnected && !isExecuting ? 'pointer' : 'not-allowed',
                      background: SKILL_BG[i] ?? C.mint,
                      border: `3px solid ${C.textDark}`, borderRadius: 14,
                      padding: '14px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      fontSize: 15, fontWeight: 800, color: C.textDark,
                      opacity: !isConnected || isExecuting ? 0.55 : 1,
                      textAlign: 'left',
                      boxShadow: `2px 2px 0 ${C.textDark}`,
                    }}
                  >
                    <span style={{
                      width: 28, height: 28, background: C.yellow,
                      border: `2px solid ${C.textDark}`, borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 900, flexShrink: 0,
                    }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{display}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* 화면 하단 — AI 기본 스킬 */}
        <section style={{ marginTop: 'auto' }}>
          <h2 style={{ fontSize: 14, fontWeight: 800, color: C.textDark, margin: '0 0 12px 0' }}>
            {t('skills.basic')}
          </h2>
          <div style={{
            background: '#fff', border: `3px solid ${C.textDark}`, borderRadius: 14,
            padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
            boxShadow: `2px 2px 0 ${C.textDark}`,
          }}>
            {[
              { key: 'C', label: t('basic.openMouth'),  cmd: '%' },
              { key: 'O', label: t('basic.closeMouth'), cmd: '5' },
              { key: 'P', label: t('basic.startGame'),  cmd: 'W' },
            ].map((b) => (
              <button
                key={b.key}
                onClick={() => void onBasicCmd(b.cmd)}
                disabled={!isConnected}
                style={{
                  fontFamily: 'inherit', cursor: isConnected ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'transparent', border: 'none',
                  fontSize: 14, fontWeight: 700, color: C.textDark,
                  padding: 2, opacity: isConnected ? 1 : 0.4, textAlign: 'left',
                }}
              >
                <span style={{
                  width: 26, height: 26, background: C.yellow,
                  border: `2px solid ${C.textDark}`, borderRadius: 6,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 900, flexShrink: 0,
                }}>{b.key}</span>
                <span>{b.label}</span>
              </button>
            ))}
          </div>
          {/* 작은 advanced 진입 링크 */}
          <Link href="/play" style={{
            display: 'inline-block', marginTop: 14,
            fontSize: 10, color: C.textMuted, textDecoration: 'underline', fontWeight: 700,
          }}>
            ⚙️ {t('mode.advanced')} →
          </Link>
        </section>
      </aside>

      {/* ════════════ 우측 메인 ════════════ */}
      <main style={{
        flex: 1, background: C.mainBg,
        backgroundImage: `radial-gradient(circle, ${C.dotColor} 1.5px, transparent 1.5px)`,
        backgroundSize: '24px 24px',
        padding: '24px 36px',
        display: 'flex', flexDirection: 'column',
        minHeight: '100vh',
      }}>
        {/* ─── 상단 ─── */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          {/* 프로젝트 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.textDark }}>
              {t('project.label')}
            </span>
            <select
              value={artwork}
              onChange={(e) => setArtwork(e.target.value as NonNullable<PromptContext['artwork']>)}
              style={{
                fontFamily: 'inherit', fontSize: 17, fontWeight: 800,
                background: C.purple, color: '#fff',
                border: 'none', borderRadius: 28,
                padding: '12px 44px 12px 22px', cursor: 'pointer',
                appearance: 'none', minWidth: 240,
                backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5'><circle cx='11' cy='11' r='7'/><line x1='16' y1='16' x2='21' y2='21'/></svg>")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 16px center',
              }}
            >
              {ARTWORKS.map((a) => (
                <option key={a.id} value={a.id} style={{ background: '#fff', color: C.textDark }}>
                  {a.emoji} {t(a.tKey)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }} />

          {/* 🖐 손 동작 토글 */}
          <button
            onClick={() => setShowCamera((v) => !v)}
            title={t('tool.gesture')}
            style={{
              fontFamily: 'inherit', cursor: 'pointer',
              background: showCamera ? C.purple : '#fff',
              color: showCamera ? '#fff' : C.textDark,
              border: `2px solid ${C.textDark}`, borderRadius: '50%',
              width: 38, height: 38, fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            🖐
          </button>

          {/* 언어 */}
          <div style={{ display: 'flex', gap: 4 }}>
            {LOCALES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLocale(l.code)}
                title={l.label}
                style={{
                  fontFamily: 'inherit', cursor: 'pointer',
                  background: locale === l.code ? C.purple : '#fff',
                  color: locale === l.code ? '#fff' : C.textDark,
                  border: `2px solid ${C.textDark}`, borderRadius: 18,
                  padding: '5px 11px', fontSize: 11, fontWeight: 700,
                }}
              >
                {l.emoji}
              </button>
            ))}
          </div>

          {/* 컨트롤 보드 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.textDark }}>
              {t('control.label')}
            </span>
            <button
              onClick={() => void onToggleConnect()}
              disabled={board.status === 'requesting' || board.status === 'opening'}
              style={{
                fontFamily: 'inherit', cursor: 'pointer',
                background: C.purple, color: '#fff',
                border: 'none', borderRadius: 28,
                padding: '10px 18px', fontSize: 14, fontWeight: 800,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span>{isConnected ? t('control.on') :
                     board.status === 'requesting' ? t('connect.requesting') :
                     board.status === 'opening' ? t('connect.opening') :
                     t('control.off')}</span>
              <span style={{
                width: 18, height: 18, borderRadius: '50%',
                background: isConnected ? C.greenOn : '#bbb',
                border: '2px solid #fff', flexShrink: 0,
              }} />
            </button>
          </div>
        </header>

        {/* 🚗 자동차 작품 시 조이스틱 자동 노출 (입력 박스 위) */}
        {artwork === 'car_4wd' && (
          <div style={{
            background: '#fff', border: `3px solid ${C.textDark}`, borderRadius: 24,
            padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 20,
            boxShadow: `3px 3px 0 ${C.textDark}`, marginBottom: 12,
          }}>
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.textDark, marginBottom: 4 }}>
                🕹 직접 조종
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>
                ⌨️ 화살표 키도 OK
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
          <div style={{
            background: '#fff', border: `3px solid ${C.textDark}`, borderRadius: 24,
            padding: 12, marginBottom: 12, boxShadow: `3px 3px 0 ${C.textDark}`,
          }}>
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
        <div style={{
          background: '#fff', border: `3px solid ${C.textDark}`, borderRadius: 24,
          padding: '24px 30px', minHeight: 220,
          display: 'flex', flexDirection: 'column', position: 'relative',
          boxShadow: `3px 3px 0 ${C.textDark}`,
        }}>
          <textarea
            ref={textareaRef}
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
            style={{
              fontFamily: 'inherit', fontSize: 24, fontWeight: 800,
              color: C.purple, flex: 1, border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', minHeight: 160, lineHeight: 1.4,
              paddingRight: 56,   // 마이크 버튼 자리
            }}
          />
          {(isGenerating || isExecuting) && (
            <div style={{ fontSize: 13, color: C.textMuted, fontWeight: 700 }}>
              {isGenerating ? `💭 ${t('send.thinking')}` : '▶ ...'}
            </div>
          )}
          {/* 마이크 버튼 — 입력 박스 우측 하단 */}
          <button
            onClick={onMicToggle}
            disabled={isGenerating || isExecuting}
            title={listening ? t('mic.listening') : t('mic.start')}
            style={{
              fontFamily: 'inherit', cursor: 'pointer',
              position: 'absolute', right: 16, bottom: 16,
              background: listening ? C.purple : '#fff',
              color: listening ? '#fff' : C.purple,
              border: `2.5px solid ${C.textDark}`, borderRadius: '50%',
              width: 44, height: 44, fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: listening ? 'pulse 1.2s ease-in-out infinite' : 'none',
              boxShadow: `2px 2px 0 ${C.textDark}`,
            }}
          >
            🎤
          </button>
        </div>

        {/* ─── 하단 — 캐릭터 + 메시지 + 마이크 + 거리 (화면 맨 아래 고정) ─── */}
        <div style={{
          marginTop: 'auto',
          background: '#fff', border: `3px solid ${C.textDark}`, borderRadius: 24,
          padding: '18px 24px', display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: `3px 3px 0 ${C.textDark}`,
        }}>
          {/* 캐릭터 */}
          <div style={{
            width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
            background: 'radial-gradient(circle at 35% 35%, #FFD0AC, #FF9D6F)',
            border: `3px solid ${C.textDark}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
          }}>
            🐣
          </div>

          {/* 메시지 */}
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700, color: C.greetingTeal, lineHeight: 1.4 }}>
            {micStatus || statusMessage || t('character.greeting')}
          </div>

          {/* 거리센서 */}
          {isConnected && (
            <div title="거리센서" style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 18, color: C.purple, fontWeight: 800,
              background: C.mainBg, border: `2px solid ${C.textDark}`, borderRadius: 14,
              padding: '6px 10px',
            }}>
              👀
              <span style={{ fontSize: 12 }}>{board.lastDistanceCm ?? '—'}</span>
            </div>
          )}
        </div>

        {/* 키프레임 */}
        <style jsx global>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.08); opacity: 0.85; }
          }
        `}</style>
      </main>
    </div>
  );
}
