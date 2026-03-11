'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'motion/react'
import { CheckCircle, ArrowRight, Loader2 } from 'lucide-react'

export function Waitlist() {
  const t = useTranslations('waitlist')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setState('loading')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed')
      }
      setState('success')
      setEmail('')
    } catch (err: any) {
      setState('error')
      setErrorMsg(err.message || t('errorGeneric'))
      setTimeout(() => setState('idle'), 3000)
    }
  }

  return (
    <div className="w-full max-w-md">
      <AnimatePresence mode="wait">
        {state === 'success' ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 px-5 py-4 text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle className="size-5 shrink-0" />
            <p className="text-sm font-medium">{t('success')}</p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onSubmit={handleSubmit}
            className="flex gap-2"
          >
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('placeholder')}
              className="ring-border bg-card text-foreground placeholder:text-muted-foreground flex-1 rounded-xl px-4 py-2.5 text-sm ring-1 transition-all focus:outline-none focus:ring-2 focus:ring-offset-0"
            />
            <Button
              type="submit"
              disabled={state === 'loading'}
              className="h-[42px] gap-1.5 rounded-xl pr-3"
            >
              {state === 'loading' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <span className="text-nowrap">{t('cta')}</span>
                  <ArrowRight className="size-3.5 opacity-50" />
                </>
              )}
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
      {state === 'error' && (
        <p className="mt-2 text-xs text-red-500">{errorMsg}</p>
      )}
      <p className="text-muted-foreground mt-3 text-xs">{t('note')}</p>
    </div>
  )
}
