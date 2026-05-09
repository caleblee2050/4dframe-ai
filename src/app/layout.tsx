import type { Metadata } from "next";
import { Outfit, Noto_Sans_KR, Dongle, Jua } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// 4DFrame-Android 의 dongle_bold 와 매치 — 어린이 친화 둥근 한국어 폰트.
// 학생용 페이지 (/play) 에서 사용.
const dongle = Dongle({
  variable: "--font-dongle",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// Jua — 더 굵고 둥근 한국어 폰트. 큰 제목/버튼에 사용.
const jua = Jua({
  variable: "--font-jua",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "4DFrame AI Visionary | 20주년 기념 대회",
  description: "손이 만든 구조, AI가 빛내다. 4DFrame과 AI의 혁신적인 만남. 스케치에서 3D 디지털 트윈까지, 창의력의 새로운 지평을 열어보세요.",
  keywords: ["4DFrame", "AI", "창의력 대회", "STEM 교육", "3D 스캐닝", "디지털 트윈"],
  openGraph: {
    title: "4DFrame AI Visionary | 20주년 기념 대회",
    description: "손이 만든 구조, AI가 빛내다. 4DFrame과 AI의 혁신적인 만남.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body
        className={`${outfit.variable} ${notoSansKR.variable} ${dongle.variable} ${jua.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
