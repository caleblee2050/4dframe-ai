'use client';

// 서보 게이지 — 좌우 화살표 버튼으로 ±15도. 현재 각도를 시각화.
// 펌웨어 ±15도 누적. 학생용에선 자세한 숫자 안 노출하고 막대 + 화살표만.

import { useState } from 'react';

interface Props {
  label: string;
  onUp: () => void;
  onDown: () => void;
  disabled?: boolean;
  colors: { primary: string; primaryDark: string; primaryLight: string; border: string; textMuted: string };
}

export function ServoGauge({ label, onUp, onDown, disabled, colors }: Props) {
  // 현재 각도 추정 (90 시작, ±15 누적). 실제 보드 각도와 동기화 안 됨 — 시각 피드백용.
  const [angle, setAngle] = useState(90);

  const handleUp = () => {
    setAngle((a) => Math.min(180, a + 15));
    onUp();
  };
  const handleDown = () => {
    setAngle((a) => Math.max(0, a - 15));
    onDown();
  };

  const pct = (angle / 180) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, opacity: disabled ? 0.4 : 1 }}>
      <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={handleDown} disabled={disabled || angle <= 0}
          style={iconBtn(colors)}>◀</button>
        <div style={{
          flex: 1, height: 14, borderRadius: 7, background: '#FAFAFA',
          border: `1px solid ${colors.border}`, position: 'relative', overflow: 'hidden',
        }}>
          {/* 색 그라디언트 배경 */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to right, #FFEB3B, #FFC107, #FF9800, #F44336)',
            opacity: 0.6,
          }} />
          {/* 마커 */}
          <div style={{
            position: 'absolute', left: `${pct}%`,
            top: '50%', transform: 'translate(-50%, -50%)',
            width: 18, height: 18, borderRadius: '50%',
            background: colors.primary, boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            transition: 'left 0.15s',
          }} />
        </div>
        <button onClick={handleUp} disabled={disabled || angle >= 180}
          style={iconBtn(colors)}>▶</button>
      </div>
      <div style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }}>{angle}°</div>
    </div>
  );
}

function iconBtn(colors: Props['colors']): React.CSSProperties {
  return {
    fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
    background: colors.primaryLight, color: colors.primaryDark,
    border: 'none', borderRadius: 6,
    width: 28, height: 28, cursor: 'pointer',
  };
}
