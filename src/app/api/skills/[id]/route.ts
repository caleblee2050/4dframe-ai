// /api/skills/[id] — 개별 스킬 작업
// DELETE — 삭제
// PATCH { simpleHidden?: boolean, label?: string } — 쉬운 모드 노출/숨김 토글 또는 이름 변경

import { getDb } from '@/lib/db/turso';

export const runtime = 'nodejs';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return Response.json({ error: 'id 누락' }, { status: 400 });
    const db = getDb();
    await db.execute({ sql: 'DELETE FROM skills WHERE id = ?', args: [id] });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[skills DELETE]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id) return Response.json({ error: 'id 누락' }, { status: 400 });
    const body = await req.json() as { simpleHidden?: boolean; label?: string };
    const db = getDb();

    // label 우선 처리
    if (typeof body.label === 'string') {
      const label = body.label.trim();
      if (label.length === 0 || label.length > 16) {
        return Response.json({ error: 'label 1~16자' }, { status: 400 });
      }
      await db.execute({
        sql: 'UPDATE skills SET label = ? WHERE id = ?',
        args: [label, id],
      });
      return Response.json({ ok: true, label });
    }

    if (typeof body.simpleHidden !== 'boolean') {
      return Response.json({ error: 'simpleHidden boolean 또는 label string 필요' }, { status: 400 });
    }
    await db.execute({
      sql: 'UPDATE skills SET simple_hidden = ? WHERE id = ?',
      args: [body.simpleHidden ? 1 : 0, id],
    });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[skills PATCH]', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
