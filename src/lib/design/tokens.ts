// 키즈 네오브루탈리즘 토큰 — ThinkGen_Framework 05_Python_Hub/templates/index.html 디자인 결을 PWA 앱 영역으로 이식.
// 마케팅 랜딩(src/app/page.tsx)의 다크 글래스 네온과는 별개. 학생 대상 화면(/play 등)에서만 사용한다.

export const palette = {
  bg: '#FFF3DF',
  panel: '#FFFFFF',
  primary: '#3F087F',
  secondary: '#FFEF35',
  tertiary: '#9BE4E1',
  accent: '#B6EBB0',
  blueAccent: '#88E8E6',
  textMain: '#110514',
  textMuted: '#6B4A88',
  borderDark: '#110514',
  shadowColor: '#9BE4E1',
  // skill-item 3n 패턴
  tileBlue: '#E0FFF7',
  tilePink: '#FFC9F5',
  tileMint: '#DDF8EF',
} as const;

export const radius = {
  sm: '12px',
  md: '16px',
  lg: '24px',
} as const;

export const shadow = {
  brutal: '8px 9px 0px #3F087F',
  brutalHover: '10px 11px 0px #3F087F',
  brutalActive: '2px 2px 0px #3F087F',
  brutalSm: '4px 5px 0px #3F087F',
} as const;

export const border = {
  brutal: `2px solid ${palette.borderDark}`,
} as const;

export const motion = {
  // 통통 튀는 overshoot easing — 학생 인터랙션 피드백에 사용
  spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  fast: '0.1s ease',
  base: '0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
} as const;

// 배경 폴카닷 패턴 — body 또는 메인 컨테이너에 적용
export const polkaDotBg = {
  backgroundColor: palette.bg,
  backgroundImage: 'radial-gradient(#94DDDF 4px, transparent 4.5px)',
  backgroundSize: '62px 79px',
} as const;

export const fontFamily = {
  // Nunito 400/600/700/800/900 — Google Fonts 또는 next/font/google 로 로드
  app: "'Nunito', sans-serif",
} as const;
