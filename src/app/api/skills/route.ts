// /api/skills — customSkill 영구 저장 (Turso libsql).
// GET ?artwork=xxx 또는 GET (전체) — 스킬 list
// POST { artwork, label, emoji, program, description? } — 새 스킬 추가
//
// 단일 테넌트 (로그인 X). 모든 PC/브라우저가 같은 스킬 공유.
// v2 에서 user_id 추가 + 로그인 시 분리.

import { getDb, type SkillRow, type Artwork } from '@/lib/db/turso';
import type { Program, Step } from '@/lib/dsl/schema';
import { validateProgram } from '@/lib/dsl/schema';

export const runtime = 'nodejs';

const VALID_ARTWORKS = new Set<Artwork>(['viking', 'car_4wd', 'swing', 'crocodile', 'ballerina', 'free']);

// save_skill 은 "저장 명령" step 이라 customSkill program 안에 들어가면 무한 저장 루프가 발생.
// 서버 측 방어 — 클라이언트가 깜빡해도 영구 데이터에 save_skill 이 새지 않게.
function stripSaveSkill(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (const s of steps) {
    if (s.do === 'save_skill') continue;
    if (s.do === 'repeat') {
      out.push({ ...s, steps: stripSaveSkill(s.steps) });
    } else {
      out.push(s);
    }
  }
  return out;
}

function rowToSkill(r: SkillRow): {
  id: string; artwork: Artwork; label: string; emoji: string;
  description: string | null; program: Program; createdAt: number; simpleHidden: boolean;
} {
  return {
    id: r.id,
    artwork: r.artwork as Artwork,
    label: r.label,
    emoji: r.emoji,
    description: r.description,
    program: JSON.parse(r.program_json) as Program,
    createdAt: r.created_at,
    simpleHidden: r.simple_hidden === 1,
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const artwork = url.searchParams.get('artwork');

    const db = getDb();
    const [skillsRs, hiddenRs] = await Promise.all([
      artwork
        ? db.execute({
            sql: 'SELECT id, artwork, label, emoji, description, program_json, created_at, simple_hidden FROM skills WHERE artwork = ? ORDER BY created_at DESC',
            args: [artwork],
          })
        : db.execute('SELECT id, artwork, label, emoji, description, program_json, created_at, simple_hidden FROM skills ORDER BY created_at DESC'),
      db.execute('SELECT builtin_id FROM hidden_builtin'),
    ]);

    const skills = skillsRs.rows.map((r) => rowToSkill(r as unknown as SkillRow));
    const hiddenBuiltinIds = hiddenRs.rows.map((r) => r.builtin_id as string);
    return Response.json({ skills, hiddenBuiltinIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[skills GET]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      artwork?: string;
      label?: string;
      emoji?: string;
      description?: string;
      program?: unknown;
    };

    if (!body.artwork || !VALID_ARTWORKS.has(body.artwork as Artwork)) {
      return Response.json({ error: '잘못된 artwork' }, { status: 400 });
    }
    if (!body.label || typeof body.label !== 'string' || body.label.length === 0 || body.label.length > 16) {
      return Response.json({ error: 'label 1~16자' }, { status: 400 });
    }
    if (!body.emoji || typeof body.emoji !== 'string' || body.emoji.length === 0 || body.emoji.length > 4) {
      return Response.json({ error: 'emoji 1~4자' }, { status: 400 });
    }
    // program 검증
    let validProgram: Program;
    try {
      validProgram = validateProgram(body.program);
    } catch (e) {
      return Response.json({ error: 'program 검증 실패: ' + (e instanceof Error ? e.message : String(e)) }, { status: 400 });
    }
    // save_skill step 제거 — 저장 program 안에 들어가면 무한 루프 버그.
    validProgram = { ...validProgram, steps: stripSaveSkill(validProgram.steps) };
    if (validProgram.steps.length === 0) {
      return Response.json({ error: '저장할 동작 step 이 없어요 (save_skill 만 들어있던 program).' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const db = getDb();
    await db.execute({
      sql: 'INSERT INTO skills (id, artwork, label, emoji, description, program_json, created_at, simple_hidden) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      args: [id, body.artwork, body.label, body.emoji, body.description ?? null, JSON.stringify(validProgram), createdAt],
    });
    return Response.json({
      skill: {
        id, artwork: body.artwork, label: body.label, emoji: body.emoji,
        description: body.description ?? null, program: validProgram,
        createdAt, simpleHidden: false,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[skills POST]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

