'use client';

// 카메라 직접 촬영 컴포넌트 — getUserMedia 로 후면 카메라 우선, 캡쳐 시 dataURL 반환.
// PC: 웹캠 / 모바일: 후면 카메라.

import { useEffect, useRef, useState } from 'react';

interface Props {
  onCapture: (dataURL: string) => void;
  onClose?: () => void;
  colors: { primary: string; primaryLight: string; border: string; textMuted: string; panel: string };
}

export function CameraCapture({ onCapture, onClose, colors }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '카메라 접근 실패';
        setError(`카메라를 못 켰어요: ${msg}`);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const onCaptureClick = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    // 1024px 이내로 리사이즈
    const maxSide = 1024;
    const ratio = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * ratio);
    const h = Math.round(v.videoHeight * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const dataURL = canvas.toDataURL('image/jpeg', 0.85);
    onCapture(dataURL);
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      background: colors.panel,
      border: `2px solid ${colors.border}`,
      borderRadius: 12, padding: 12,
    }}>
      <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', aspectRatio: '4 / 3' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', color: '#fff', padding: 16, fontSize: 13, textAlign: 'center',
          }}>
            {error}
          </div>
        )}
        {!ready && !error && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 13,
          }}>
            카메라 준비 중…
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={onCaptureClick}
          disabled={!ready}
          style={{
            fontFamily: 'inherit', fontWeight: 900, fontSize: 16,
            background: colors.primary, color: '#fff',
            border: `2px solid ${colors.border}`, borderRadius: 8,
            padding: '12px 20px', cursor: ready ? 'pointer' : 'not-allowed',
            opacity: ready ? 1 : 0.5, flex: 1,
          }}
        >
          📸 찰칵!
        </button>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              fontFamily: 'inherit', fontWeight: 700, fontSize: 14,
              background: colors.panel, color: colors.textMuted,
              border: `2px solid ${colors.border}`, borderRadius: 8,
              padding: '12px 16px', cursor: 'pointer',
            }}
          >
            닫기
          </button>
        )}
      </div>
    </div>
  );
}
