'use client';

// 학생용 메인 페이지 (디자인 원본 복원)
//
// 원본: haqizza/mechatronics_controller (Flutter, Material lightBlue)
//   - 가로 레이아웃, 좌(가상 조이스틱) + 중(속도 게이지 + 자연어 입력) + 우(서보×2)
// 우리 적용: USB Serial + 펌웨어 v1.0/v1.3 호환 어휘 + AI 자연어 + 음악(전자음) + 카메라 인터랙티브
//
// 페르소나: 유치원~초등 저학년. 코딩 설명 없음. 친근한 완구 톤.

import { useEffect, useMemo, useRef, useState } from 'react';
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

// Material lightBlue 톤
const C = {
  bg: '#FAFAFA',
  panel: '#FFFFFF',
  primary: '#03A9F4',       // lightBlue 500
  primaryDark: '#0288D1',
  primaryLight: '#B3E5FC',
  accent: '#FF9800',        // orange 500
  text: '#212121',
  textMuted: '#757575',
  border: '#E0E0E0',
  shadow: '0 2px 8px rgba(0,0,0,0.08)',
  shadowLg: '0 4px 16px rgba(0,0,0,0.12)',
  ok: '#4CAF50',
  err: '#F44336',
};

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
  '학교종이 땡땡땡에 맞춰 흔들어줘',
  '자동차로 앞으로 갔다가 오른쪽으로',
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
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null);
  const [sayMessages, setSayMessages] = useState<Array<{ text: string; ts: number }>>([]);
  const [cameraOn, setCameraOn] = useState(false);
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
            motor_individual_variance: '모터마다 시동 V가 달라요. 안 돌면 + 눌러봐요.',
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

  // 수동 조종 — 시리얼 직접 송신
  const sendByte = async (b: string) => {
    if (!isConnected) return;
    try { await board.send(b); } catch {}
  };

  // 카메라 인터랙티브 콜백 — MediaPipe 가 손/얼굴 검출하면 호출
  const onCameraGesture = async (gesture: { type: 'hand_open'; openness: number } | { type: 'head_tilt'; dx: number }) => {
    if (!isConnected) return;
    if (gesture.type === 'hand_open') {
      // 손 펼침 정도 (0~1) → 서보 SA 각도 (펼치면 +15도, 오므리면 -15도)
      // 임계값 기반 단순 매핑 — 0.6 이상 펼침 = +15도, 0.3 이하 = -15도
      if (gesture.openness > 0.6) await sendByte('%');
      else if (gesture.openness < 0.3) await sendByte('5');
    } else if (gesture.type === 'head_tilt') {
      // 머리 좌우 기울임 → 자동차 방향
      if (gesture.dx > 0.2) await sendByte('D');
      else if (gesture.dx < -0.2) await sendByte('A');
      else await sendByte('0');
    }
  };

  const cardStyle: React.CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    boxShadow: C.shadow,
    padding: 16,
  };

  return (
    <main style={{
      minHeight: '100vh',
      background: C.bg,
      color: C.text,
      fontFamily: "'Outfit', 'Noto Sans KR', system-ui, sans-serif",
      fontWeight: 500,
    }}>
      {/* 상단 AppBar */}
      <header style={{
        background: C.primary,
        color: '#fff',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: C.shadowLg,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#fff', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14 }}>4D</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>4DFrame 친구</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            {board.lastBoot ? `${board.lastBoot.boardId} / FW${board.lastBoot.fw}` : '말로 작품을 움직여 보세요'}
          </div>
        </div>
        <button onClick={() => sound.toggleMute()} title={sound.muted ? '소리 켜기' : '소리 끄기'}
          style={iconBtn}>{sound.muted ? '🔇' : '🔊'}</button>
        <button onClick={() => setCameraOn(!cameraOn)} title="카메라 인터랙티브"
          style={{ ...iconBtn, background: cameraOn ? C.accent : 'rgba(255,255,255,0.2)' }}>📷</button>
        {history.length > 0 && (
          <button onClick={onResetSession} style={iconBtn} title="새로 시작">🔄</button>
        )}
        {!isConnected ? (
          <button onClick={() => board.connect()}
            disabled={board.status === 'requesting' || board.status === 'opening'}
            style={primaryBtn}>
            {board.status === 'requesting' ? '포트 선택 중…' :
             board.status === 'opening' ? '연결 중…' : '🔌 보드 연결'}
          </button>
        ) : (
          <button onClick={() => board.disconnect()} style={{ ...primaryBtn, background: '#fff', color: C.err }}>
            연결 끊기
          </button>
        )}
      </header>

      {board.errorMessage && (
        <div style={{ background: '#FFEBEE', color: C.err, padding: '10px 20px', fontSize: 13, whiteSpace: 'pre-wrap' }}>
          ⚠ {board.errorMessage}
        </div>
      )}

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 작품 선택 + 거리 반응 */}
        <section style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 700 }}>내 작품</div>
          {ARTWORKS.map((a) => (
            <button key={a.id} onClick={() => setArtwork(a.id)}
              style={{
                ...chipBtn,
                background: artwork === a.id ? C.primary : '#fff',
                color: artwork === a.id ? '#fff' : C.text,
                borderColor: artwork === a.id ? C.primary : C.border,
              }}>
              {a.emoji} {a.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12,
            background: distanceReactivity ? '#E8F5E9' : '#FAFAFA',
            border: `1px solid ${distanceReactivity ? C.ok : C.border}`,
            borderRadius: 999, padding: '6px 12px',
          }}>
            <input type="checkbox" checked={distanceReactivity}
              onChange={(e) => setDistanceReactivity(e.target.checked)} />
            👀 거리 반응
          </label>
        </section>

        {/* 카메라 패널 (토글 시 등장) */}
        {cameraOn && (
          <CameraPanel onGesture={onCameraGesture} colors={C} />
        )}

        {/* 자연어 입력 */}
        <section style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>💬 친구한테 말하기</div>
            {history.length > 0 && (
              <span style={{ fontSize: 11, color: C.textMuted }}>{Math.ceil(history.length / 2)}번째 이야기</span>
            )}
          </div>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="예: 바이킹 신나게 흔들어줘 / 학교종 노래로 흔들어줘"
            disabled={isGenerating}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPrompt(input); }}
            style={{
              width: '100%', minHeight: 60, fontFamily: 'inherit', fontSize: 16, fontWeight: 500,
              padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, background: '#FAFAFA',
              resize: 'vertical', outline: 'none',
            }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={() => sendPrompt(input)}
              disabled={isGenerating || input.trim().length === 0}
              style={{
                ...primaryBtn, background: C.primary,
                opacity: (isGenerating || input.trim().length === 0) ? 0.5 : 1,
              }}>
              {isGenerating ? '생각 중…' : '🪄 보내기'}
            </button>
            {SAMPLE_PROMPTS.map((p) => (
              <button key={p} onClick={() => setInput(p)} disabled={isGenerating}
                style={{ ...chipBtn, fontSize: 11, padding: '4px 10px' }}>{p}</button>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>🎵 노래 골라서 같이 움직이게:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TUNE_CHIPS.map((t) => (
                <button key={t.id}
                  onClick={() => sendPrompt(`${t.label} 음악에 맞춰서 ${ARTWORKS.find(a => a.id === artwork)?.label || '작품'} 움직여줘`)}
                  disabled={isGenerating}
                  style={{ ...chipBtn, fontSize: 12, padding: '6px 12px', background: '#FFF3E0' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* AI 응답 미리보기 */}
        {(program || genError || isGenerating) && (
          <section style={cardStyle}>
            {genError ? (
              <div style={{ color: C.err, fontSize: 13 }}>오류: {genError}</div>
            ) : program ? (
              <div>
                {program.intro && (
                  <div style={{ background: C.primaryLight, padding: 12, borderRadius: 8, marginBottom: 10, fontSize: 14 }}>
                    💭 {stripAudioTags(program.intro)}
                  </div>
                )}
                {program.steps.length === 0 && (
                  <div style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic', marginBottom: 10 }}>
                    (친구가 먼저 물어봤어요 ↓)
                  </div>
                )}
                {/* steps 자체는 학생용 페이지에선 코딩 카드 안 보여줌 — 직접 ▶ 실행만 */}
                {program.questions && program.questions.length > 0 && (
                  <div style={{ background: '#FFF3E0', border: `1px solid ${C.accent}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
                    {program.questions.map((q, i) => (
                      <div key={i} style={{ fontSize: 14, marginBottom: 4 }}>🤔 {q}</div>
                    ))}
                  </div>
                )}
                {program.variation_chips && program.variation_chips.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {program.variation_chips.map((c, i) => (
                      <button key={i} onClick={() => sendPrompt(c)} disabled={isGenerating}
                        style={{ ...chipBtn, background: C.accent, color: '#fff', borderColor: C.accent }}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                {program.steps.length > 0 && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!isExecuting ? (
                      <button onClick={onExecute} disabled={!isConnected}
                        style={{ ...primaryBtn, fontSize: 16, padding: '12px 20px' }}>
                        ▶ 작동시키기
                      </button>
                    ) : (
                      <button onClick={onStopExecution} style={{ ...primaryBtn, background: C.err }}>
                        ⏹ 정지
                      </button>
                    )}
                    {!isConnected && <span style={{ alignSelf: 'center', fontSize: 12, color: C.textMuted }}>(보드 연결 필요)</span>}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.textMuted }}>친구가 생각 중...</div>
            )}
          </section>
        )}

        {/* say 메시지 풍선 */}
        {sayMessages.length > 0 && (
          <section style={cardStyle}>
            {sayMessages.map((m, i) => (
              <div key={i} style={{
                background: '#E1F5FE', border: `1px solid ${C.primaryLight}`,
                padding: 10, borderRadius: 12, fontSize: 14, marginBottom: 6,
              }}>
                {m.text}
              </div>
            ))}
          </section>
        )}

        {/* 수동 조종 — 좌(조이스틱) | 중(속도) | 우(서보×2) */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted }}>🕹️ 조종</div>
            <Joystick onDirection={(dir) => {
              const map: Record<string, string> = { up: 'W', down: 'S', left: 'A', right: 'D', stop: '0' };
              void sendByte(map[dir] ?? '0');
            }} disabled={!isConnected} colors={C} />
          </div>

          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted }}>⚡ 속도</div>
            <SpeedGauge onSpeedChange={(v) => void sendByte(`V${v}`)} disabled={!isConnected} colors={C} />
          </div>

          <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, textAlign: 'center' }}>🎚 서보</div>
            <ServoGauge label="A (입)" onUp={() => void sendByte('%')} onDown={() => void sendByte('5')} disabled={!isConnected} colors={C} />
            <ServoGauge label="B (꼬리)" onUp={() => void sendByte('6')} onDown={() => void sendByte('^')} disabled={!isConnected} colors={C} />
          </div>
        </section>

      </div>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  fontFamily: 'inherit', fontWeight: 700, fontSize: 14,
  background: '#fff', color: C.primary,
  border: 'none', borderRadius: 8,
  padding: '8px 14px', cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
  fontFamily: 'inherit', fontSize: 16,
  background: 'rgba(255,255,255,0.2)', color: '#fff',
  border: 'none', borderRadius: 999,
  width: 36, height: 36, cursor: 'pointer',
};

const chipBtn: React.CSSProperties = {
  fontFamily: 'inherit', fontWeight: 600, fontSize: 12,
  background: '#fff', color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 999,
  padding: '6px 12px', cursor: 'pointer',
};

// stepIcon, describeStep 은 학생용에선 사용 안 함 (코딩 카드 표시 안 함).
// 디버그 보드 (/play/test) 에서만 사용.
