'use client';

// /admin — 관리자 대시보드 (단기, 5/10 데모 운영용)
//
// 비밀번호 게이트 + in-memory 카운터 + 외부 대시보드 링크.
// 영속/사용자 분리는 v1.1.

import { useState, useEffect, useCallback } from 'react';
import { palette, radius, shadow, border } from '@/lib/design/tokens';

interface Snapshot {
  uptime_sec: number;
  started_at: string;
  chat: EndpointStats;
  tts: EndpointStats;
  cost_estimate_usd: { chat_usd: number; tts_usd: number; total_usd: number };
  external_dashboards: Record<string, string>;
}

interface EndpointStats {
  total: number;
  ok: number;
  errors: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_audio_bytes: number;
  avg_latency_ms: number;
  recent: Array<{ endpoint: string; status: number; latency_ms: number; ts: number; input_tokens?: number; output_tokens?: number; audio_bytes?: number }>;
  hourly_24h: number[];
}

const card: React.CSSProperties = {
  background: palette.panel,
  border: border.brutal,
  borderRadius: radius.md,
  boxShadow: shadow.brutal,
  padding: 16,
};

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const fetchMetrics = useCallback(async (pw: string) => {
    setError(null);
    try {
      const res = await fetch('/api/admin/metrics', {
        headers: { 'x-admin-password': pw },
      });
      if (res.status === 401) {
        setError('비밀번호가 틀렸어요.');
        setAuthed(false);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as Snapshot;
      setSnap(data);
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 5초 폴링
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => { void fetchMetrics(password); }, 5000);
    return () => clearInterval(id);
  }, [authed, password, fetchMetrics]);

  return (
    <main style={{
      minHeight: '100vh',
      background: palette.bg,
      backgroundImage: 'radial-gradient(#E8E0CE 2px, transparent 2px)',
      backgroundSize: '30px 30px',
      color: palette.textMain,
      padding: 24,
      fontFamily: "'Nunito', system-ui, sans-serif",
      fontWeight: 600,
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <header style={{ ...card, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: radius.sm,
            background: palette.primary, color: '#fff', border: border.brutal,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>🔧</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>관리자 대시보드</h1>
            <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
              4DFrame AI — 사용량 + 외부 대시보드 (단기 운영용)
            </div>
          </div>
        </header>

        {!authed ? (
          <section style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>비밀번호 입력</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void fetchMetrics(password); }}
                placeholder="ADMIN_PASSWORD"
                style={{
                  flex: 1,
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                  padding: 10, border: border.brutal, borderRadius: radius.sm,
                  background: palette.bg, boxShadow: shadow.brutalSm,
                }}
              />
              <button
                onClick={() => void fetchMetrics(password)}
                style={{
                  fontFamily: 'inherit', fontWeight: 800,
                  background: palette.tertiary, color: '#fff',
                  border: border.brutal, borderRadius: radius.sm,
                  padding: '10px 18px', cursor: 'pointer',
                  boxShadow: shadow.brutalSm,
                }}
              >입장</button>
            </div>
            {error && (
              <div style={{ marginTop: 8, color: palette.primary, fontSize: 13 }}>{error}</div>
            )}
          </section>
        ) : snap ? (
          <>
            {/* 요약 카드 */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              <Stat label="총 호출" value={snap.chat.total + snap.tts.total} subline="chat + tts" bg={palette.tileBlue} />
              <Stat label="에러" value={snap.chat.errors + snap.tts.errors} subline={`${(((snap.chat.errors + snap.tts.errors) / Math.max(1, snap.chat.total + snap.tts.total)) * 100).toFixed(1)}%`} bg={palette.tilePink} />
              <Stat label="추정 비용" value={`$${snap.cost_estimate_usd.total_usd.toFixed(3)}`} subline={`chat $${snap.cost_estimate_usd.chat_usd.toFixed(3)} / tts $${snap.cost_estimate_usd.tts_usd.toFixed(3)}`} bg={palette.tileMint} />
              <Stat label="가동" value={`${Math.floor(snap.uptime_sec / 60)}분`} subline={new Date(snap.started_at).toLocaleString('ko-KR')} bg={palette.secondary} />
            </section>

            {/* 엔드포인트별 상세 */}
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <EndpointCard name="💬 /api/chat" stats={snap.chat} />
              <EndpointCard name="🔊 /api/tts" stats={snap.tts} />
            </section>

            {/* 외부 대시보드 링크 */}
            <section style={card}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🔗 외부 대시보드</div>
              <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 10 }}>
                정확한 사용량/비용은 아래 외부 대시보드에서 확인하세요. 위 카운터는 인스턴스 단위 임시 통계.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {Object.entries(snap.external_dashboards).map(([key, url]) => (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      textDecoration: 'none', color: palette.textMain,
                      background: palette.bg,
                      border: border.brutal, borderRadius: radius.sm,
                      padding: 10,
                      fontWeight: 700, fontSize: 13,
                      boxShadow: shadow.brutalSm,
                    }}
                  >
                    {labelFromKey(key)} ↗
                  </a>
                ))}
              </div>
            </section>

            {/* 로그아웃 */}
            <button
              onClick={() => { setAuthed(false); setPassword(''); setSnap(null); }}
              style={{
                fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
                background: palette.panel, border: border.brutal, borderRadius: radius.sm,
                padding: '6px 12px', cursor: 'pointer', alignSelf: 'flex-start',
              }}
            >🚪 로그아웃</button>
          </>
        ) : (
          <section style={card}>로딩 중...</section>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, subline, bg }: { label: string; value: React.ReactNode; subline: string; bg: string }) {
  return (
    <div style={{ ...card, background: bg, padding: 14 }}>
      <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 4, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 6 }}>{subline}</div>
    </div>
  );
}

function EndpointCard({ name, stats }: { name: string; stats: EndpointStats }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>{name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
        <span style={{ color: palette.textMuted }}>총 호출</span><span style={{ fontWeight: 800 }}>{stats.total}</span>
        <span style={{ color: palette.textMuted }}>성공</span><span>{stats.ok}</span>
        <span style={{ color: palette.textMuted }}>에러</span><span style={{ color: stats.errors ? palette.primary : undefined }}>{stats.errors}</span>
        <span style={{ color: palette.textMuted }}>입력 토큰</span><span>{stats.total_input_tokens.toLocaleString()}</span>
        <span style={{ color: palette.textMuted }}>출력 토큰</span><span>{stats.total_output_tokens.toLocaleString()}</span>
        {stats.total_audio_bytes > 0 && (
          <>
            <span style={{ color: palette.textMuted }}>오디오</span>
            <span>{(stats.total_audio_bytes / 1024 / 1024).toFixed(2)} MB</span>
          </>
        )}
        <span style={{ color: palette.textMuted }}>평균 지연</span><span>{stats.avg_latency_ms} ms</span>
      </div>

      {/* 24h 시간별 막대 */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 4 }}>최근 24h (왼쪽=현재)</div>
        <div style={{ display: 'flex', gap: 1, height: 40, alignItems: 'flex-end' }}>
          {stats.hourly_24h.map((c, i) => {
            const max = Math.max(...stats.hourly_24h, 1);
            const h = (c / max) * 40;
            return <div key={i} style={{ flex: 1, height: h, background: palette.tertiary, opacity: 0.3 + 0.7 * (1 - i / 24) }} title={`${i}h ago: ${c}`} />;
          })}
        </div>
      </div>

      {/* 최근 5건 */}
      {stats.recent.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 4 }}>최근 5건</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, background: palette.bg, border: border.brutal, borderRadius: radius.sm, padding: 6, maxHeight: 100, overflow: 'auto' }}>
            {stats.recent.slice(-5).reverse().map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <span style={{ color: c.status >= 200 && c.status < 300 ? '#1F8A2C' : palette.primary }}>{c.status}</span>
                <span>{c.latency_ms}ms</span>
                <span style={{ color: palette.textMuted, marginLeft: 'auto' }}>{new Date(c.ts).toLocaleTimeString('ko-KR')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function labelFromKey(key: string): string {
  return ({
    vercel_ai_gateway: '🤖 Vercel AI Gateway 사용량',
    vercel_logs: '📜 Vercel 함수 로그',
    google_ai_quota: '🔑 Google AI Studio 키/할당량',
    google_cloud_billing: '💳 Google Cloud 결제',
  })[key] ?? key;
}
