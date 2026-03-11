'use client'

import { useScroll, useMotionValueEvent, motion, AnimatePresence } from 'motion/react'
import { ArrowUp } from 'lucide-react'
import { useState } from 'react'

export function ScrollProgress() {
    const { scrollYProgress } = useScroll()
    const [visible, setVisible] = useState(false)

    useMotionValueEvent(scrollYProgress, 'change', (v) => setVisible(v > 0.05))

    return (
        <AnimatePresence>
            {visible && (
                <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="group fixed bottom-6 right-6 z-[100] flex size-10 items-center justify-center rounded-full"
                    aria-label="Scroll to top">
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40">
                        <circle cx="20" cy="20" r="18" fill="none" className="stroke-border" strokeWidth="1.5" />
                        <motion.circle
                            cx="20" cy="20" r="18"
                            fill="none"
                            className="stroke-primary"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            style={{ pathLength: scrollYProgress }}
                            strokeDasharray="1"
                            strokeDashoffset="0"
                        />
                    </svg>
                    <ArrowUp className="text-muted-foreground group-hover:text-foreground size-3.5 transition-colors" />
                </motion.button>
            )}
        </AnimatePresence>
    )
}
