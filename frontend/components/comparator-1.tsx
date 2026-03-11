'use client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Check, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'

export default function Comparator() {
    const t = useTranslations('landing');

    const plans = [
        { name: t('professional.label'), price: t('professional.price'), period: t('professional.priceUnit'), cta: t('professional.cta'), highlighted: true },
        { name: t('enterprise.label'), price: t('enterprise.price'), period: '', cta: t('enterprise.cta') },
    ];

    const features = [
        { name: t('comparator.agents'), pro: '∞', enterprise: '∞' },
        { name: t('comparator.messagesPerAgent'), pro: '10,000', enterprise: '∞' },
        { name: t('comparator.teamMembers'), pro: '5', enterprise: '∞' },
        { name: t('comparator.storage'), pro: '50 GB', enterprise: '500 GB' },
        { name: t('comparator.byok'), pro: '✓', enterprise: '✓' },
        { name: t('comparator.apiKeys'), pro: '5', enterprise: '∞' },
        { name: t('comparator.webhooks'), pro: '5', enterprise: '∞' },
        { name: t('comparator.apiRateLimit'), pro: '600/min', enterprise: '5,000/min' },
        { name: t('comparator.batchOps'), pro: false, enterprise: true },
    ];

    return (
        <section className="bg-background @container py-24">
            <div className="mx-auto max-w-3xl px-6">
                <div className="text-center">
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('comparator.title')}</h2>
                    <p className="text-muted-foreground mx-auto mt-4 max-w-md text-balance">{t('comparator.subtitle')}</p>
                </div>
                <Card
                    variant="outline"
                    className="*:min-w-xl mt-12 overflow-auto">
                    <div className="grid grid-cols-3 border-b">
                        <div className="p-4"></div>
                        {plans.map((plan) => (
                            <div
                                key={plan.name}
                                className={`border-l p-4 text-center ${plan.highlighted ? 'bg-primary/5' : ''}`}>
                                <p className="text-foreground font-medium">{plan.name}</p>
                                <p className="mt-1">
                                    <span className="font-serif text-2xl font-medium">{plan.price}</span>
                                    {plan.period && <span className="text-muted-foreground text-sm">{plan.period}</span>}
                                </p>
                            </div>
                        ))}
                    </div>
                    {features.map((feature) => (
                        <div
                            key={feature.name}
                            className="grid grid-cols-4 border-b last:border-b-0">
                            <div className="text-muted-foreground p-4 text-sm">{feature.name}</div>
                            {(['pro', 'enterprise'] as const).map((plan, idx) => {
                                const value = feature[plan]
                                return (
                                    <div
                                        key={plan}
                                        className={`flex items-center justify-center border-l p-4 text-sm ${idx === 0 ? 'bg-primary/5' : ''}`}>
                                        {typeof value === 'boolean' ? value ? <Check className="text-primary size-4" /> : <Minus className="text-muted-foreground size-4" /> : <span className="text-foreground">{value}</span>}
                                    </div>
                                )
                            })}
                        </div>
                    ))}
                    <div className="grid grid-cols-3 border-t">
                        <div className="p-4"></div>
                        {plans.map((plan) => (
                            <div
                                key={plan.name}
                                className={`border-l p-4 ${plan.highlighted ? 'bg-primary/5' : ''}`}>
                                <Button
                                    asChild
                                    variant={plan.highlighted ? 'default' : 'outline'}
                                    size="sm"
                                    className="w-full">
                                    <Link href="/sign-up">{plan.cta}</Link>
                                </Button>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        </section>
    )
}
