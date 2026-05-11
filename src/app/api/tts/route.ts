// /api/tts — say step 의 텍스트를 음성 변환.
//
// 직접 provider 호출 (Vercel AI Gateway 는 TTS 미지원 — 2026-05 검색 결과):
//   1차: Gemini 3.1 Flash TTS Preview (GOOGLE_GENERATIVE_AI_API_KEY)
//        — 최선 품질. preview 모델 일일 한도 100 (Tier 1 유료여도).
//   2차: OpenAI tts-1 (OPENAI_API_KEY) — 선택 환경변수. 한도 훨씬 큼.
//   ─ 둘 다 실패 시 503 → 클라이언트가 브라우저 SpeechSynthesisUtterance 로 fallback.

import { recordCall } from '@/lib/admin/metrics';

export const runtime = 'nodejs';
export const maxDuration = 30;

const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_VOICE = 'Kore';

// Gemini voice 이름 → OpenAI voice (백업 경로용 매핑)
const OPENAI_VOICE_MAP: Record<string, string> = {
  Kore: 'nova',      // 한국어 자연
  Puck: 'alloy',     // 영어 활달
  Aoede: 'shimmer',
  Charon: 'onyx',
  Fenrir: 'echo',
};
function toOpenAiVoice(v: string): string {
  return OPENAI_VOICE_MAP[v] ?? 'nova';
}

interface TtsRequestBody {
  text: string;
  voice?: string;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const recordTts = (status: number, audio_bytes?: number, input_tokens?: number, output_tokens?: number) =>
    recordCall({
      endpoint: 'tts', status, audio_bytes, input_tokens, output_tokens,
      latency_ms: Date.now() - startedAt, ts: startedAt,
    });

  let body: TtsRequestBody;
  try { body = await req.json(); }
  catch { recordTts(400); return new Response('Invalid JSON', { status: 400 }); }

  if (typeof body.text !== 'string' || body.text.length === 0) {
    recordTts(400);
    return new Response('text 가 비어 있습니다', { status: 400 });
  }
  if (body.text.length > 140) {
    recordTts(400);
    return new Response('text 는 140자 이하', { status: 400 });
  }

  const inputTokensEstimate = Math.ceil(body.text.length * 1.5);
  const voice = body.voice ?? DEFAULT_VOICE;

  const geminiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    recordTts(500);
    return new Response(
      JSON.stringify({ error: 'TTS 키 미설정 — GOOGLE_GENERATIVE_AI_API_KEY 또는 OPENAI_API_KEY 필요.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ─── 경로 A: Gemini 3.1 Flash TTS ──────────────────────────
  let lastError = '';
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${geminiKey}`;
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: body.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
            },
          },
        }),
      });

      if (upstream.ok) {
        const data = await upstream.json() as {
          candidates?: Array<{
            content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
          }>;
        };
        const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (part?.data) {
          const audioBytes = Buffer.from(part.data, 'base64');
          const upstreamMime = part.mimeType ?? '';
          // Gemini raw PCM L16 → WAV 컨테이너
          if (upstreamMime.startsWith('audio/l16') || upstreamMime.startsWith('audio/L16')) {
            const params = parseMediaTypeParams(upstreamMime);
            const sampleRate = parseInt(params.rate ?? '24000', 10);
            const channels = parseInt(params.channels ?? '1', 10);
            const wav = wrapPcmAsWav(audioBytes, sampleRate, channels, 16);
            recordTts(200, wav.byteLength, inputTokensEstimate, Math.ceil(audioBytes.byteLength / 192));
            return new Response(wav as unknown as BodyInit, {
              status: 200,
              headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-TTS-Path': 'gemini-direct' },
            });
          }
          recordTts(200, audioBytes.byteLength, inputTokensEstimate, Math.ceil(audioBytes.byteLength / 192));
          return new Response(audioBytes as unknown as BodyInit, {
            status: 200,
            headers: { 'Content-Type': upstreamMime || 'audio/wav', 'Cache-Control': 'no-store', 'X-TTS-Path': 'gemini-direct' },
          });
        }
        lastError = 'Gemini 응답에 audio 데이터 없음';
      } else {
        const errText = await upstream.text();
        lastError = `Gemini ${upstream.status}: ${errText.slice(0, 200)}`;
        console.warn('[TTS]', lastError);
      }
    } catch (e) {
      lastError = `Gemini exception: ${e instanceof Error ? e.message : String(e)}`;
      console.warn('[TTS]', lastError);
    }
  }

  // ─── 경로 B: OpenAI tts-1 (Gemini 실패 시) ──────────────────
  if (openaiKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: body.text,
          voice: toOpenAiVoice(voice),
          response_format: 'mp3',
        }),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        recordTts(200, buf.byteLength, inputTokensEstimate, Math.ceil(buf.byteLength / 192));
        return new Response(buf as unknown as BodyInit, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-TTS-Path': 'openai-direct' },
        });
      }
      lastError = `OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`;
      console.warn('[TTS]', lastError);
    } catch (e) {
      lastError = `OpenAI exception: ${e instanceof Error ? e.message : String(e)}`;
      console.warn('[TTS]', lastError);
    }
  }

  // 모든 경로 실패 — 클라이언트가 브라우저 TTS 로 fallback
  recordTts(503);
  return new Response(
    JSON.stringify({ error: lastError || 'TTS 모든 경로 실패' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// "audio/l16; rate=24000; channels=1" → { rate: "24000", channels: "1" }
function parseMediaTypeParams(mt: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = mt.split(';').slice(1);
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) out[k.trim().toLowerCase()] = v.trim();
  }
  return out;
}

// PCM bytes 앞에 RIFF/WAVE 헤더 44바이트 추가
function wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
