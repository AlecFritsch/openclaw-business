'use client'
import { useTranslations } from 'next-intl'

export default function Testimonials() {
    const t = useTranslations('landing');
    const testimonials = [0, 1, 2, 3].map((i) => ({
        name: t(`testimonials.items.${i}.name`),
        role: `${t(`testimonials.items.${i}.role`)}, ${t(`testimonials.items.${i}.company`)}`,
        quote: t(`testimonials.items.${i}.quote`),
    }));

    return (
        <section className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <div className="space-y-4">
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('testimonials.title')}</h2>
                    <p className="text-muted-foreground text-balance">{t('testimonials.label')}</p>
                </div>
                <div className="@xl:grid-cols-2 mt-12 grid gap-3">
                    {testimonials.map((item, i) => (
                        <div key={i} className="bg-card ring-border text-foreground space-y-3 rounded-2xl p-4 text-sm ring-1">
                            <p className="text-sm font-medium">{item.name} <span className="text-muted-foreground ml-2 font-normal">{item.role}</span></p>
                            <p className="text-muted-foreground text-sm">{item.quote}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
