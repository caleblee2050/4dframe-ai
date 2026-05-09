'use client';

// 속도 게이지 — 반원 SVG 6단계 (V0~V9 중 학생용은 0/2/4/6/8 5단계만 노출).
// 원본 (Flutter SfRadialGauge) 의 색 단계 매핑 그대로:
//  회색 → 파랑 → 초록 → 노랑 → 주황 → 빨강.

import { useState } from 'react';

interface Props {
  onSpeedChange: (level: number) => void;   // 0~9
  disabled?: boolean;
  colors: { primary: string; primaryDark: string; border: string; textMuted: string };
}

const STEPS = [
  { v: 0, label: '0', color: '#9E9E9E' },
  { v: 2, label: '2', color: '#2196F3' },
  { v: 4, label: '4', color: '#4CAF50' },
  { v: 6, label: '6', color: '#FFEB3B' },
  { v: 8, label: '8', color: '#FF9800' },
  { v: 9, label: '9', color: '#F44336' },
];

export function SpeedGauge({ onSpeedChange, disabled, colors }: Props) {
  const [level, setLevel] = useState(4);

  const setAndSend = (v: number) => {
    setLevel(v);
    onSpeedChange(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: disabled ? 0.4 : 1, width: '100%' }}>
      <svg viewBox="0 0 200 110" style={{ width: '100%', maxWidth: 220 }}>
        {/* 6단계 호 */}
        {STEPS.map((s, i) => {
          const startAngle = 180 + (i * 180) / STEPS.length;
          const endAngle = 180 + ((i + 1) * 180) / STEPS.length;
          const path = arcPath(100, 100, 70, startAngle, endAngle, 18);
          return <path key={s.v} d={path} fill={s.color} opacity={level >= s.v && level > 0 ? 1 : 0.3} />;
        })}
        {/* 바늘 */}
        <NeedlePointer cx={100} cy={100} length={60} angle={180 + (level / 9) * 180} color={colors.primaryDark} />
        {/* 중앙 숫자 */}
        <text x={100} y={95} textAnchor="middle" fontSize="22" fontWeight="900" fill={colors.primaryDark}>V{level}</text>
      </svg>
      {/* 단계 버튼 */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
        {STEPS.map((s) => (
          <button key={s.v} onClick={() => setAndSend(s.v)} disabled={disabled}
            style={{
              fontFamily: 'inherit', fontWeight: 800, fontSize: 12,
              background: level === s.v ? s.color : '#fff',
              color: level === s.v ? '#fff' : '#212121',
              border: `1px solid ${level === s.v ? s.color : colors.border}`,
              borderRadius: 8, padding: '6px 10px', cursor: disabled ? 'not-allowed' : 'pointer',
            }}>{s.label}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted }}>← 단계로 속도 조절</div>
    </div>
  );
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number, width: number): string {
  const rOuter = r;
  const rInner = r - width;
  const start = polarToCartesian(cx, cy, rOuter, endAngle);
  const end = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, startAngle);
  const endInner = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    `M ${start.x} ${start.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function NeedlePointer({ cx, cy, length, angle, color }: { cx: number; cy: number; length: number; angle: number; color: string }) {
  const tip = polarToCartesian(cx, cy, length, angle);
  return (
    <>
      <line x1={cx} y1={cy} x2={tip.x} y2={tip.y} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </>
  );
}
