// 키즈 네오브루탈리즘 토큰 — ThinkGen_Framework 05_Python_Hub/templates/index.html 디자인 결을 PWA 앱 영역으로 이식.
// 마케팅 랜딩(src/app/page.tsx)의 다크 글래스 네온과는 별개. 학생 대상 화면(/play 등)에서만 사용한다.

export const palette = {
  bg: '#FFF8E7',
  panel: '#FFFFFF',
  primary: '#FF6B6B',
  secondary: '#FFE66D',
  tertiary: '#4ECDC4',
  accent: '#A8E6CF',
  blueAccent: '#45B7D1',
  textMain: '#2D3142',
  textMuted: '#6B708D',
  borderDark: '#4A5568',
  shadowColor: 'rgba(74, 85, 104, 0.25)',
  // skill-item 3n 패턴
  tileBlue: '#E8F7FF',
  tilePink: '#FFF0F5',
  tileMint: '#F0FFF4',
} as const;

export const radius = {
  sm: '12px',
  md: '16px',
  lg: '24px',
} as const;

export const shadow = {
  brutal: '3px 3px 0px rgba(74, 85, 104, 0.25)',
  brutalHover: '5px 5px 0px rgba(74, 85, 104, 0.25)',
  brutalActive: '0px 0px 0px rgba(74, 85, 104, 0.25)',
  brutalSm: '2px 2px 0px rgba(74, 85, 104, 0.25)',
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
  backgroundImage: 'radial-gradient(#E8E0CE 2px, transparent 2px)',
  backgroundSize: '30px 30px',
} as const;

export const fontFamily = {
  // Nunito 400/600/700/800/900 — Google Fonts 또는 next/font/google 로 로드
  app: "'Nunito', sans-serif",
} as const;
