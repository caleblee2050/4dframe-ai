'use client';

// 학생용 메인 페이지 — haqizza/mechatronics_controller (Flutter) 디자인 충실 복원.
//
// 원본 레이아웃:
//   AppBar(lightBlue): device명 + Connect/Restart
//   ListTile: 🔵 RSSI ··· connectionState  [Restart]
//   Row(textDirection: rtl) = [Joystick, SpeedGauge, Servo Column]
//                          → 화면 좌→우 = [Servo×2 | SpeedGauge | Joystick]
//
// 우리 추가 (원본 위에 얹기):
//   - AI 자연어 입력 (메인 위 작은 카드)
//   - 동요 칩 (한 줄)
//   - AI 응답 + say 메시지 풍선 (메인 아래)
//   - 카메라 인터랙티브 (토글 시 메인 아래 expand)

import { useMemo, useRef, useState } from 'react';
import { useBoardStore } from '@/lib/serial/webSerial';
import { useCalibrationStore } from '@/lib/calibration/store';
import { runProgram, type InterpreterEvent } from '@/lib/dsl/interpreter';
import { validateProgram, type Program } from '@/lib/dsl/schema';
import { GLOBAL } from '@/lib/commands/commands';
import type { PromptContext } from '@/lib/ai/systemPrompt';
import {
  useSoundStore, playEffect, speakText, stopSpeaking, stripAudioTags, prefetchProgramAudio,
} from '@/lib/sound/soundManager';
import { playMelody, stopMelody, TUNE_LABELS } from '@/lib/sound/melodySynth';
import { Joystick } from '@/components/play/Joystick';
import { SpeedGauge } from '@/components/play/SpeedGauge';
import { ServoGauge } from '@/components/play/ServoGauge';
import { CameraPanel } from '@/components/play/CameraPanel';

// 4DFrame-Android 디자인 톤
//   - 배경 흰색
//   - dongle_bold 폰트 (한국 어린이 친화 둥근 손글씨)
//   - 오렌지 강조 버튼 (ic_btn_fill_org)
//   - 로고/일러스트는 /public/fdland/ 에서
const C = {
  bg: '#FFFFFF',
  scaffoldBg: '#FFFFFF',
  primary: '#FF8A3D',         // 오렌지 (4D Land ic_btn_fill_org 추정)
  primaryDark: '#E5731F',
  primaryLight: '#FFD9B8',
  accent: '#03A9F4',          // 보조 (조이스틱 등에서)
  text: '#212121',
  textSecondary: '#616161',
  textMuted: '#9E9E9E',
  divider: '#E8E8E8',
  border: '#E8E8E8',
  ok: '#4CAF50',
  err: '#F44336',
};

const FONT_PLAY = "'Dongle', 'Jua', 'Noto Sans KR', system-ui, sans-serif";

const ARTWORKS: Array<{ id: PromptContext['artwork']; label: string; emoji: string }> = [
  { id: 'free', label: '자유', emoji: '🛠️' },
  { id: 'viking', label: '바이킹', emoji: '🚣' },
  { id: 'car_4wd', label: '자동차', emoji: '🚗' },
  { id: 'swing', label: '회전그네', emoji: '🎠' },
  { id: 'crocodile', label: '악어', emoji: '🐊' },
];

const TUNE_CHIPS: Array<{ id: keyof typeof TUNE_LABELS; label: string }> = [
  { id: 'school_bell', label: '🔔 학교종' },
  { id: 'twinkle', label: '⭐ 반짝반짝' },
  { id: 'butterfly', label: '🦋 나비야' },
  { id: 'mountain_rabbit', label: '🐰 산토끼' },
  { id: 'three_bears', label: '🐻 곰 세 마리' },
  { id: 'beep_pattern', label: '🎵 띠띠띠' },
];

const SAMPLE_PROMPTS = [
  '바이킹 신나게 흔들어줘',
  '학교종이 땡땡땡 노래로 흔들어줘',
  '자동차 앞으로 갔다 오른쪽',
  '악어 입 으르렁',
];

export default function PlayPage() {
  const board = useBoardStore();
  const cal = useCalibrationStore();
  const sound = useSoundStore();

  const [artwork, setArtwork] = useState<PromptContext['artwork']>('free');
  const [distanceReactivity, setDistanceReactivity] = useState(false);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [program, setProgram] = useState<Program | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);

  const [isExecuting, setIsExecuting] = useState(false);
  const [, setCurrentStepIndex] = useState<number | null>(null);
  const [sayMessages, setSayMessages] = useState<Array<{ text: string; ts: number }>>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
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
    setProgram(null);
    setGenError(null);
    setInput('');
    const newHistory = [...history, { role: 'user' as const, content: prompt }];
    setHistory(newHistory);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context: promptContext, history }),
      });
      if (!res.ok || !res.body) throw new Error(`AI 응답 실패: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
      }
      const cleaned = acc.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
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

  const onResetSession = () => {
    setHistory([]); setProgram(null); setGenError(null); setSayMessages([]); setInput('');
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
          setSayMessages((s) => [...s, { text: stripAudioTags(e.text), ts: Date.now() }]);
          await speakText(e.text);
        }
        else if (e.type === 'play_sound') playEffect(e.sound, e.volume);
        else if (e.type === 'play_tune') {
          if (e.await_melody) await playMelody(e.tune, e.tempo, sound.muted);
          else void playMelody(e.tune, e.tempo, sound.muted);
        }
        else if (e.type === 'calibrate') {
          const msg = ({
            motor_individual_variance: '모터마다 시동이 달라요. 안 돌면 + 눌러봐요.',
            motor_direction_mirror: '거꾸로 돌면 디버그 보드에서 방향 바꿔봐요.',
            servo_power: '9V 배터리 꽂혀 있나 봐줘요!',
          })[e.reason];
          setSayMessages((s) => [...s, { text: `🔧 ${msg}`, ts: Date.now() }]);
        }
      },
    });
    setIsExecuting(false);
    setCurrentStepIndex(null);
  };

  const onStopExecution = async () => {
    abortRef.current?.abort();
    stopSpeaking();
    stopMelody();
    if (isConnected) { try { await board.send(GLOBAL.stopAll); } catch {} }
    setIsExecuting(false);
  };

  const sendByte = async (b: string) => {
    if (!isConnected) return;
    try { await board.send(b); } catch {}
  };

  // 카메라 → 서보 매핑
  const onCameraGesture = async (g: { type: 'hand_open'; openness: number } | { type: 'head_tilt'; dx: number }) => {
    if (!isConnected) return;
    if (g.type === 'hand_open') {
      if (g.openness > 0.6) await sendByte('%');
      else if (g.openness < 0.3) await sendByte('5');
    } else if (g.type === 'head_tilt') {
      if (g.dx > 0.2) await sendByte('D');
      else if (g.dx < -0.2) await sendByte('A');
      else await sendByte('0');
    }
  };

  return (
    <main style={{
      minHeight: '100vh',
      background: C.scaffoldBg,
      color: C.text,
      fontFamily: FONT_PLAY,
      fontWeight: 700,
    }}>
      {/* AppBar (4DFrame-Android 톤: 흰 배경 + 로고 가운데 + 양쪽 버튼) */}
      <header style={{
        background: '#FFFFFF',
        color: C.text,
        height: 64,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${C.divider}`,
      }}>
        {/* 좌측: 음소거 + 카메라 */}
        <button onClick={() => sound.toggleMute()} title="소리" style={appBarBtn}>
          {sound.muted ? '🔇' : '🔊'}
        </button>
        <button onClick={() => setCameraOn(!cameraOn)} title="카메라"
          style={{ ...appBarBtn, background: cameraOn ? C.primaryLight : 'transparent', color: cameraOn ? C.primaryDark : C.text }}>
          📷
        </button>
        {history.length > 0 && (
          <button onClick={onResetSession} title="새로 시작" style={appBarBtn}>🔄</button>
        )}
        {/* 가운데: 로고 (4DFrame-Android logo3.png) */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fdland/logo3.png" alt="4DFrame" style={{ height: 32 }} />
          <span style={{ fontFamily: FONT_PLAY, fontSize: 22, fontWeight: 700, color: C.primaryDark }}>
            친구
          </span>
        </div>
        {/* 우측: Restart + Connect */}
        {isConnected && (
          <button onClick={() => sendByte('Y')} style={ghostBtn}>RESTART</button>
        )}
        {!isConnected ? (
          <button onClick={() => board.connect()}
            disabled={board.status === 'requesting' || board.status === 'opening'}
            style={fillOrgBtn}>
            {board.status === 'requesting' ? '포트 선택…' :
             board.status === 'opening' ? '연결 중…' : '🔌 보드 연결'}
          </button>
        ) : (
          <button onClick={() => board.disconnect()} style={ghostBtn}>연결 끊기</button>
        )}
      </header>

      {board.errorMessage && (
        <div style={{ background: '#FFEBEE', color: C.err, padding: '8px 16px', fontSize: 13, whiteSpace: 'pre-wrap' }}>
          ⚠ {board.errorMessage}
        </div>
      )}

      {/* ListTile: RSSI + connection state + (작품 선택은 우리 추가) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        background: C.bg,
        borderBottom: `1px solid ${C.divider}`,
        minHeight: 56,
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 60 }}>
          <span style={{ fontSize: 22 }}>{isConnected ? '🔵' : '⚪'}</span>
          <span style={{ fontSize: 10, color: C.textMuted }}>
            {isConnected && board.lastBoot ? `FW ${board.lastBoot.fw}` : ''}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {board.status === 'connected' ? 'connected' :
             board.status === 'opening' ? 'opening' :
             board.status === 'requesting' ? 'requesting' :
             board.status === 'error' ? 'error' :
             board.status === 'closing' ? 'closing' : 'disconnected'}
          </div>
          {board.lastDistanceCm !== null && (
            <div style={{ fontSize: 11, color: C.textMuted }}>거리: {board.lastDistanceCm} cm</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ARTWORKS.map((a) => (
            <button key={a.id} onClick={() => setArtwork(a.id)}
              style={{
                ...chipBtn,
                background: artwork === a.id ? C.primary : C.bg,
                color: artwork === a.id ? '#fff' : C.text,
                borderColor: artwork === a.id ? C.primary : C.divider,
              }}>
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI 자연어 영역 (작은 카드, 펼침 가능) */}
      <section style={{
        margin: '12px 16px 0',
        background: C.bg,
        border: `1px solid ${C.divider}`,
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
          cursor: 'pointer', borderBottom: aiPanelOpen ? `1px solid ${C.divider}` : 'none',
        }}
          onClick={() => setAiPanelOpen(!aiPanelOpen)}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.primaryDark }}>💬 AI 친구</span>
          <span style={{ fontSize: 11, color: C.textMuted, flex: 1 }}>
            {history.length > 0 ? `${Math.ceil(history.length / 2)}번째 이야기` : '말로 시키기'}
          </span>
          {history.length > 0 && (
            <button onClick={(e) => { e.stopPropagation(); onResetSession(); }}
              style={{ ...chipBtn, fontSize: 11, padding: '2px 8px' }}>🔄 새로 시작</button>
          )}
          <span style={{ fontSize: 14 }}>{aiPanelOpen ? '▾' : '▸'}</span>
        </div>
        {aiPanelOpen && (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="예: 바이킹 신나게 흔들어줘 / 학교종 노래로 흔들어줘"
                disabled={isGenerating}
                onKeyDown={(e) => { if (e.key === 'Enter') sendPrompt(input); }}
                style={{
                  flex: 1, fontFamily: 'inherit', fontSize: 14,
                  padding: '8px 12px', border: `1px solid ${C.divider}`, borderRadius: 6,
                  background: C.bg, outline: 'none',
                }} />
              <button onClick={() => sendPrompt(input)}
                disabled={isGenerating || input.trim().length === 0}
                style={{
                  ...primaryBtnSm,
                  opacity: (isGenerating || input.trim().length === 0) ? 0.5 : 1,
                }}>
                {isGenerating ? '생각…' : '🪄 보내기'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {SAMPLE_PROMPTS.map((p) => (
                <button key={p} onClick={() => setInput(p)} disabled={isGenerating}
                  style={{ ...chipBtn, fontSize: 10, padding: '3px 8px' }}>{p}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              <span style={{ fontSize: 10, color: C.textMuted, alignSelf: 'center' }}>🎵 노래로:</span>
              {TUNE_CHIPS.map((t) => (
                <button key={t.id}
                  onClick={() => sendPrompt(`${t.label} 노래에 맞춰서 ${ARTWORKS.find(a => a.id === artwork)?.label || '작품'} 움직여줘`)}
                  disabled={isGenerating}
                  style={{ ...chipBtn, fontSize: 10, padding: '3px 8px', background: '#FFF3E0' }}>
                  {t.label}
                </button>
              ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: C.textMuted, cursor: 'pointer' }}>
              <input type="checkbox" checked={distanceReactivity}
                onChange={(e) => setDistanceReactivity(e.target.checked)} />
              👀 거리 반응 모드
            </label>
          </div>
        )}
      </section>

      {/* 카메라 패널 */}
      {cameraOn && (
        <div style={{ margin: '12px 16px 0' }}>
          <CameraPanel onGesture={onCameraGesture} colors={C} />
        </div>
      )}

      {/* AI 응답 미리보기 */}
      {(program || genError) && (
        <section style={{
          margin: '12px 16px 0',
          background: C.bg,
          border: `1px solid ${C.divider}`,
          borderRadius: 8,
          padding: 12,
        }}>
          {genError ? (
            <div style={{ color: C.err, fontSize: 13 }}>오류: {genError}</div>
          ) : program ? (
            <div>
              {program.intro && (
                <div style={{ background: C.primaryLight, padding: 10, borderRadius: 6, marginBottom: 8, fontSize: 14 }}>
                  💭 {stripAudioTags(program.intro)}
                </div>
              )}
              {program.steps.length === 0 && (
                <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 }}>
                  (친구가 먼저 물어봤어요 ↓)
                </div>
              )}
              {program.questions && program.questions.length > 0 && (
                <div style={{ background: '#FFF3E0', border: `1px solid ${C.accent}`, borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  {program.questions.map((q, i) => (
                    <div key={i} style={{ fontSize: 13, marginBottom: 2 }}>🤔 {q}</div>
                  ))}
                </div>
              )}
              {program.variation_chips && program.variation_chips.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {program.variation_chips.map((c, i) => (
                    <button key={i} onClick={() => sendPrompt(c)} disabled={isGenerating}
                      style={{ ...chipBtn, background: C.accent, color: '#fff', borderColor: C.accent, fontSize: 11 }}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {program.steps.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {!isExecuting ? (
                    <button onClick={onExecute} disabled={!isConnected}
                      style={{ ...primaryBtnSm, fontSize: 14, padding: '8px 16px' }}>
                      ▶ 작동시키기
                    </button>
                  ) : (
                    <button onClick={onStopExecution}
                      style={{ ...primaryBtnSm, fontSize: 14, padding: '8px 16px', background: C.err }}>
                      ⏹ 정지
                    </button>
                  )}
                  {!isConnected && <span style={{ alignSelf: 'center', fontSize: 11, color: C.textMuted }}>(보드 연결 필요)</span>}
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {/* say 메시지 풍선 */}
      {sayMessages.length > 0 && (
        <section style={{ margin: '8px 16px 0' }}>
          {sayMessages.map((m, i) => (
            <div key={i} style={{
              background: '#E1F5FE', border: `1px solid ${C.primaryLight}`,
              padding: 8, borderRadius: 8, fontSize: 13, marginBottom: 4,
            }}>
              {m.text}
            </div>
          ))}
        </section>
      )}

      {/*
        메인 수동 조종 — 원본 Flutter Row(textDirection: rtl)
        화면 좌→우 순서: [Servo Column | SpeedGauge (Expanded) | Joystick]
      */}
      <section style={{
        margin: '12px 16px 16px',
        padding: 12,
        background: C.bg,
        border: `1px solid ${C.divider}`,
        borderRadius: 8,
        display: 'grid',
        gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 2fr) minmax(220px, 1fr)',
        gap: 16,
        alignItems: 'center',
      }}>
        {/* 좌: Servo Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 500, textAlign: 'center' }}>Servo</div>
          <ServoGauge label="A (입)" onUp={() => void sendByte('%')} onDown={() => void sendByte('5')} disabled={!isConnected} colors={C} />
          <ServoGauge label="B (꼬리)" onUp={() => void sendByte('6')} onDown={() => void sendByte('^')} disabled={!isConnected} colors={C} />
        </div>

        {/* 중앙: SpeedGauge (Expanded) */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <SpeedGauge onSpeedChange={(v) => void sendByte(`V${v}`)} disabled={!isConnected} colors={C} />
        </div>

        {/* 우: Joystick */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Joystick onDirection={(dir) => {
            const map: Record<string, string> = { up: 'W', down: 'S', left: 'A', right: 'D', stop: '0' };
            void sendByte(map[dir] ?? '0');
          }} disabled={!isConnected} colors={C} />
        </div>
      </section>
    </main>
  );
}

// 4DFrame-Android 스타일 버튼
const appBarBtn: React.CSSProperties = {
  fontFamily: FONT_PLAY, fontSize: 18,
  background: 'transparent', color: '#212121',
  border: 'none', borderRadius: 999, width: 40, height: 40, cursor: 'pointer',
};

// 오렌지 채워진 버튼 (ic_btn_fill_org)
const fillOrgBtn: React.CSSProperties = {
  fontFamily: FONT_PLAY, fontWeight: 700, fontSize: 18,
  background: '#FF8A3D', color: '#fff',
  border: 'none', borderRadius: 999,
  padding: '10px 20px', cursor: 'pointer',
  boxShadow: '0 2px 4px rgba(255, 138, 61, 0.3)',
};

// 외곽선 버튼 (Disconnect 등)
const ghostBtn: React.CSSProperties = {
  fontFamily: FONT_PLAY, fontWeight: 700, fontSize: 16,
  background: '#FFFFFF', color: '#FF8A3D',
  border: '2px solid #FF8A3D', borderRadius: 999,
  padding: '8px 16px', cursor: 'pointer',
};

const primaryBtnSm: React.CSSProperties = {
  fontFamily: FONT_PLAY, fontWeight: 700, fontSize: 18,
  background: '#FF8A3D', color: '#fff',
  border: 'none', borderRadius: 999,
  padding: '10px 18px', cursor: 'pointer',
  boxShadow: '0 2px 4px rgba(255, 138, 61, 0.3)',
};

const chipBtn: React.CSSProperties = {
  fontFamily: FONT_PLAY, fontWeight: 700, fontSize: 16,
  background: '#fff', color: '#212121',
  border: '1px solid #E8E8E8', borderRadius: 999,
  padding: '4px 14px', cursor: 'pointer',
};
