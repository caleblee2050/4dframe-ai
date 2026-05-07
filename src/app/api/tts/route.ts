// /api/tts — say step 의 텍스트를 Gemini 3.1 Flash TTS Preview 로 음성 변환.
//
// 입력: { text: string }   (1~140자, 인라인 오디오 태그 포함 가능)
// 출력: audio/wav (또는 mp3) 바이너리 — 브라우저가 <audio> 또는 AudioContext 로 재생.
//
// AI Gateway 가 아직 Gemini TTS 미지원이라 Gemini API 직접 호출.
// 환경변수: GOOGLE_GENERATIVE_AI_API_KEY (Google AI Studio 에서 발급).
//
// Gemini 3.1 Flash TTS Preview 는 여러 voice prebuilt 제공.
// 한국어용으로는 Kore / Puck / Charon 등 — 학생 기본은 따뜻한 톤.

export const runtime = 'nodejs';
export const maxDuration = 30;

const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
// Google AI Studio 에서 한국어에 자연스러운 voice. 추후 학생이 고를 수도.
const DEFAULT_VOICE = 'Kore';

interface TtsRequestBody {
  text: string;
  voice?: string;   // optional override
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'GOOGLE_GENERATIVE_AI_API_KEY 가 설정되지 않았습니다. Google AI Studio (https://aistudio.google.com/apikey) 에서 키를 발급받아 .env.local 에 추가해주세요.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

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

  // Gemini API generateContent 엔드포인트로 audio output 요청.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${apiKey}`;
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
    const errText = await upstream.text();
    return new Response(
      JSON.stringify({ error: `Gemini TTS upstream ${upstream.status}: ${errText}` }),
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
      JSON.stringify({ error: 'Gemini 응답에 audio 데이터가 없습니다', raw: data }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // base64 → bytes
  const audioBytes = Buffer.from(part.data, 'base64');
  const mimeType = part.mimeType ?? 'audio/wav';

  return new Response(audioBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    },
  });
}
