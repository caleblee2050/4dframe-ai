// in-memory 사용량 카운터 — Vercel Function 인스턴스가 살아 있는 동안만 누적.
// 인스턴스 재기동 시 초기화됨 (영속 저장은 v1.1 에서 Turso/Postgres 도입).
//
// 단기 (5/10 전) 운영 가시성 확보용 — 외부 대시보드(Vercel/Google Cloud)와
// 함께 보면 충분.

export interface CallSnapshot {
  endpoint: 'chat' | 'tts';
  status: number;          // HTTP status
  latency_ms: number;
  // Gemini API 응답에 포함된 토큰 수 (선택). chat 의 경우 ai SDK 가 제공.
  input_tokens?: number;
  output_tokens?: number;
  // TTS audio bytes 길이 (대략의 출력량 가늠)
  audio_bytes?: number;
  // 학생 보드 ID (있으면) — v2 사용자 분리 전까지는 보드 단위 추적
  board_id?: string;
  ts: number;              // Date.now()
}

export interface EndpointStats {
  total: number;
  ok: number;
  errors: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_audio_bytes: number;
  avg_latency_ms: number;
  // 최근 100건 슬라이딩
  recent: CallSnapshot[];
  // 최근 24h 내 시간별 분포 (24 슬롯, 0=현재 시간)
  hourly_24h: number[];
}

interface MetricsState {
  startedAt: number;
  chat: EndpointStats;
  tts: EndpointStats;
}

const MAX_RECENT = 100;
const HOUR_MS = 60 * 60 * 1000;

function freshStats(): EndpointStats {
  return {
    total: 0,
    ok: 0,
    errors: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_audio_bytes: 0,
    avg_latency_ms: 0,
    recent: [],
    hourly_24h: new Array(24).fill(0),
  };
}

// globalThis 에 붙여서 Next.js HMR 시 카운터 보존
const G = globalThis as unknown as { __4dframe_metrics?: MetricsState };

if (!G.__4dframe_metrics) {
  G.__4dframe_metrics = {
    startedAt: Date.now(),
    chat: freshStats(),
    tts: freshStats(),
  };
}

export function recordCall(call: CallSnapshot): void {
  const m = G.__4dframe_metrics!;
  const s = call.endpoint === 'chat' ? m.chat : m.tts;

  s.total++;
  if (call.status >= 200 && call.status < 300) s.ok++;
  else s.errors++;

  if (call.input_tokens) s.total_input_tokens += call.input_tokens;
  if (call.output_tokens) s.total_output_tokens += call.output_tokens;
  if (call.audio_bytes) s.total_audio_bytes += call.audio_bytes;

  // 누적 평균 latency
  s.avg_latency_ms = Math.round(
    (s.avg_latency_ms * (s.total - 1) + call.latency_ms) / s.total
  );

  // 최근 100건 슬라이딩
  s.recent.push(call);
  if (s.recent.length > MAX_RECENT) s.recent.shift();

  // hourly 24h — call 시각의 시간 슬롯 (0=현재 시간)
  const slotsAgo = Math.floor((Date.now() - call.ts) / HOUR_MS);
  if (slotsAgo >= 0 && slotsAgo < 24) {
    s.hourly_24h[slotsAgo]++;
  }
}

export function getMetricsSnapshot(): MetricsState {
  // 깊은 복사 — 외부에서 수정 못 하게
  const m = G.__4dframe_metrics!;
  return JSON.parse(JSON.stringify(m)) as MetricsState;
}

// 비용 추정 (대략) — Sonnet 4.6 + Gemini 3.1 Flash TTS 가격 기준
export function estimateCost(m: MetricsState): {
  chat_usd: number;
  tts_usd: number;
  total_usd: number;
} {
  // claude-sonnet-4-6: $3/MTok input, $15/MTok output
  const chatIn = (m.chat.total_input_tokens / 1_000_000) * 3;
  const chatOut = (m.chat.total_output_tokens / 1_000_000) * 15;
  // gemini-3.1-flash-tts: $1/MTok input, $20/MTok output
  // audio_bytes → token 추정 (대략 audio_bytes / 200, 24kHz 16bit = ~125 tok/s)
  const ttsIn = (m.tts.total_input_tokens / 1_000_000) * 1;
  const ttsOut = (m.tts.total_output_tokens / 1_000_000) * 20;

  return {
    chat_usd: chatIn + chatOut,
    tts_usd: ttsIn + ttsOut,
    total_usd: chatIn + chatOut + ttsIn + ttsOut,
  };
}
