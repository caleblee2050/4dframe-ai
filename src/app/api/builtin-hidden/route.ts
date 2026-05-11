// /api/builtin-hidden — built-in 스킬의 hidden 플래그.
// 학생이 쉬운 모드에서 ✕ 누르면 hidden, 설정에서 ⭐ 누르면 복귀.
// 코드에 박힌 built-in 스킬은 DB 에 없으므로 별 테이블로 관리.

import { getDb } from '@/lib/db/turso';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json() as { id?: string };
    if (!body.id || typeof body.id !== 'string' || body.id.length > 64) {
      return Response.json({ error: 'id 1~64자 필요' }, { status: 400 });
    }
    const db = getDb();
    await db.execute({
      sql: 'INSERT OR IGNORE INTO hidden_builtin (builtin_id, hidden_at) VALUES (?, ?)',
      args: [body.id, Date.now()],
    });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[builtin-hidden POST]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
