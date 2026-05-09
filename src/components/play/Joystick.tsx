'use client';

// 가상 조이스틱 — magnitude + angle 아날로그 + 4방향 호환.
// onMove(x, y, mag) 가 핵심: x ∈ [-1,1] (좌-우), y ∈ [-1,1] (위-아래),
//   mag ∈ [0,1] (중심으로부터 거리). 차동 조향 / 속도 동시 제어용.
// onDirection 은 기존 4방향 호환 (단순 모드).

import { useEffect, useRef, useState } from 'react';

type Direction = 'up' | 'down' | 'left' | 'right' | 'stop';

interface Props {
  onDirection?: (dir: Direction) => void;
  // 정교 모드: x,y ∈ [-1,1] (정규화). y>0 = 아래(후진), y<0 = 위(전진).
  // mag ∈ [0,1]. dead-zone 안에서는 호출 안 함.
  onMove?: (x: number, y: number, mag: number) => void;
  disabled?: boolean;
  colors: { primary: string; primaryLight: string; border: string; textMuted: string };
}

const SIZE = 200;
const THUMB = 60;
const RADIUS = SIZE / 2;
const DEAD_ZONE = 25;

export function Joystick({ onDirection, onMove, disabled, colors }: Props) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 });
  const lastDirRef = useRef<Direction>('stop');
  const draggingRef = useRef(false);

  const computeFromEvent = (clientX: number, clientY: number) => {
    if (!baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const max = RADIUS - THUMB / 2;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    setThumbPos({ x: dx, y: dy });

    // 정교 모드 콜백 — 정규화 후 매 프레임 호출
    if (onMove) {
      if (dist < DEAD_ZONE) {
        onMove(0, 0, 0);
      } else {
        const nx = dx / max;   // [-1, 1]
        const ny = dy / max;
        const mag = Math.min(1, dist / max);
        onMove(nx, ny, mag);
      }
    }

    // 4방향 호환 모드
    if (onDirection) {
      let dir: Direction = 'stop';
      if (dist >= DEAD_ZONE) {
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
        else dir = dy > 0 ? 'down' : 'up';
      }
      if (lastDirRef.current !== dir) {
        lastDirRef.current = dir;
        onDirection(dir);
      }
    }
  };

  const stop = () => {
    setThumbPos({ x: 0, y: 0 });
    if (onMove) onMove(0, 0, 0);
    if (onDirection && lastDirRef.current !== 'stop') {
      lastDirRef.current = 'stop';
      onDirection('stop');
    }
  };

  // 전역 mouse/touch 핸들러
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (draggingRef.current) computeFromEvent(e.clientX, e.clientY); };
    const onMouseUp = () => { if (draggingRef.current) { draggingRef.current = false; stop(); } };
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current && e.touches[0]) computeFromEvent(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => { if (draggingRef.current) { draggingRef.current = false; stop(); } };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <div
        ref={baseRef}
        onMouseDown={(e) => { if (disabled) return; draggingRef.current = true; computeFromEvent(e.clientX, e.clientY); }}
        onTouchStart={(e) => { if (disabled) return; draggingRef.current = true; const t = e.touches[0]; if (t) computeFromEvent(t.clientX, t.clientY); }}
        style={{
          width: SIZE, height: SIZE,
          borderRadius: '50%',
          background: '#FAFAFA',
          border: `2px solid ${colors.border}`,
          position: 'relative',
          cursor: disabled ? 'not-allowed' : 'pointer',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* 4방향 가이드 화살표 */}
        <div style={arrow('top')}>↑</div>
        <div style={arrow('bottom')}>↓</div>
        <div style={arrow('left')}>←</div>
        <div style={arrow('right')}>→</div>
        {/* 썸 */}
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))`,
          width: THUMB, height: THUMB, borderRadius: '50%',
          background: colors.primary,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          transition: draggingRef.current ? 'none' : 'transform 0.15s ease-out',
        }} />
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted }}>
        가운데 = 정지 / 화살표 방향으로 끌기
      </div>
    </div>
  );
}

function arrow(pos: 'top' | 'bottom' | 'left' | 'right'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    fontSize: 18,
    color: '#BDBDBD',
    pointerEvents: 'none',
    fontWeight: 900,
  };
  if (pos === 'top') return { ...base, top: 8, left: '50%', transform: 'translateX(-50%)' };
  if (pos === 'bottom') return { ...base, bottom: 8, left: '50%', transform: 'translateX(-50%)' };
  if (pos === 'left') return { ...base, left: 8, top: '50%', transform: 'translateY(-50%)' };
  return { ...base, right: 8, top: '50%', transform: 'translateY(-50%)' };
}
