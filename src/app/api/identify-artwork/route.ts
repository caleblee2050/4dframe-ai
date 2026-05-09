// /api/identify-artwork — 학생이 4D프레임 조립품을 사진 찍으면 AI 가 작품 추정.
//
// 요청: { image: dataURL string ("data:image/jpeg;base64,...") }
// 응답: { artwork, confidence, greeting, reasoning, ideas[] }
//
// Vercel AI Gateway + claude-sonnet-4-6 (vision). VERCEL_OIDC_TOKEN 으로 자동 인증.

import { generateText } from 'ai';
import { recordCall } from '@/lib/admin/metrics';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RequestBody {
  image: string;   // dataURL
}

const ARTWORKS = ['viking', 'car_4wd', 'swing', 'crocodile', 'ballerina', 'free'] as const;
type Artwork = typeof ARTWORKS[number];

interface IdentifyResult {
  artwork: Artwork;
  confidence: number;
  greeting: string;
  reasoning: string;
  ideas: string[];
}

const IDENTIFY_SYSTEM = `당신은 "4D프레임 친구" 입니다.
한국 유치원~초등학생이 자기 4D 프레임 조립품을 사진으로 보여줍니다.
사진을 보고 작품을 알아맞히고 학생을 신나게 합니다.

작품 후보:
- viking: 좌우로 흔들리는 진자형 — 양쪽 노/팔이 있는 흔들이 구조
- car_4wd: 4바퀴 자동차 (또는 두 바퀴 큰 바퀴) — 바닥에 닿는 바퀴
- swing: 회전판 / 회전그네 — 돌아가는 평면
- crocodile: 동물형 (악어, 공룡) — 입/꼬리 부속이 움직임
- ballerina: 모터 위에 올라가서 회전 (오르골 인형형)
- free: 위 어디에도 안 맞으면 free

응답 규칙 (반드시):
1. 오직 JSON 한 객체만. 마크다운 코드펜스(\`\`\`) 금지.
2. 어떤 텍스트도 JSON 앞뒤에 붙이지 않음.

JSON 스키마:
{
  "artwork": "viking" | "car_4wd" | "swing" | "crocodile" | "ballerina" | "free",
  "confidence": 0.0~1.0 숫자 (명확하면 0.85+, 애매하면 0.3~0.6),
  "greeting": "와! 바이킹을 만들었구나!" 같은 25자 이내 친근한 한 줄,
  "reasoning": "왜 그렇게 봤는지 — 학생용 짧은 설명 60자 이내, 어른어 금지",
  "ideas": ["이 작품으로 할 수 있는 동작 아이디어 1~3개, 각 12자 이내"]
}

페르소나:
- 한국어 반말, 짧고 신난 톤
- 어른어/한자어 금지 ("진자", "축", "관성", "토크" 등 X)
- 톤 태그([excited] 등) 사용 안 함 — 자연스럽게
- unidentifiable 이면 artwork="free", low confidence, 같이 만들자는 톤`;

function safeParse(text: string): IdentifyResult | null {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const obj = JSON.parse(cleaned);
    if (!ARTWORKS.includes(obj.artwork)) return null;
    if (typeof obj.confidence !== 'number') return null;
    if (typeof obj.greeting !== 'string') return null;
    if (typeof obj.reasoning !== 'string') return null;
    if (!Array.isArray(obj.ideas)) return null;
    return {
      artwork: obj.artwork,
      confidence: Math.max(0, Math.min(1, obj.confidence)),
      greeting: String(obj.greeting).slice(0, 80),
      reasoning: String(obj.reasoning).slice(0, 160),
      ideas: obj.ideas.slice(0, 3).map((s: unknown) => String(s).slice(0, 20)),
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) {
    return Response.json({ error: 'image must be a dataURL' }, { status: 400 });
  }

  const match = body.image.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    return Response.json({ error: 'Invalid image dataURL' }, { status: 400 });
  }
  const [, , base64] = match;
  // 4MB 제한 (base64 약 5.4MB)
  if (base64.length > 5_400_000) {
    return Response.json({ error: '이미지는 4MB 이하' }, { status: 400 });
  }

  const startedAt = Date.now();

  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: IDENTIFY_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '이 사진의 4D프레임 작품을 알아맞혀줘!' },
          { type: 'image', image: body.image },
        ],
      }],
      temperature: 0.5,
      stopSequences: ['```'],
    });

    const parsed = safeParse(result.text);
    if (!parsed) {
      console.warn('[identify-artwork] parse failed:', result.text.slice(0, 300));
      recordCall({
        endpoint: 'chat',
        status: 500,
        latency_ms: Date.now() - startedAt,
        ts: startedAt,
      });
      return Response.json({ error: 'AI 응답 파싱 실패' }, { status: 500 });
    }

    recordCall({
      endpoint: 'chat',
      status: 200,
      latency_ms: Date.now() - startedAt,
      input_tokens: result.usage?.inputTokens,
      output_tokens: result.usage?.outputTokens,
      ts: startedAt,
    });

    return Response.json(parsed);
  } catch (e) {
    recordCall({
      endpoint: 'chat',
      status: 500,
      latency_ms: Date.now() - startedAt,
      ts: startedAt,
    });
    console.warn('[identify-artwork] error', e);
    return Response.json({ error: '인식 실패. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}
