'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

export default function FAQs() {
    const t = useTranslations('landing');
    const faqItems = Array.from({ length: 5 }, (_, i) => ({
        id: `item-${i + 1}`,
        question: t(`faq.items.${i}.q`),
        answer: t(`faq.items.${i}.a`),
    }));

    return (
        <section id="faq" className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <h2 className="text-center font-serif text-4xl font-medium">{t('faq.title')}</h2>
                <Accordion
                    type="single"
                    collapsible
                    className="mt-12">
                    {faqItems.map((item) => (
                        <div
                            className="group"
                            key={item.id}>
                            <AccordionItem
                                value={item.id}
                                className="data-[state=open]:bg-muted/50 peer rounded-xl border-none px-5 py-1 transition-colors">
                                <AccordionTrigger className="cursor-pointer py-4 text-sm font-medium hover:no-underline">{item.question}</AccordionTrigger>
                                <AccordionContent>
                                    <p className="text-muted-foreground pb-2 text-sm">{item.answer}</p>
                                </AccordionContent>
                            </AccordionItem>
                            <hr className="mx-5 group-last:hidden peer-data-[state=open]:opacity-0" />
                        </div>
                    ))}
                </Accordion>
                <p className="text-muted-foreground mt-8 text-center text-sm">
                    {t('faq.contact')}{' '}
                    <Link
                        href="mailto:support@example.com"
                        className="text-primary font-medium hover:underline">
                        {t('faq.contactLink')}
                    </Link>
                </p>
            </div>
        </section>
    )
}
