'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ArrowRight, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function CallToAction() {
    const t = useTranslations('landing');
    const benefits = Array.from({ length: 4 }, (_, i) => t(`ctaBenefits.${i}`));

    return (
        <section className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <Card
                    variant="outline"
                    className="@xl:grid-cols-2 grid gap-8 p-6 md:p-8">
                    <div>
                        <h2 className="text-balance font-serif text-3xl font-medium">{t('ctaTitle')}</h2>
                        <p className="text-muted-foreground mt-3 text-balance">{t('ctaDescription')}</p>
                        <ul className="mt-6 space-y-2">
                            {benefits.map((benefit, index) => (
                                <li
                                    key={index}
                                    className="text-muted-foreground flex items-center gap-2 text-sm">
                                    <Check className="text-primary size-4" />
                                    {benefit}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="bg-muted/50 flex flex-col justify-center rounded-xl border p-6">
                        <p className="text-muted-foreground text-sm">{t('professional.period')}</p>
                        <p className="mt-1 font-serif text-4xl font-medium">
                            {t('professional.price')}<span className="text-muted-foreground text-lg font-normal">{t('professional.priceUnit')}</span>
                        </p>
                        <p className="text-muted-foreground mt-1 text-sm">{t('pricingSubtitle')}</p>
                        <Button
                            asChild
                            className="mt-6 gap-2">
                            <Link href="/sign-up">
                                {t('professional.cta')}
                                <ArrowRight className="size-4" />
                            </Link>
                        </Button>
                    </div>
                </Card>
            </div>
        </section>
    )
}
