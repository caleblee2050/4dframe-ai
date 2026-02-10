'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { ArrowRight, Sparkles, Box, Scan, Layers, Users, Trophy, Globe, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

// 4DFrame 브랜드 컬러 기반 그라디언트 오브
function FloatingOrb({ color, size, delay, x, y }: { color: string; size: number; delay: number; x: string; y: string }) {
  return (
    <motion.div
      className="absolute rounded-full blur-3xl opacity-30"
      style={{
        background: color,
        width: size,
        height: size,
        left: x,
        top: y,
      }}
      animate={{
        scale: [1, 1.2, 1],
        opacity: [0.2, 0.4, 0.2],
      }}
      transition={{
        duration: 8,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

// 4DFrame 연결봉 3D 시각화
function Frame3D() {
  return (
    <motion.div
      className="relative w-80 h-80"
      animate={{ rotateY: 360 }}
      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
    >
      <svg viewBox="0 0 200 200" className="w-full h-full">
        {/* 기하학적 4D프레임 구조 */}
        <motion.polygon
          points="100,20 180,60 180,140 100,180 20,140 20,60"
          fill="none"
          stroke="url(#gradient1)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2 }}
        />
        <motion.circle cx="100" cy="20" r="8" fill="#E53935" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 }} />
        <motion.circle cx="180" cy="60" r="8" fill="#1E88E5" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.7 }} />
        <motion.circle cx="180" cy="140" r="8" fill="#FDD835" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.9 }} />
        <motion.circle cx="100" cy="180" r="8" fill="#43A047" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.1 }} />
        <motion.circle cx="20" cy="140" r="8" fill="#8E24AA" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.3 }} />
        <motion.circle cx="20" cy="60" r="8" fill="#FB8C00" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.5 }} />
        {/* 내부 연결선 */}
        <motion.line x1="100" y1="20" x2="100" y2="180" stroke="#fff" strokeWidth="1" opacity="0.3" />
        <motion.line x1="20" y1="60" x2="180" y2="140" stroke="#fff" strokeWidth="1" opacity="0.3" />
        <motion.line x1="20" y1="140" x2="180" y2="60" stroke="#fff" strokeWidth="1" opacity="0.3" />
        <defs>
          <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1E88E5" />
            <stop offset="50%" stopColor="#8E24AA" />
            <stop offset="100%" stopColor="#E53935" />
          </linearGradient>
        </defs>
      </svg>
    </motion.div>
  );
}

// Feature 카드 컴포넌트
function FeatureCard({ icon: Icon, title, description, color, delay }: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      className="glass-card p-8 group cursor-pointer"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay }}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 transition-transform group-hover:scale-110"
        style={{ background: `linear-gradient(135deg, ${color}33, ${color}11)`, border: `1px solid ${color}44` }}
      >
        <Icon size={28} style={{ color }} />
      </div>
      <h3 className="text-xl font-bold text-white mb-3">{title}</h3>
      <p className="text-white/60 leading-relaxed">{description}</p>
    </motion.div>
  );
}

export default function Home() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 1], [1, 0.8]);

  return (
    <main className="bg-grid min-h-screen overflow-x-hidden">
      {/* Floating Orbs Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <FloatingOrb color="#E53935" size={400} delay={0} x="10%" y="20%" />
        <FloatingOrb color="#1E88E5" size={500} delay={2} x="70%" y="10%" />
        <FloatingOrb color="#8E24AA" size={350} delay={4} x="80%" y="60%" />
        <FloatingOrb color="#43A047" size={300} delay={6} x="20%" y="70%" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50">
        <div className="glass-card mx-4 mt-4 rounded-2xl">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-bold text-lg">4D</span>
              </div>
              <span className="text-xl font-bold">
                <span className="gradient-text">Frame</span>
                <span className="text-white/50 ml-1">AI</span>
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-8">
              <Link href="#about" className="text-white/70 hover:text-white transition-colors">대회 소개</Link>
              <Link href="#tools" className="text-white/70 hover:text-white transition-colors">AI 도구</Link>
              <Link href="#gallery" className="text-white/70 hover:text-white transition-colors">갤러리</Link>
              <Link href="#participate" className="text-white/70 hover:text-white transition-colors">참가 안내</Link>
            </div>
            <div className="flex items-center gap-4">
              <button className="hidden md:flex items-center gap-2 text-white/70 hover:text-white transition-colors">
                <Globe size={18} />
                <span>KR</span>
              </button>
              <Link href="/register">
                <motion.button
                  className="btn-primary flex items-center gap-2"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  참가 등록
                  <ArrowRight size={18} />
                </motion.button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <motion.section
        ref={heroRef}
        className="relative min-h-screen flex items-center justify-center pt-20"
        style={{ opacity: heroOpacity, scale: heroScale }}
      >
        <div className="container mx-auto px-6 py-20 flex flex-col lg:flex-row items-center gap-16">
          <div className="flex-1 text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-white/10 mb-8"
            >
              <Sparkles className="text-yellow-400" size={16} />
              <span className="text-sm text-white/80">20주년 기념 특별 대회</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl md:text-7xl font-bold mb-6 leading-tight"
            >
              <span className="text-white">손이 만든 구조,</span>
              <br />
              <span className="gradient-text-vibrant">AI가 빛내다</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-white/60 mb-10 max-w-xl"
            >
              4DFrame과 AI의 혁신적인 만남. 스케치에서 3D 디지털 트윈까지,
              창의력의 새로운 지평을 열어보세요.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start"
            >
              <Link href="/register">
                <motion.button
                  className="btn-primary text-lg px-8 py-4 flex items-center gap-3"
                  whileHover={{ scale: 1.05, boxShadow: "0 20px 60px rgba(30, 136, 229, 0.4)" }}
                  whileTap={{ scale: 0.98 }}
                >
                  지금 참가하기
                  <ArrowRight size={20} />
                </motion.button>
              </Link>
              <Link href="#about">
                <motion.button
                  className="btn-secondary text-lg px-8 py-4"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                >
                  대회 알아보기
                </motion.button>
              </Link>
            </motion.div>
          </div>

          <motion.div
            className="flex-1 flex justify-center"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            <Frame3D />
          </motion.div>
        </div>

        <motion.div
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <ChevronDown className="text-white/40" size={32} />
        </motion.div>
      </motion.section>

      {/* About Section */}
      <section id="about" className="relative py-32">
        <div className="container mx-auto px-6">
          <motion.div
            className="text-center mb-20"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              <span className="gradient-text">촉각과 지능의 공진</span>
            </h2>
            <p className="text-xl text-white/60 max-w-2xl mx-auto">
              "손은 제2의 뇌다." AI는 손이 만든 결과물 속 숨겨진 논리를 시각화하고,
              아이디어가 제품으로 구현되는 구조적 가교 역할을 합니다.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-8">
            <FeatureCard
              icon={Box}
              title="스케치-투-스트럭처"
              description="제품 스케치를 AI가 분석하여 4DFrame 골격 구조를 추천합니다. 곡선을 직선과 연결발로 구현하는 기하학적 해법을 제시합니다."
              color="#E53935"
              delay={0}
            />
            <FeatureCard
              icon={Scan}
              title="360° 디지털 트윈"
              description="실물 구조물을 다각도로 촬영하면 AI가 3D 모델로 복원합니다. 작품을 디지털 자산으로 영구 보존하세요."
              color="#1E88E5"
              delay={0.1}
            />
            <FeatureCard
              icon={Layers}
              title="폭파도 분석"
              description="3D 모델의 조립 과정을 역추적합니다. 부품들이 공중으로 흩어졌다 조립되는 디지털 해체 쇼를 경험하세요."
              color="#8E24AA"
              delay={0.2}
            />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="container mx-auto px-6">
          <div className="glass-card p-12 rounded-3xl">
            <div className="grid md:grid-cols-4 gap-8 text-center">
              {[
                { value: "20", label: "주년", suffix: "th" },
                { value: "26", label: "참가국", suffix: "+" },
                { value: "10K", label: "참가자", suffix: "+" },
                { value: "∞", label: "창의력", suffix: "" },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <div className="text-5xl font-bold gradient-text mb-2">
                    {stat.value}<span className="text-2xl">{stat.suffix}</span>
                  </div>
                  <div className="text-white/60">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section id="tools" className="relative py-32">
        <div className="container mx-auto px-6">
          <motion.div
            className="text-center mb-20"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
              AI 도구 <span className="gradient-text">모듈</span>
            </h2>
            <p className="text-xl text-white/60">
              창의력을 극대화하는 세 가지 AI 도구
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-8">
            {[
              {
                num: "01",
                title: "스케치 분석",
                desc: "거친 스케치를 스캔하면 AI가 4DFrame 골격을 제안합니다",
                color: "#E53935",
                features: ["변곡점 자동 추출", "연결발 추천", "구조적 피드백"]
              },
              {
                num: "02",
                title: "3D 스캐너",
                desc: "다각도 사진으로 360° 3D 모델을 생성합니다",
                color: "#1E88E5",
                features: ["Gaussian Splatting", "실시간 렌더링", "웹 3D 뷰어"]
              },
              {
                num: "03",
                title: "폭파도 뷰어",
                desc: "조립 과정을 역추적하는 인터랙티브 가이드",
                color: "#43A047",
                features: ["분해 애니메이션", "부품 역할 설명", "조립 순서 가이드"]
              }
            ].map((tool, i) => (
              <motion.div
                key={i}
                className="glass-card p-8 group"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                whileHover={{ y: -8 }}
              >
                <div className="text-6xl font-black mb-6" style={{ color: tool.color, opacity: 0.3 }}>
                  {tool.num}
                </div>
                <h3 className="text-2xl font-bold text-white mb-4">{tool.title}</h3>
                <p className="text-white/60 mb-6">{tool.desc}</p>
                <ul className="space-y-2">
                  {tool.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2 text-white/80">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: tool.color }} />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="participate" className="relative py-32">
        <div className="container mx-auto px-6">
          <motion.div
            className="glass-card p-16 text-center rounded-3xl overflow-hidden relative"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10" />
            <div className="relative z-10">
              <motion.div
                className="inline-flex items-center gap-2 mb-6"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Trophy className="text-yellow-400" size={40} />
              </motion.div>
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
                2026년 연말, <span className="gradient-text-vibrant">역사가 됩니다</span>
              </h2>
              <p className="text-xl text-white/60 max-w-2xl mx-auto mb-10">
                전 세계 창의적인 빌더들과 함께하세요.
                당신의 아이디어가 AI와 만나 새로운 차원으로 확장됩니다.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/register">
                  <motion.button
                    className="btn-primary text-lg px-10 py-5 flex items-center gap-3"
                    whileHover={{ scale: 1.05, boxShadow: "0 20px 60px rgba(30, 136, 229, 0.5)" }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Users size={20} />
                    참가 등록하기
                  </motion.button>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-12">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <span className="text-white font-bold text-lg">4D</span>
              </div>
              <span className="text-white/60">
                4DFrame AI Visionary © 2026
              </span>
            </div>
            <div className="flex items-center gap-6 text-white/40">
              <Link href="#" className="hover:text-white transition-colors">이용약관</Link>
              <Link href="#" className="hover:text-white transition-colors">개인정보처리방침</Link>
              <Link href="#" className="hover:text-white transition-colors">문의하기</Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
