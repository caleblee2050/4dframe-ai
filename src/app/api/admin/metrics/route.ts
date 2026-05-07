// /api/admin/metrics — 관리자용 사용량 스냅샷.
// ADMIN_PASSWORD 환경변수의 비밀번호로 보호.
//
// in-memory 카운터만 반환 (Vercel Function 인스턴스 단위).
// 영속/사용자별 분리는 v1.1 Turso 도입 후.

import { getMetricsSnapshot, estimateCost } from '@/lib/admin/metrics';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const password = req.headers.get('x-admin-password') ?? url.searchParams.get('p');

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: 'ADMIN_PASSWORD 미설정. vercel env add 로 등록 필요.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (password !== expected) {
    return new Response(
      JSON.stringify({ error: '비밀번호 불일치' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const m = getMetricsSnapshot();
  const cost = estimateCost(m);
  const uptimeSec = Math.round((Date.now() - m.startedAt) / 1000);

  return new Response(
    JSON.stringify({
      uptime_sec: uptimeSec,
      started_at: new Date(m.startedAt).toISOString(),
      chat: m.chat,
      tts: m.tts,
      cost_estimate_usd: cost,
      // 외부 대시보드 링크 — Vercel + Google Cloud Console 직링크
      external_dashboards: {
        vercel_ai_gateway: 'https://vercel.com/calebs-projects-308edac8/4dframe-ai/ai-gateway',
        vercel_logs: 'https://vercel.com/calebs-projects-308edac8/4dframe-ai/logs',
        google_ai_quota: 'https://aistudio.google.com/app/apikey',
        google_cloud_billing: 'https://console.cloud.google.com/billing',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
