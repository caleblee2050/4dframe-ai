'use client';

// 학생용 메인 페이지 — 자연어로 4D프레임 작품을 동작시킨다.
//
// 흐름: 자연어 입력 → /api/chat 스트리밍 → JSON DSL 누적 → validateProgram → 미리보기 → ▶ 실행 → 보드 송신
// 보조: 모터 캘리브 카드 (시동 V 조절), 거리센서 위젯 + 거리 반응 토글, 보드 연결 헤더.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Joystick } from '@/components/play/Joystick';
import { isV13Plus } from '@/lib/commands/commands';
import { useBoardStore } from '@/lib/serial/webSerial';
import { useCalibrationStore } from '@/lib/calibration/store';
import { runProgram, type InterpreterEvent } from '@/lib/dsl/interpreter';
import { validateProgram, type Program, type Step, type MotorId } from '@/lib/dsl/schema';
import { palette, radius, shadow, border, motion as m } from '@/lib/design/tokens';
import { MOTORS, GLOBAL } from '@/lib/commands/commands';
import type { PromptContext } from '@/lib/ai/systemPrompt';
import { useSoundStore, playEffect, speakText, stopSpeaking, stripAudioTags, prefetchProgramAudio } from '@/lib/sound/soundManager';

const MOTOR_IDS: MotorId[] = ['M1', 'M2', 'M3', 'M4'];

const ARTWORKS: Array<{ id: PromptContext['artwork']; label: string; emoji: string }> = [
  { id: 'free', label: '자유', emoji: '🛠️' },
  { id: 'viking', label: '바이킹', emoji: '🚣' },
  { id: 'car_4wd', label: '자동차', emoji: '🚗' },
  { id: 'swing', label: '회전그네', emoji: '🎠' },
  { id: 'crocodile', label: '악어', emoji: '🐊' },
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

  // 🕹 직접 조종 — 차동 조향 (skid steering).
  // 좌/우 가상 모터 = 4WD 의 (M1+M3) / (M2+M4). 한 축 두 바퀴 자동차도 같은 매핑으로 직진/제자리회전.
  // PWM 개별 변조 (X{idx}{duty}) 는 v1.3+ 만 지원 → fw 자동 분기.
  const lastJoyRef = useRef<{ t: number; signature: string }>({ t: 0, signature: '' });
  const onJoystickMove = useCallback((x: number, y: number, mag: number) => {
    if (!isConnected) return;
    const now = Date.now();
    if (now - lastJoyRef.current.t < 80) return;   // 80ms throttle

    // 화면 좌표 → 차동 조향. y 화면 아래가 양수, 우리는 forward = 위 = y<0.
    const fwd = -y;
    const turn = x;
    let left = fwd + turn;
    let right = fwd - turn;
    const norm = Math.max(Math.abs(left), Math.abs(right), 1);
    left /= norm; right /= norm;

    const fw = board.lastBoot?.fw;
    const v13 = isV13Plus(fw);

    if (mag === 0) {
      const sig = 'STOP';
      if (lastJoyRef.current.signature === sig) return;
      lastJoyRef.current = { t: now, signature: sig };
      void board.send(GLOBAL.stopAll);
      return;
    }

    const lLevel = Math.min(9, Math.round(Math.abs(left) * 9));
    const rLevel = Math.min(9, Math.round(Math.abs(right) * 9));
    const lDir = left > 0.05 ? 1 : left < -0.05 ? -1 : 0;
    const rDir = right > 0.05 ? 1 : right < -0.05 ? -1 : 0;

    // 같은 명령 반복 송신 방지 (시리얼 포화 + 펌웨어 race 회피)
    const sig = `${lLevel}.${lDir}|${rLevel}.${rDir}`;
    if (lastJoyRef.current.signature === sig) return;
    lastJoyRef.current = { t: now, signature: sig };

    const cmds: string[] = [];
    if (v13) {
      // 좌 = M1(D6 idx=1) + M3(D9 idx=2). 우 = M2(D5 idx=0) + M4(D10 idx=3).
      cmds.push(`X1${lLevel}`, `X2${lLevel}`, `X0${rLevel}`, `X3${rLevel}`);
    }
    // PWM 0 인 모터는 시동 명령 생략 (어차피 안 도니까)
    if (lLevel > 0 && lDir !== 0) {
      cmds.push(lDir > 0 ? '1' : '!');
      cmds.push(lDir > 0 ? '3' : '#');
    }
    if (rLevel > 0 && rDir !== 0) {
      cmds.push(rDir > 0 ? '2' : '@');
      cmds.push(rDir > 0 ? '4' : '$');
    }
    if (cmds.length > 0) void board.send(cmds.join(''));
  }, [board, isConnected]);

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
          {!isConnected ? (
            <button
              onClick={() => board.connect()}
              style={btn(palette.tertiary, '#fff')}
              disabled={board.status === 'requesting' || board.status === 'opening'}
            >
              {board.status === 'requesting' ? '포트 선택 중…' :
               board.status === 'opening' ? '연결 중…' : '🔌 보드 연결'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: palette.textMuted }}>
                {board.lastBoot ? `${board.lastBoot.boardId} / FW${board.lastBoot.fw}` : 'connected'}
              </span>
              <button onClick={() => board.disconnect()} style={btn(palette.primary, '#fff')}>연결 끊기</button>
            </div>
          )}
        </header>

        {board.errorMessage && (
          <div style={{ ...card, background: '#FFE6E6', borderColor: palette.primary }}>
            <strong style={{ color: palette.primary }}>오류:</strong> {board.errorMessage}
          </div>
        )}

        {/* 작품 선택 + 거리 반응 토글 */}
        <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 6 }}>내 작품</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ARTWORKS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setArtwork(a.id)}
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
          </div>
          <div style={{ flex: 1 }} />
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            background: distanceReactivity ? palette.accent : palette.tilePink,
            border: border.brutal, borderRadius: radius.sm, padding: '8px 12px',
            boxShadow: shadow.brutalSm,
          }}>
            <input
              type="checkbox"
              checked={distanceReactivity}
              onChange={(e) => setDistanceReactivity(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span style={{ fontWeight: 800, fontSize: 13 }}>👀 거리 반응 모드</span>
          </label>
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
        </section>

        {/* 🕹 직접 조종 — 자동차 작품 선택 시 노출 (차동 조향). */}
        {(artwork === 'car_4wd') && (
          <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 4 }}>🕹 직접 조종</div>
              <div style={{ fontSize: 11, color: palette.textMuted, lineHeight: 1.4 }}>
                위/아래 = 전후진 속도<br/>
                좌/우 = 회전<br/>
                대각선 = 속도+회전 동시
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
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="예: 바이킹을 더 신나게 흔들어줘"
            disabled={isGenerating}
            style={{
              width: '100%',
              minHeight: 80,
              fontFamily: 'inherit',
              fontSize: 15,
              fontWeight: 600,
              padding: 12,
              border: border.brutal,
              borderRadius: radius.sm,
              background: palette.bg,
              boxShadow: shadow.brutalSm,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button
              onClick={onGenerate}
              disabled={isGenerating || input.trim().length === 0}
              style={{
                ...btn(palette.primary, '#fff'),
                opacity: (isGenerating || input.trim().length === 0) ? 0.5 : 1,
              }}
            >
              {isGenerating ? '생각 중…' : '🪄 보내기'}
            </button>
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

        {/* AI 응답 영역 */}
        {(isGenerating || streamedText || program || genError) && (
          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🪄 AI 짝코더 응답</div>
            {genError ? (
              <div style={{ background: '#FFE6E6', border: border.brutal, borderRadius: radius.sm, padding: 12, fontSize: 13 }}>
                <strong style={{ color: palette.primary }}>오류:</strong>
                <pre style={{ whiteSpace: 'pre-wrap', marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {genError}
                </pre>
              </div>
            ) : program ? (
              <div>
                {program.intro && (
                  <div style={{ background: palette.tileBlue, border: border.brutal, borderRadius: radius.sm, padding: 12, marginBottom: 10 }}>
                    💭 {program.intro}
                  </div>
                )}
                {program.steps.length === 0 && (
                  <div style={{ fontSize: 13, color: palette.textMuted, fontStyle: 'italic', marginBottom: 10 }}>
                    (코드 없이 짝코더가 먼저 물어봤어요. 아래 칩을 누르거나 답해주세요.)
                  </div>
                )}
                <ol style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
                  {program.steps.map((step, i) => {
                    const active = currentStepIndex === i;
                    return (
                      <li
                        key={i}
                        style={{
                          padding: '8px 12px',
                          marginBottom: 6,
                          borderRadius: radius.sm,
                          border: border.brutal,
                          background: active ? palette.secondary : (i % 2 ? palette.bg : palette.panel),
                          fontWeight: active ? 900 : 600,
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 18 }}>{stepIcon[step.do]}</span>
                          <span style={{ fontSize: 12, color: palette.textMuted, minWidth: 22 }}>#{i + 1}</span>
                          <span style={{ fontSize: 13 }}>{describeStep(step)}</span>
                        </div>
                        {step.hint && (
                          <div style={{
                            fontSize: 12,
                            color: palette.textMuted,
                            paddingLeft: 36,
                            fontWeight: 500,
                            fontStyle: 'italic',
                          }}>
                            💡 {step.hint}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {program.learning_points && program.learning_points.length > 0 && (
                  <div style={{
                    marginTop: 12,
                    background: palette.tileMint,
                    border: border.brutal,
                    borderRadius: radius.sm,
                    padding: 12,
                    boxShadow: shadow.brutalSm,
                  }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>💡 오늘 배운 것</div>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {program.learning_points.map((lp, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{lp}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {program.questions && program.questions.length > 0 && (
                  <div style={{
                    marginTop: 12,
                    background: palette.tilePink,
                    border: border.brutal,
                    borderRadius: radius.sm,
                    padding: 12,
                    boxShadow: shadow.brutalSm,
                  }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>🤔 짝코더가 물어봐요</div>
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      {program.questions.map((q, i) => (
                        <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {program.variation_chips && program.variation_chips.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 6, fontWeight: 700 }}>
                      ✨ 다음에 해볼까? (눌러서 보내기)
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {program.variation_chips.map((chip, i) => (
                        <button
                          key={i}
                          onClick={() => sendPrompt(chip)}
                          disabled={isGenerating}
                          style={{
                            fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
                            background: palette.secondary,
                            border: border.brutal, borderRadius: 999,
                            padding: '6px 14px', cursor: 'pointer',
                            boxShadow: shadow.brutalSm,
                          }}
                        >{chip}</button>
                      ))}
                    </div>
                  </div>
                )}
                {program.steps.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    {!isExecuting ? (
                      <button onClick={onExecute} disabled={!isConnected} style={btn(palette.tertiary, '#fff')}>
                        ▶ 실행
                      </button>
                    ) : (
                      <button onClick={onStopExecution} style={btn(palette.primary, '#fff')}>⏹ 정지</button>
                    )}
                    {!isConnected && (
                      <span style={{ fontSize: 11, color: palette.textMuted, alignSelf: 'center' }}>
                        (보드를 연결하면 실행 가능)
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: palette.textMuted, whiteSpace: 'pre-wrap' }}>
                {streamedText || '...'}
              </div>
            )}
          </section>
        )}

        {/* 메시지 풍선 */}
        {sayMessages.length > 0 && (
          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>💬 짝코더 메시지</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sayMessages.map((m, i) => (
                <div key={i} style={{ background: palette.accent, border: border.brutal, borderRadius: radius.sm, padding: '8px 12px', fontSize: 13 }}>
                  {m.text}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 모터 캘리브 + 거리센서 */}
        <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔧 내 모터 길들이기</div>
            <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 10 }}>
              ▶ 시동 눌러보고, 안 돌면 + 로 한 칸씩 올려보세요.
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

          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>👀 거리센서</div>
            <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 10 }}>
              앞에 있는 물체와의 거리
            </div>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontWeight: 900, fontSize: 56, lineHeight: 1, color: distanceReactivity ? palette.tertiary : palette.textMuted }}>
                {board.lastDistanceCm ?? '—'}
              </div>
              <div style={{ fontSize: 13, color: palette.textMuted, marginTop: 4 }}>cm</div>
            </div>
            <div style={{
              height: 8, borderRadius: 4, background: palette.bg, border: border.brutal, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${Math.min(100, ((board.lastDistanceCm ?? 0) / 75) * 100)}%`,
                background: palette.tertiary,
                transition: `width ${m.fast}`,
              }} />
            </div>
            {!distanceReactivity && (
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 8, textAlign: 'center' }}>
                거리 반응 모드를 켜면 AI가 거리에 반응하는 코드를 만들어요.
              </div>
            )}
          </div>
        </section>

      </div>
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
