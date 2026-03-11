'use client'
import { Bot, Zap, MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function Content() {
    const t = useTranslations('landing');
    return (
        <section className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <div className="space-y-4">
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('howItWorksTitle')}</h2>
                    <p className="text-muted-foreground">{t('howItWorksLabel')}</p>
                </div>
                <div className="@xl:grid-cols-3 mt-12 grid grid-cols-2 gap-6 text-sm">
                    <div className="space-y-3 border-t pt-6">
                        <Bot className="text-muted-foreground size-4" />
                        <p className="text-muted-foreground leading-5">
                            <span className="text-foreground font-medium">{t('steps.step1Title')}</span> {t('steps.step1Desc')}
                        </p>
                    </div>
                    <div className="space-y-3 border-t pt-6">
                        <Zap className="text-muted-foreground size-4" />
                        <p className="text-muted-foreground leading-5">
                            <span className="text-foreground font-medium">{t('steps.step3Title')}</span> {t('steps.step3Desc')}
                        </p>
                    </div>
                    <div className="space-y-3 border-t pt-6">
                        <MessageSquare className="text-muted-foreground size-4" />
                        <p className="text-muted-foreground leading-5">
                            <span className="text-foreground font-medium">{t('steps.step4Title')}</span> {t('steps.step4Desc')}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    )
}
