// /api/tts — say step 의 텍스트를 Gemini 3.1 Flash TTS Preview 로 음성 변환.
//
// 1차 경로: Vercel AI Gateway 프록시 (OIDC 인증, 별도 키 0개).
// 2차 fallback: Gemini API 직접 호출 (GOOGLE_GENERATIVE_AI_API_KEY 필요).
//
// 카탈로그에 명시되지 않아도 Gateway 가 자동 라우팅 가능한지 시도하는 방식.

import { experimental_generateSpeech as generateSpeech } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TTS_MODEL_ID = 'google/gemini-3.1-flash-tts-preview';
const DEFAULT_VOICE = 'Kore';

interface TtsRequestBody {
  text: string;
  voice?: string;
}

export async function POST(req: Request) {
  let body: TtsRequestBody;
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  if (typeof body.text !== 'string' || body.text.length === 0) {
    return new Response('text 가 비어 있습니다', { status: 400 });
  }
  if (body.text.length > 140) {
    return new Response('text 는 140자 이하', { status: 400 });
  }

  const voice = body.voice ?? DEFAULT_VOICE;

  // ─── 경로 A: AI Gateway 프록시 시도 ─────────────────────────
  try {
    const result = await generateSpeech({
      model: TTS_MODEL_ID,
      text: body.text,
      voice,
    });
    return new Response(result.audio.uint8Array as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': result.audio.mediaType ?? 'audio/wav',
        'Cache-Control': 'no-store',
        'X-TTS-Path': 'gateway',
      },
    });
  } catch (gatewayErr) {
    console.warn('[TTS] AI Gateway 경로 실패, Gemini API 직접 호출로 fallback:', gatewayErr instanceof Error ? gatewayErr.message : gatewayErr);
  }

  // ─── 경로 B: Gemini API 직접 호출 fallback ──────────────────
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'AI Gateway 가 Gemini TTS 를 라우팅하지 못했고, fallback 용 GOOGLE_GENERATIVE_AI_API_KEY 도 미설정. https://aistudio.google.com/apikey 에서 키 발급 후 .env.local 또는 vercel env add 로 설정 필요.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
  const reqBody = {
    contents: [{ parts: [{ text: body.text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  };

  const upstream = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });

  if (!upstream.ok) {
    return new Response(
      JSON.stringify({ error: `Gemini direct ${upstream.status}: ${await upstream.text()}` }),
      { status: upstream.status, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const data = await upstream.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  };

  const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!part?.data) {
    return new Response(
      JSON.stringify({ error: 'Gemini 응답에 audio 데이터 없음', raw: data }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const audioBytes = Buffer.from(part.data, 'base64');
  const upstreamMime = part.mimeType ?? '';

  // Gemini 가 raw PCM L16 (audio/l16; rate=24000; channels=1) 으로 응답하면
  // 브라우저 <audio> 가 재생 못 하므로 WAV 컨테이너로 감싼다.
  if (upstreamMime.startsWith('audio/l16') || upstreamMime.startsWith('audio/L16')) {
    const params = parseMediaTypeParams(upstreamMime);
    const sampleRate = parseInt(params.rate ?? '24000', 10);
    const channels = parseInt(params.channels ?? '1', 10);
    const wav = wrapPcmAsWav(audioBytes, sampleRate, channels, 16);
    return new Response(wav as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
        'X-TTS-Path': 'direct',
      },
    });
  }

  return new Response(audioBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': upstreamMime || 'audio/wav',
      'Cache-Control': 'no-store',
      'X-TTS-Path': 'direct',
    },
  });
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
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);                // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}
