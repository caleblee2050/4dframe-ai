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
const THUMB = 52;
const RADIUS = SIZE / 2;
const DEAD_ZONE = 8;                                    // 정밀 제어: 데드존 최소화
const MAX_REACH = RADIUS - THUMB / 2;                   // 썸 중심이 도달 가능한 최대 반경
const ACTIVE_SPAN = MAX_REACH - DEAD_ZONE;              // mag 정규화 분모
const LEVELS = 9;                                        // V1~V9 — 시각 가이드 링도 9개

export function Joystick({ onDirection, onMove, disabled, colors }: Props) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const [thumbPos, setThumbPos] = useState({ x: 0, y: 0 });
  const [currentLevel, setCurrentLevel] = useState(0);   // 0~9 — UI 하이라이트용
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
    if (dist > MAX_REACH) {
      dx = (dx / dist) * MAX_REACH;
      dy = (dy / dist) * MAX_REACH;
    }
    setThumbPos({ x: dx, y: dy });

    // mag 재정규화: 데드존 직후 = 0, MAX_REACH = 1.
    // 기존 (dist/MAX_REACH) 은 데드존 직후 = 0.1~0.3 으로 시작해 V1~V2 건너뛰는 문제 fix.
    let mag = 0;
    if (dist > DEAD_ZONE) {
      mag = Math.min(1, (dist - DEAD_ZONE) / ACTIVE_SPAN);
    }
    // 9등분 균등 — ceil 로 mag=0+ε → V1, mag=1 → V9 보장. epsilon 으로 부동소수점 오차 차단.
    const level = mag === 0 ? 0 : Math.max(1, Math.min(LEVELS, Math.ceil(mag * LEVELS - 1e-6)));
    setCurrentLevel(level);

    // 정교 모드 콜백 — 매 프레임 호출
    if (onMove) {
      if (mag === 0) {
        onMove(0, 0, 0);
      } else {
        // x,y 방향 벡터는 정규화된 단위 벡터 (방향만), mag 가 크기.
        const ux = dx / dist;
        const uy = dy / dist;
        onMove(ux * mag, uy * mag, mag);
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
    setCurrentLevel(0);
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

  // 9단계 가이드 링 — 각 링 = 그 레벨의 외곽 경계 (썸 중심이 닿으면 그 레벨 도달).
  // 시각적으로 학생이 어디까지 끌면 V몇이 되는지 즉시 파악.
  const ringRadii = Array.from({ length: LEVELS }, (_, i) =>
    DEAD_ZONE + ((i + 1) / LEVELS) * ACTIVE_SPAN
  );

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
        {/* 9단계 가이드 링 (SVG) — 현재 레벨까지 채워진 링은 진한 색 */}
        <svg
          width={SIZE} height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {ringRadii.map((r, i) => {
            const level = i + 1;
            const isActive = currentLevel >= level;
            return (
              <circle
                key={level}
                cx={RADIUS} cy={RADIUS} r={r}
                fill="none"
                stroke={isActive ? colors.primary : '#E0E0E0'}
                strokeWidth={isActive ? 2 : 1}
                opacity={isActive ? 0.85 : 0.55}
              />
            );
          })}
        </svg>
        {/* 4방향 가이드 화살표 */}
        <div style={arrow('top')}>↑</div>
        <div style={arrow('bottom')}>↓</div>
        <div style={arrow('left')}>←</div>
        <div style={arrow('right')}>→</div>
        {/* 썸 — 안에 현재 V 레벨 숫자 */}
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(calc(-50% + ${thumbPos.x}px), calc(-50% + ${thumbPos.y}px))`,
          width: THUMB, height: THUMB, borderRadius: '50%',
          background: colors.primary,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: currentLevel === 0 ? 13 : 22, fontWeight: 900,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          transition: draggingRef.current ? 'none' : 'transform 0.15s ease-out',
          userSelect: 'none',
        }}>
          {currentLevel === 0 ? '⏹' : `V${currentLevel}`}
        </div>
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', lineHeight: 1.4 }}>
        가운데 = 정지 / 끌수록 V1 → V9 (9단계)
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
