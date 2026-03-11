'use client'
import Image from 'next/image'
import { useTranslations } from 'next-intl'

export default function Stats() {
    const t = useTranslations('landing');
    return (
        <section className="bg-background @container pt-24">
            <div className="mx-auto max-w-2xl px-6">
                <div className="space-y-4">
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('builtForTitle')}</h2>
                    <p className="text-muted-foreground text-balance">{t('trustedBy')}</p>
                </div>
                <div className="@xl:grid-cols-3 mt-12 grid gap-6 text-sm">
                    <div className="border-t py-6">
                        <p className="text-muted-foreground text-xl">
                            <span className="text-foreground font-medium">{t('trustBadges.uptime')}</span> {t('metrics.uptimeLabel')}
                        </p>
                    </div>
                    <div className="border-t py-6">
                        <p className="text-muted-foreground text-xl">
                            <span className="text-foreground font-medium">{t('metrics.channels')}</span> {t('metrics.channelsLabel')}
                        </p>
                    </div>
                    <div className="border-t py-6">
                        <p className="text-muted-foreground text-xl">
                            <span className="text-foreground font-medium">{t('metrics.deployment')}</span> {t('metrics.deploymentLabel')}
                        </p>
                    </div>
                </div>
            </div>
            <div className="mask-radial-from-65% mask-radial-at-bottom mask-radial-[50%_100%] pointer-events-none relative mx-auto max-w-4xl">
                <div className="bg-primary absolute inset-0 z-10 mix-blend-overlay" />
                <Image
                    src="https://images.unsplash.com/photo-1723307060937-b003478a2c03?q=80&w=2928&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                    alt="globe"
                    className=""
                    width={2928}
                    height={1464}
                />
            </div>
        </section>
    )
}
