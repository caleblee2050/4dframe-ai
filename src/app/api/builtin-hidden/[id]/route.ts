// /api/builtin-hidden/[id] — built-in 스킬 hidden 해제.
// DELETE — 설정 모달에서 ⭐ 눌러 다시 노출시키는 흐름.

import { getDb } from '@/lib/db/turso';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return Response.json({ error: 'id 누락' }, { status: 400 });
    const db = getDb();
    await db.execute({
      sql: 'DELETE FROM hidden_builtin WHERE builtin_id = ?',
      args: [id],
    });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[builtin-hidden DELETE]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
