// /api/chat — 학생 자연어 → AI Gateway → JSON DSL 텍스트 응답
//
// Vercel AI Gateway 사용. 별도 ANTHROPIC_API_KEY 불필요 — VERCEL_OIDC_TOKEN 으로 자동 인증.
// 모델: claude-sonnet-4-6 (페르소나 품질 우선). 추후 Haiku 4.5 라우팅 검토.
//
// 응답 흐름:
//   1. 학생 입력 + 컨텍스트 (작품, 캘리브, 거리 반응 토글) 받음
//   2. systemPrompt 동적 생성
//   3. AI Gateway 로 streamText 호출 → 토큰 스트림
//   4. 클라이언트가 토큰을 모아 JSON 으로 파싱 → validateProgram → 미리보기

import { streamText } from 'ai';
import { buildSystemPrompt, type PromptContext } from '@/lib/ai/systemPrompt';

export const runtime = 'nodejs';   // Fluid Compute 기본
export const maxDuration = 60;

interface ChatRequestBody {
  prompt: string;
  context: PromptContext;
  // 대화 이력 (선택). 현재는 단일 요청 위주.
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export async function POST(req: Request) {
  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return new Response('prompt 가 비어 있습니다', { status: 400 });
  }
  if (body.prompt.length > 1000) {
    return new Response('prompt 는 1000자 이하', { status: 400 });
  }

  const systemPrompt = buildSystemPrompt(body.context);

  const result = streamText({
    model: 'anthropic/claude-sonnet-4-6',
    system: systemPrompt,
    messages: [
      ...(body.history ?? []),
      { role: 'user', content: body.prompt },
    ],
    temperature: 0.7,
    // JSON 안에 마크다운/설명 안 섞이도록 유도
    stopSequences: ['```'],
  });

  return result.toTextStreamResponse();
}
