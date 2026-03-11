'use client'
import Link from 'next/link'
import { Logo } from '@/components/logo'
import { useTranslations } from 'next-intl'

export default function Footer() {
    const t = useTranslations('landing');

    const links = {
        product: [
            { label: t('navFeatures'), href: '#features' },
            { label: t('navPricing'), href: '#pricing' },
            { label: t('navFaq'), href: '#faq' },
            { label: t('footer.templates'), href: '/templates' },
            { label: t('footer.liveExample'), href: 'https://usehavoc.com', external: true },
        ],
        resources: [
            { label: t('footer.dashboard'), href: '/dashboard' },
            { label: t('navLogin'), href: '/sign-in' },
            { label: t('navSignUp'), href: '/sign-up' },
        ],
        legal: [
            { label: t('footer.privacy'), href: '/privacy' },
            { label: t('footer.terms'), href: '/terms' },
        ],
    };

    return (
        <footer className="bg-background @container border-t py-12">
            <div className="mx-auto max-w-2xl px-6">
                <div className="@sm:grid-cols-3 grid grid-cols-2 gap-8">
                    <div className="col-span-full">
                        <Link
                            href="/"
                            className="flex items-center gap-2">
                            <Logo className="h-5 w-fit" />
                        </Link>
                        <p className="text-muted-foreground mt-4 max-w-xs text-sm">{t('heroDescription')}</p>
                    </div>
                    <div>
                        <h3 className="text-foreground mb-3 text-sm font-medium">{t('footer.product')}</h3>
                        <ul className="space-y-2">
                            {links.product.map((link) => (
                                <li key={link.label}>
                                    {'external' in link ? (
                                        <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground text-sm transition-colors">{link.label}</a>
                                    ) : (
                                        <Link href={link.href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">{link.label}</Link>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-foreground mb-3 text-sm font-medium">{t('footer.resources')}</h3>
                        <ul className="space-y-2">
                            {links.resources.map((link) => (
                                <li key={link.label}>
                                    <Link href={link.href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">{link.label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-foreground mb-3 text-sm font-medium">{t('footer.legal')}</h3>
                        <ul className="space-y-2">
                            {links.legal.map((link) => (
                                <li key={link.label}>
                                    <Link href={link.href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">{link.label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-8">
                    <p className="text-muted-foreground text-sm">{t('footer.copyright')}. {t('footer.allRights')}</p>
                </div>
            </div>
        </footer>
    )
}
