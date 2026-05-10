'use client';

// 카메라 인터랙티브 v0
// MediaPipe Hands (또는 단순 비디오 스트림) → 손 펼침 정도 / 머리 좌우 → 콜백.
//
// v0: 단순 화면 표시 + 모드 선택 + 처리 결과 콜백. 실제 인식은 MediaPipe Tasks Vision 사용.
// 모델 로드는 lazy (페이지 로드 시 안 받음 — 토글 켤 때만).

import { useEffect, useRef, useState } from 'react';

type Gesture =
  | { type: 'hand'; openness: number; fingerCount: number }   // openness 0~1, fingerCount 0~5
  | { type: 'head_tilt'; dx: number };                         // -1(왼) ~ +1(오른)

interface Props {
  onGesture: (g: Gesture) => void;
  colors: { primary: string; primaryDark: string; primaryLight: string; border: string; accent: string; textMuted: string };
}

type Mode = 'hand' | 'head';

export function CameraPanel({ onGesture, colors }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>('hand');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('카메라를 켜는 중…');
  const recognizerRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);

  // 카메라 스트림 시작
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setStreaming(true);
          setStatus('손 인식 모델 로드 중…');
        }
      } catch (e) {
        setError(`카메라 접근 실패: ${e instanceof Error ? e.message : String(e)}`);
        setStatus('카메라 거부됨');
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // MediaPipe 모델 lazy load
  useEffect(() => {
    if (!streaming) return;

    let cancelled = false;
    (async () => {
      try {
        const visionModule = await import('@mediapipe/tasks-vision');
        const { HandLandmarker, FilesetResolver } = visionModule;

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
        );
        const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          numHands: 1,
          runningMode: 'VIDEO',
        });
        if (cancelled) { handLandmarker.close(); return; }
        recognizerRef.current = handLandmarker;
        setStatus('손을 카메라에 비춰보세요!');
        startDetectionLoop();
      } catch (e) {
        console.warn('[Camera] MediaPipe load failed', e);
        setError(`모델 로드 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      const r = recognizerRef.current as { close: () => void } | null;
      if (r) try { r.close(); } catch {}
      recognizerRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const startDetectionLoop = () => {
    let lastSendAt = 0;
    const tick = () => {
      const recognizer = recognizerRef.current as { detectForVideo: (v: HTMLVideoElement, ts: number) => { landmarks?: Lm[][] } } | null;
      const video = videoRef.current;
      if (!recognizer || !video || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const ts = performance.now();
      try {
        const result = recognizer.detectForVideo(video, ts);
        const lm = result.landmarks?.[0];
        if (lm && lm.length >= 21 && mode === 'hand') {
          const openness = computeHandOpenness(lm);
          const mask = fingerMask(lm);
          const fingerCount = mask.filter(Boolean).length;
          drawHand(canvasRef.current, lm);
          // 200ms throttle
          if (ts - lastSendAt > 200) {
            lastSendAt = ts;
            onGesture({ type: 'hand', openness, fingerCount });
            // 디버그용 — 어느 손가락이 펴진 걸로 잡혔는지 시각적 표시
            const labels = ['👍','☝️','🖕','💍','🤙'];
            const visual = mask.map((b, i) => b ? labels[i] : '·').join(' ');
            setStatus(`손가락 ${fingerCount}개 · ${visual} · 펼침 ${(openness * 100).toFixed(0)}%`);
          }
        } else if (mode === 'head') {
          // 단순 모드 — 카메라 픽셀 색 분석으로 머리 위치 추정 (간이). MediaPipe FaceLandmarker 도입은 v0.1
          // v0 에선 hand 모드만 정상 동작. head 는 placeholder.
          if (ts - lastSendAt > 500) {
            lastSendAt = ts;
            setStatus('얼굴 인식 모드는 v0.1 에서 추가 예정');
          }
        }
      } catch {}
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  return (
    <section style={{
      background: '#fff', border: `1px solid ${colors.border}`, borderRadius: 12,
      padding: 12, display: 'flex', gap: 12, alignItems: 'center',
    }}>
      <div style={{ position: 'relative', width: 320, height: 240, background: '#000', borderRadius: 8, overflow: 'hidden' }}>
        <video ref={videoRef} muted playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        <canvas ref={canvasRef} width={320} height={240}
          style={{ position: 'absolute', inset: 0, transform: 'scaleX(-1)', pointerEvents: 'none' }} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: colors.primaryDark }}>📷 카메라 친구</div>
        <div style={{ fontSize: 12, color: colors.textMuted }}>{status}</div>
        {error && <div style={{ fontSize: 11, color: '#F44336' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setMode('hand')}
            style={{
              fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
              background: mode === 'hand' ? colors.primary : '#fff',
              color: mode === 'hand' ? '#fff' : colors.primaryDark,
              border: `1px solid ${colors.primary}`, borderRadius: 999, padding: '6px 12px', cursor: 'pointer',
            }}>✋ 손 펼침 → 서보 A</button>
          <button onClick={() => setMode('head')} disabled
            style={{
              fontFamily: 'inherit', fontWeight: 700, fontSize: 12,
              background: '#fff', color: colors.textMuted,
              border: `1px solid ${colors.border}`, borderRadius: 999, padding: '6px 12px', cursor: 'not-allowed', opacity: 0.5,
            }}>🙂 얼굴 → 자동차 (곧 추가)</button>
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
          손을 폈다 오므렸다 하면 악어 입(서보 A)이 따라 움직여요.
        </div>
      </div>
    </section>
  );
}

// MediaPipe Tasks Vision HandLandmarker 의 NormalizedLandmark 형태.
// Hands(legacy) 는 number[][] 였지만 tasks-vision 은 객체 — 이전 array indexing 으로
// 접근하면 undefined → NaN 발생. 이 버그가 모든 openness 계산을 NaN 으로 만들었음.
type Lm = { x: number; y: number; z?: number };

// 손 펼침 정도 (0~1) — 손가락 끝(8,12,16,20)과 손바닥 중앙(0)의 평균 거리.
function computeHandOpenness(landmarks: Lm[]): number {
  const palm = landmarks[0];
  if (!palm) return 0;
  const tips = [8, 12, 16, 20].map((i) => landmarks[i]).filter(Boolean);
  if (tips.length === 0) return 0;
  const distances = tips.map((t) => {
    const dx = t.x - palm.x;
    const dy = t.y - palm.y;
    return Math.sqrt(dx * dx + dy * dy);
  });
  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
  if (!Number.isFinite(avg)) return 0;
  // normalize: 보통 주먹 ~ 0.1, 펼친 손 ~ 0.35. clamp 후 0~1.
  return Math.max(0, Math.min(1, (avg - 0.1) / 0.25));
}

// 손가락 펴짐 판정 — 3D 관절 각도 (z 좌표 포함).
// MCP→PIP 와 PIP→TIP 두 벡터의 3D dot product (cos).
// 펴진 손가락 = 두 벡터 같은 방향 (cos ≈ 1).
// 굽은 손가락 = 두 벡터 꺾임 (cos < 0.5).
// z 포함이라 손가락이 카메라 쪽/반대쪽으로 굽어도 정확히 검출 (2D 투영 무관).
function jointCos(lm: Lm[], a: number, b: number, c: number): number {
  const pa = lm[a], pb = lm[b], pc = lm[c];
  if (!pa || !pb || !pc) return -1;
  const az = pa.z ?? 0, bz = pb.z ?? 0, cz = pc.z ?? 0;
  const v1x = pb.x - pa.x, v1y = pb.y - pa.y, v1z = bz - az;
  const v2x = pc.x - pb.x, v2y = pc.y - pb.y, v2z = cz - bz;
  const m1 = Math.hypot(v1x, v1y, v1z);
  const m2 = Math.hypot(v2x, v2y, v2z);
  if (m1 < 0.001 || m2 < 0.001) return -1;
  return (v1x * v2x + v1y * v2y + v1z * v2z) / (m1 * m2);
}

// 엄지는 IP 가 거의 안 굽고 MCP 축에서만 굽으므로 3D 각도로도 한계.
// 대신 3D 거리 — tip 이 검지 base 에서 엄지 mcp 보다 충분히 멀리 있으면 펴짐.
function isThumbExt(lm: Lm[]): boolean {
  const tip = lm[4], mcp = lm[2], indexMcp = lm[5];
  if (!tip || !mcp || !indexMcp) return false;
  const d3 = (a: Lm, b: Lm) =>
    Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
  const tipToIdx = d3(tip, indexMcp);
  const mcpToIdx = d3(mcp, indexMcp);
  if (mcpToIdx < 0.001) return false;
  return tipToIdx > mcpToIdx * 1.2;
}

// 5 손가락 펴짐 마스크 [엄지, 검지, 중지, 약지, 새끼]
// 검지~새끼: 3D dot product cos > 0.5 (두 벡터 60도 이내) 면 펴짐.
function fingerMask(lm: Lm[]): boolean[] {
  if (!lm || lm.length < 21) return [false, false, false, false, false];
  return [
    isThumbExt(lm),
    jointCos(lm, 5, 6, 8) > 0.5,    // 검지
    jointCos(lm, 9, 10, 12) > 0.5,  // 중지
    jointCos(lm, 13, 14, 16) > 0.5, // 약지
    jointCos(lm, 17, 18, 20) > 0.5, // 새끼
  ];
}

function countFingers(lm: Lm[]): number {
  return fingerMask(lm).filter(Boolean).length;
}

function drawHand(canvas: HTMLCanvasElement | null, landmarks: Lm[]) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#03A9F4';
  ctx.strokeStyle = '#FFFFFF';
  for (const lm of landmarks) {
    if (!lm) continue;
    const x = lm.x * canvas.width;
    const y = lm.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
