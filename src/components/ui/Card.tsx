'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface CardProps {
    children: ReactNode;
    className?: string;
    hover?: boolean;
    glow?: 'blue' | 'purple' | 'none';
}

export function Card({
    children,
    className = '',
    hover = true,
    glow = 'none',
}: CardProps) {
    const glowStyles = {
        blue: 'hover:shadow-blue-500/20',
        purple: 'hover:shadow-purple-500/20',
        none: '',
    };

    return (
        <motion.div
            className={`
        glass-card p-6
        ${hover ? 'hover:-translate-y-1 hover:shadow-xl cursor-pointer' : ''}
        ${glowStyles[glow]}
        transition-all duration-300
        ${className}
      `}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
        >
            {children}
        </motion.div>
    );
}
