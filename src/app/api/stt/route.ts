// /api/stt — MediaRecorder 가 보낸 오디오 blob → 한국어 텍스트.
//
// Vercel AI Gateway 사용. 별도 키 0개 — VERCEL_OIDC_TOKEN 으로 자동 인증.
// 모델: google/gemini-2.5-flash (multimodal audio input).
//
// Web Speech API 가 일부 환경(특정 윈도우 PC, 회사망)에서 onspeechstart 안 호출
// 되던 환경 의존 문제를 우회. MediaRecorder → 직접 오디오 캡처 → 검증된 모델.

import { generateText } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

const STT_MODEL = 'google/gemini-2.5-flash';

export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const audio = fd.get('audio');
    if (!(audio instanceof Blob)) {
      return Response.json({ error: '오디오 파일이 없어요.' }, { status: 400 });
    }
    if (audio.size < 1000) {
      return Response.json({ error: '녹음이 너무 짧아요. 다시 시도해 주세요.' }, { status: 400 });
    }

    const buf = Buffer.from(await audio.arrayBuffer());
    const mediaType = audio.type || 'audio/webm';

    const result = await generateText({
      model: STT_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'file', data: buf, mediaType },
          {
            type: 'text',
            text: '이 오디오를 한국어로 받아써 주세요. 받아쓴 텍스트만 출력하고 따옴표·마크다운·설명·prefix 없이 깔끔하게. 발화가 없으면 빈 문자열을 반환.',
          },
        ],
      }],
    });

    const text = result.text.trim();
    return Response.json({ text });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[stt]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
