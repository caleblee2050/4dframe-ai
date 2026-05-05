'use client';

// /play/test — Web Serial + 인터프리터 + JSON DSL 송수신 검증 페이지.
// 5/10 데모 페이지가 아닌 디버그 보드. 키즈 톤만 가져와 동작 확인용.
//
// 흐름: 보드 연결 → 시연용 Program 실행 → 시리얼 라인/거리/진단 라이브 표시 → 정지/캘리브레이션 토글.

import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from '@/lib/serial/webSerial';
import { useCalibrationStore } from '@/lib/calibration/store';
import { runProgram, type InterpreterEvent } from '@/lib/dsl/interpreter';
import { validateProgram, type Program, type MotorId } from '@/lib/dsl/schema';
import { palette, radius, shadow, border, motion as m } from '@/lib/design/tokens';
import { MOTORS, GLOBAL } from '@/lib/commands/commands';

const MOTOR_IDS: MotorId[] = ['M1', 'M2', 'M3', 'M4'];

// 시연용 Program 카드들
const PROGRAMS: Array<{ id: string; label: string; emoji: string; program: Program }> = [
  {
    id: 'spin-m1',
    label: 'M1 천천히 1초',
    emoji: '🔄',
    program: {
      schema_version: 1,
      intro: '모터 1을 천천히 돌려볼게요.',
      steps: [{ do: 'spin', motor: 'M1', speed: '천천히', duration_ms: 1000 }],
    },
  },
  {
    id: 'spin-m4',
    label: 'M4 보통 1초',
    emoji: '🐌',
    program: {
      schema_version: 1,
      intro: '모터 4는 다른 친구들보다 시동이 빡빡해요. 보통 속도로 1초 돌려볼게요.',
      steps: [{ do: 'spin', motor: 'M4', speed: '보통', duration_ms: 1000 }],
    },
  },
  {
    id: 'viking',
    label: '바이킹 흔들기 (M1+M3)',
    emoji: '🚣',
    program: {
      schema_version: 1,
      artwork: 'viking',
      intro: '바이킹은 진자라서 양쪽 힘이 같으면 안 흔들려요. 한쪽을 더 세게 해볼게요.',
      steps: [
        { do: 'spin', motor: 'M1', speed: '보통' },
        { do: 'spin', motor: 'M3', speed: '빠르게', duration_ms: 2500 },
        { do: 'stop' },
        { do: 'say', text: '바이킹이 한 쪽으로 더 강하게 밀려서 흔들렸어요!' },
      ],
    },
  },
  {
    id: 'drive-fwd',
    label: '4WD 전진 1초',
    emoji: '🚗',
    program: {
      schema_version: 1,
      artwork: 'car_4wd',
      steps: [{ do: 'drive', heading: 'forward', speed: '보통', duration_ms: 1000 }],
    },
  },
  {
    id: 'servo',
    label: '서보 A +30도 / -30도',
    emoji: '🦷',
    program: {
      schema_version: 1,
      steps: [
        { do: 'servo', servo: 'SA', step: 2 },
        { do: 'wait', ms: 400 },
        { do: 'servo', servo: 'SA', step: -2 },
      ],
    },
  },
];

const card: React.CSSProperties = {
  background: palette.panel,
  border: border.brutal,
  borderRadius: radius.md,
  boxShadow: shadow.brutal,
  padding: 16,
};

const buttonBase: React.CSSProperties = {
  border: border.brutal,
  borderRadius: radius.sm,
  padding: '10px 16px',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: shadow.brutalSm,
  transition: `all ${m.fast}`,
  fontFamily: 'inherit',
};

export default function PlayTestPage() {
  const board = useBoardStore();
  const cal = useCalibrationStore();

  const [running, setRunning] = useState<string | null>(null);
  const [events, setEvents] = useState<InterpreterEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const linesEndRef = useRef<HTMLDivElement | null>(null);
  const eventsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    linesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [board.lines]);
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const onRun = async (id: string, program: Program) => {
    if (running) return;
    if (board.status !== 'connected') {
      alert('먼저 보드를 연결해주세요.');
      return;
    }
    try {
      validateProgram(program);
    } catch (e) {
      alert(`프로그램 검증 실패: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setRunning(id);
    setEvents([]);
    abortRef.current = new AbortController();
    await runProgram(program, {
      signal: abortRef.current.signal,
      onEvent: (e) => setEvents((prev) => [...prev, e]),
    });
    setRunning(null);
  };

  const onStop = async () => {
    abortRef.current?.abort();
    if (board.status === 'connected') {
      try { await board.send(GLOBAL.stopAll); } catch {}
    }
    setRunning(null);
  };

  const onDiagnostic = async () => {
    if (board.status !== 'connected') return;
    await board.send(GLOBAL.diagnostic);
  };

  const onToggleDir = async (motor: MotorId) => {
    if (board.status === 'connected') {
      await board.send(MOTORS[motor].dirToggleSeq);
    }
    cal.toggleDir(motor);
  };

  const isConnected = board.status === 'connected';

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
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <header style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            width: 48, height: 48, borderRadius: radius.sm,
            background: palette.secondary, border: border.brutal,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>4D</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Play Test — 보드 연결 + DSL 검증</h1>
            <div style={{ fontSize: 13, color: palette.textMuted, marginTop: 4 }}>
              펌웨어 v1.3 / Web Serial — Chrome 또는 Edge 에서만 동작합니다.
            </div>
          </div>
          {!isConnected ? (
            <button
              onClick={() => board.connect()}
              style={{ ...buttonBase, background: palette.tertiary, color: '#fff' }}
              disabled={board.status === 'requesting' || board.status === 'opening'}
            >
              {board.status === 'requesting' ? '포트 선택 중…' :
               board.status === 'opening' ? '연결 중…' : '🔌 보드 연결'}
            </button>
          ) : (
            <button
              onClick={() => board.disconnect()}
              style={{ ...buttonBase, background: palette.primary, color: '#fff' }}
            >
              🔌 연결 끊기
            </button>
          )}
        </header>

        {board.errorMessage && (
          <div style={{ ...card, background: '#FFE6E6', borderColor: palette.primary }}>
            <strong style={{ color: palette.primary }}>오류:</strong> {board.errorMessage}
          </div>
        )}

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <h2 style={{ marginTop: 0 }}>보드 상태</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 14 }}>
              <span style={{ color: palette.textMuted }}>상태</span>
              <span><strong>{board.status}</strong></span>
              <span style={{ color: palette.textMuted }}>부팅 메시지</span>
              <span>{board.lastBoot ? `${board.lastBoot.boardId} / FW${board.lastBoot.fw}` : '—'}</span>
              <span style={{ color: palette.textMuted }}>마지막 거리</span>
              <span>{board.lastDistanceCm !== null ? `${board.lastDistanceCm} cm` : '—'}</span>
            </div>
            <button
              onClick={onDiagnostic}
              disabled={!isConnected}
              style={{ ...buttonBase, marginTop: 12, background: palette.blueAccent, color: '#fff', opacity: isConnected ? 1 : 0.5 }}
            >
              ? 진단 명령 전송
            </button>
            {board.lastDiagnostic && (
              <pre style={{
                marginTop: 12, fontSize: 12, fontFamily: 'ui-monospace, monospace',
                background: '#F7F4EA', padding: 8, borderRadius: radius.sm, border: border.brutal,
                whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto',
              }}>{board.lastDiagnostic}</pre>
            )}
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>모터 캘리브레이션</h2>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 8 }}>
              방향이 거꾸로 돌면 누르세요. 펌웨어 F{`{n}`} 토글 + 로컬 저장.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {MOTOR_IDS.map((id) => {
                const dir = cal.current.dirOverride[id];
                return (
                  <button
                    key={id}
                    onClick={() => onToggleDir(id)}
                    style={{
                      ...buttonBase,
                      background: dir === 1 ? palette.accent : palette.tilePink,
                      flexDirection: 'column',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{id}</div>
                    <div style={{ fontSize: 12 }}>{dir === 1 ? '정방향' : '역방향'}</div>
                    <div style={{ fontSize: 11, color: palette.textMuted }}>
                      시동 V{cal.current.startThreshold[id]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ marginTop: 0 }}>시연용 Program</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {PROGRAMS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onRun(p.id, p.program)}
                disabled={!isConnected || running !== null}
                style={{
                  ...buttonBase,
                  background:
                    i % 3 === 0 ? palette.tileBlue :
                    i % 3 === 1 ? palette.tilePink : palette.tileMint,
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  opacity: (!isConnected || running !== null) ? 0.5 : 1,
                }}
              >
                <div style={{ fontSize: 24 }}>{p.emoji}</div>
                <div style={{ fontWeight: 800 }}>{p.label}</div>
                <div style={{ fontSize: 11, color: palette.textMuted }}>{p.program.steps.length} step</div>
              </button>
            ))}
          </div>
          {running && (
            <button
              onClick={onStop}
              style={{ ...buttonBase, marginTop: 12, background: palette.primary, color: '#fff' }}
            >
              ⏹ 정지
            </button>
          )}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={card}>
            <h2 style={{ marginTop: 0 }}>인터프리터 이벤트</h2>
            <div style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 12,
              background: '#F7F4EA', borderRadius: radius.sm, border: border.brutal,
              padding: 8, height: 220, overflow: 'auto',
            }}>
              {events.length === 0 ? <div style={{ color: palette.textMuted }}>아직 실행 안 함</div> :
                events.map((e, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    {e.type === 'say' && <span>💬 <em>{e.text}</em></span>}
                    {e.type === 'calibrate' && <span style={{ color: palette.primary }}>🔧 calibrate: {e.reason}</span>}
                    {e.type === 'step_start' && <span style={{ color: palette.textMuted }}>▶ #{e.index} {e.step.do}</span>}
                    {e.type === 'step_end' && <span style={{ color: palette.textMuted }}>✓ #{e.index} {e.step.do}</span>}
                    {e.type === 'aborted' && <span style={{ color: palette.primary }}>⏹ 중단됨</span>}
                    {e.type === 'done' && <span style={{ color: '#1F8A2C' }}>✅ 완료</span>}
                    {e.type === 'error' && <span style={{ color: palette.primary }}>❌ {e.message}</span>}
                  </div>
                ))
              }
              <div ref={eventsEndRef} />
            </div>
          </div>

          <div style={card}>
            <h2 style={{ marginTop: 0 }}>시리얼 수신 라인</h2>
            <div style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 12,
              background: palette.textMain, color: palette.bg,
              borderRadius: radius.sm, padding: 8, height: 220, overflow: 'auto',
            }}>
              {board.lines.length === 0 ? <div style={{ opacity: 0.6 }}>(no data)</div> :
                board.lines.map((line, i) => <div key={i}>{line}</div>)}
              <div ref={linesEndRef} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
