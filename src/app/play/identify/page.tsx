'use client';

// 작품 인식 별도 페이지 — 직접 카메라로 여러 각도 찍어 짝코더와 어떤 작품인지 함께 파악.
// 하나 찍을 때마다 AI 가 분석 → 누적된 사진들을 종합해 자신감 가장 높은 artwork 으로 /play 시작.

import { useState } from 'react';
import Link from 'next/link';
import { CameraCapture } from '@/components/play/CameraCapture';
import { palette, radius, shadow, border } from '@/lib/design/tokens';

interface Identified {
  artwork: 'viking' | 'car_4wd' | 'swing' | 'crocodile' | 'ballerina' | 'free';
  confidence: number;
  greeting: string;
  reasoning: string;
  ideas: string[];
}

interface Photo {
  dataURL: string;
  result?: Identified;
  loading?: boolean;
  error?: string;
}

const ARTWORK_LABEL: Record<Identified['artwork'], string> = {
  viking: '바이킹', car_4wd: '자동차', swing: '회전그네',
  crocodile: '악어', ballerina: '발레리나', free: '자유',
};

const ARTWORK_EMOJI: Record<Identified['artwork'], string> = {
  viking: '🚣', car_4wd: '🚗', swing: '🎠',
  crocodile: '🐊', ballerina: '🩰', free: '🛠️',
};

export default function IdentifyPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [showCamera, setShowCamera] = useState(true);

  const onCapture = async (dataURL: string) => {
    const idx = photos.length;
    setPhotos((p) => [...p, { dataURL, loading: true }]);
    setShowCamera(false);

    try {
      const res = await fetch('/api/identify-artwork', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataURL }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setPhotos((p) => p.map((ph, i) => i === idx ? { ...ph, loading: false, error: errBody.error ?? '인식 실패' } : ph));
        return;
      }
      const result: Identified = await res.json();
      setPhotos((p) => p.map((ph, i) => i === idx ? { ...ph, loading: false, result } : ph));
    } catch {
      setPhotos((p) => p.map((ph, i) => i === idx ? { ...ph, loading: false, error: '네트워크 오류' } : ph));
    }
  };

  // 종합 — 사진별 result 의 confidence 합산. artwork 별 sum 가장 큰 것.
  const consensus = (() => {
    const ok = photos.filter((p) => p.result);
    if (ok.length === 0) return null;
    const scores: Record<string, number> = {};
    for (const p of ok) {
      const r = p.result!;
      scores[r.artwork] = (scores[r.artwork] ?? 0) + r.confidence;
    }
    let best: Identified['artwork'] = 'free';
    let bestScore = -1;
    for (const [k, v] of Object.entries(scores)) {
      if (v > bestScore) { bestScore = v; best = k as Identified['artwork']; }
    }
    const avgConfidence = bestScore / ok.length;
    return { artwork: best, avgConfidence, sampleCount: ok.length };
  })();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: palette.bg,
        backgroundImage: 'radial-gradient(#E8E0CE 2px, transparent 2px)',
        backgroundSize: '30px 30px',
        color: palette.textMain,
        padding: 24,
        fontFamily: "'Nunito', system-ui, sans-serif",
        fontWeight: 600,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 헤더 */}
        <header style={{
          background: palette.panel, border: border.brutal, borderRadius: radius.md,
          boxShadow: shadow.brutal, padding: 16,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: radius.sm,
            background: palette.secondary, border: border.brutal,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>📷</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>내 작품 알려줘!</h1>
            <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
              여러 각도로 찍어볼래? 짝코더가 알아맞힐게.
            </div>
          </div>
          <Link href="/play" style={{
            fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
            background: palette.panel, color: palette.textMain,
            border: border.brutal, borderRadius: radius.sm,
            padding: '8px 14px', cursor: 'pointer', textDecoration: 'none',
            boxShadow: shadow.brutalSm,
          }}>
            ← 놀러가기
          </Link>
        </header>

        {/* 카메라 / 다시 찍기 */}
        {showCamera ? (
          <CameraCapture
            onCapture={onCapture}
            onClose={photos.length > 0 ? () => setShowCamera(false) : undefined}
            colors={{
              primary: palette.primary,
              primaryLight: palette.tilePink,
              border: palette.textMain,
              textMuted: palette.textMuted,
              panel: palette.panel,
            }}
          />
        ) : (
          <button
            onClick={() => setShowCamera(true)}
            style={{
              fontFamily: 'inherit', fontWeight: 900, fontSize: 16,
              background: palette.tertiary, color: '#fff',
              border: border.brutal, borderRadius: radius.md,
              padding: '14px 20px', cursor: 'pointer',
              boxShadow: shadow.brutal,
            }}
          >
            📷 다른 각도로 한 장 더 찍기
          </button>
        )}

        {/* 찍은 사진 + 분석 결과 chat 형태 */}
        {photos.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {photos.map((ph, i) => (
              <div key={i} style={{
                background: palette.panel, border: border.brutal, borderRadius: radius.md,
                boxShadow: shadow.brutal, padding: 12,
                display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12,
              }}>
                <img
                  src={ph.dataURL}
                  alt={`사진 ${i + 1}`}
                  style={{
                    width: 120, height: 120, objectFit: 'cover',
                    borderRadius: radius.sm, border: `2px solid ${palette.textMain}`,
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ph.loading ? (
                    <div style={{ fontSize: 13, color: palette.textMuted, fontStyle: 'italic' }}>
                      🔍 짝코더가 보는 중…
                    </div>
                  ) : ph.error ? (
                    <div style={{ fontSize: 13, color: palette.primary }}>{ph.error}</div>
                  ) : ph.result ? (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 900 }}>
                        {ARTWORK_EMOJI[ph.result.artwork]} {ph.result.greeting}
                      </div>
                      <div style={{ fontSize: 12, color: palette.textMuted }}>
                        자신감 {Math.round(ph.result.confidence * 100)}% · {ARTWORK_LABEL[ph.result.artwork]}
                      </div>
                      <div style={{ fontSize: 13 }}>{ph.result.reasoning}</div>
                      {ph.result.ideas.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {ph.result.ideas.map((idea, k) => (
                            <span key={k} style={{
                              background: palette.tilePink,
                              border: border.brutal, borderRadius: 999,
                              padding: '3px 10px', fontSize: 11, fontWeight: 700,
                            }}>{idea}</span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* 종합 결과 + 놀러가기 */}
        {consensus && (
          <section style={{
            background: palette.accent, border: border.brutal, borderRadius: radius.md,
            boxShadow: shadow.brutal, padding: 16,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: 32 }}>{ARTWORK_EMOJI[consensus.artwork]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                {consensus.artwork === 'free'
                  ? '음… 자유 작품인 것 같아!'
                  : `이거 ${ARTWORK_LABEL[consensus.artwork]}이지?`}
              </div>
              <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
                사진 {consensus.sampleCount}장 보고 종합한 결과 · 자신감 {Math.round(consensus.avgConfidence * 100)}%
              </div>
            </div>
            <Link
              href={`/play?artwork=${consensus.artwork}`}
              style={{
                fontFamily: 'inherit', fontWeight: 900, fontSize: 16,
                background: palette.primary, color: '#fff',
                border: border.brutal, borderRadius: radius.sm,
                padding: '12px 20px', cursor: 'pointer', textDecoration: 'none',
                boxShadow: shadow.brutalSm,
              }}
            >
              이걸로 놀러갈래 →
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
