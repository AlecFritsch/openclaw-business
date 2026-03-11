'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export default function Pricing() {
    const t = useTranslations('landing');

    const plans = [
        {
            name: t('professional.label'),
            description: t('professional.period'),
            price: t('professional.price'),
            period: t('professional.priceUnit'),
            features: Array.from({ length: 7 }, (_, i) => t(`professional.features.${i}`)),
            cta: t('professional.cta'),
            highlighted: true,
        },
        {
            name: t('enterprise.label'),
            description: t('enterprise.period'),
            price: t('enterprise.price'),
            period: '',
            features: Array.from({ length: 7 }, (_, i) => t(`enterprise.features.${i}`)),
            cta: t('enterprise.cta'),
            highlighted: false,
        },
    ];

    return (
        <section id="pricing" className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <div className="text-center">
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('pricingTitle')}</h2>
                    <p className="text-muted-foreground mx-auto mt-4 max-w-md text-balance">{t('pricingSubtitle')}</p>
                </div>
                <div className="@3xl:grid-cols-2 mt-12 grid gap-3">
                    {plans.map((plan) => (
                        <Card
                            key={plan.name}
                            variant={plan.highlighted ? 'default' : 'mixed'}
                            className={cn('relative flex flex-col p-6 last:col-span-full', plan.highlighted && 'ring-primary')}>
                            <div>
                                <h3 className="text-foreground font-medium">{plan.name}</h3>
                                <p className="text-muted-foreground mt-1 text-sm">{plan.description}</p>
                            </div>
                            <div className="mt-6">
                                <span className="font-serif text-4xl font-medium">{plan.price}</span>
                                <span className="text-muted-foreground">{plan.period}</span>
                            </div>
                            <ul className="mt-6 flex-1 space-y-3">
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature}
                                        className="text-muted-foreground flex items-start gap-2 text-sm">
                                        <Check className="text-primary mt-0.5 size-4 shrink-0" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>
                            <Button
                                asChild
                                variant={plan.highlighted ? 'default' : 'outline'}
                                className="mt-8 w-full">
                                <Link href="/sign-up">{plan.cta}</Link>
                            </Button>
                        </Card>
                    ))}
                </div>
            </div>
        </section>
    )
}
