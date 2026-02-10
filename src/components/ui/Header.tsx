'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Menu, X, Globe } from 'lucide-react';
import { useState } from 'react';
import { Button } from './Button';

const navItems = [
    { label: '대회 소개', href: '#about' },
    { label: 'AI 도구', href: '#tools' },
    { label: '갤러리', href: '/gallery' },
    { label: '참가 안내', href: '#participate' },
];

export function Header() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <motion.header
            className="fixed top-0 left-0 right-0 z-50"
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <div className="glass-card mx-4 mt-4 rounded-2xl">
                <nav className="container mx-auto px-6 py-4 flex items-center justify-between">
                    {/* Logo */}
                    <Link href="/" className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                            <span className="text-white font-bold text-lg">4D</span>
                        </div>
                        <span className="text-xl font-bold">
                            <span className="gradient-text">Frame</span>
                            <span className="text-white/50 ml-1">AI</span>
                        </span>
                    </Link>

                    {/* Desktop Navigation */}
                    <div className="hidden md:flex items-center gap-8">
                        {navItems.map((item) => (
                            <Link
                                key={item.label}
                                href={item.href}
                                className="text-white/70 hover:text-white transition-colors"
                            >
                                {item.label}
                            </Link>
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="hidden md:flex items-center gap-4">
                        <button className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
                            <Globe size={18} />
                            <span>KR</span>
                        </button>
                        <Link href="/register">
                            <Button size="sm">참가 등록</Button>
                        </Link>
                    </div>

                    {/* Mobile Menu Button */}
                    <button
                        className="md:hidden text-white"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {isOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </nav>

                {/* Mobile Navigation */}
                {isOpen && (
                    <motion.div
                        className="md:hidden px-6 pb-6"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                    >
                        <div className="flex flex-col gap-4">
                            {navItems.map((item) => (
                                <Link
                                    key={item.label}
                                    href={item.href}
                                    className="text-white/70 hover:text-white transition-colors py-2"
                                    onClick={() => setIsOpen(false)}
                                >
                                    {item.label}
                                </Link>
                            ))}
                            <Link href="/register" onClick={() => setIsOpen(false)}>
                                <Button className="w-full">참가 등록</Button>
                            </Link>
                        </div>
                    </motion.div>
                )}
            </div>
        </motion.header>
    );
}
