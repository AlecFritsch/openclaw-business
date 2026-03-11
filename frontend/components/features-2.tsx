'use client'
import { Card } from '@/components/ui/card'
import { Shield } from 'lucide-react'
import { SiWhatsapp, SiTelegram, SiDiscord } from 'react-icons/si'
import { Slack } from '@/components/ui/svgs/slack'
import { Claude } from '@/components/ui/svgs/claude'
import { useTranslations } from 'next-intl'

export default function Features() {
    const t = useTranslations('landing');
    return (
        <section id="features" className="bg-background @container py-24">
            <div className="mx-auto max-w-2xl px-6">
                <div>
                    <h2 className="text-balance font-serif text-4xl font-medium">{t('platformTitle')}</h2>
                    <p className="text-muted-foreground mt-4 text-balance">{t('channelsDescription')}</p>
                </div>
                <div className="@xl:grid-cols-2 mt-12 grid gap-3 *:p-6">
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid">
                        <div className="space-y-2">
                            <h3 className="text-foreground font-medium">{t('features.multiChannel')}</h3>
                            <p className="text-muted-foreground text-sm">{t('features.multiChannelDesc')}</p>
                        </div>
                        <div
                            aria-hidden
                            className="**:fill-foreground flex h-44 flex-col justify-between pt-8">
                            <div className="relative flex h-10 items-center gap-12 px-6">
                                <div className="bg-border absolute inset-0 my-auto h-px"></div>
                                <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring">
                                    <SiWhatsapp className="size-3.5" />
                                </div>
                                <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring">
                                    <Slack className="size-3.5" />
                                </div>
                            </div>
                            <div className="pl-17 relative flex h-10 items-center justify-between gap-12 pr-6">
                                <div className="bg-border absolute inset-0 my-auto h-px"></div>
                                <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring">
                                    <SiTelegram className="size-3.5" />
                                </div>
                                <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring">
                                    <SiDiscord className="size-3.5" />
                                </div>
                            </div>
                            <div className="relative flex h-10 items-center gap-20 px-8">
                                <div className="bg-border absolute inset-0 my-auto h-px"></div>
                                <div className="bg-card shadow-black/6.5 ring-border relative flex h-8 items-center rounded-full px-3 shadow-sm ring">
                                    <Claude className="size-3.5" />
                                </div>
                            </div>
                        </div>
                    </Card>
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid overflow-hidden">
                        <div className="space-y-2">
                            <h3 className="text-foreground font-medium">{t('features.builder')}</h3>
                            <p className="text-muted-foreground text-sm">{t('features.builderDesc')}</p>
                        </div>
                        <div
                            aria-hidden
                            className="relative h-44 translate-y-6">
                            <div className="bg-foreground/15 absolute inset-0 mx-auto w-px"></div>
                            <div className="absolute -inset-x-16 top-6 aspect-square rounded-full border"></div>
                            <div className="border-primary mask-l-from-50% mask-l-to-90% mask-r-from-50% mask-r-to-50% absolute -inset-x-16 top-6 aspect-square rounded-full border"></div>
                            <div className="absolute -inset-x-8 top-24 aspect-square rounded-full border"></div>
                            <div className="mask-r-from-50% mask-r-to-90% mask-l-from-50% mask-l-to-50% absolute -inset-x-8 top-24 aspect-square rounded-full border border-lime-500"></div>
                        </div>
                    </Card>
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid overflow-hidden">
                        <div className="space-y-2">
                            <h3 className="text-foreground font-medium">{t('features.byom')}</h3>
                            <p className="text-muted-foreground mt-2 text-sm">{t('features.byomDesc')}</p>
                        </div>
                        <div
                            aria-hidden
                            className="*:bg-foreground/15 flex h-44 justify-between pb-6 pt-12 *:h-full *:w-px">
                            <div></div><div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                            <div></div><div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                            <div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                            <div></div><div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                            <div></div><div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                            <div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                            <div className="bg-primary!"></div>
                        </div>
                    </Card>
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid">
                        <div className="space-y-2">
                            <h3 className="font-medium">{t('features.infrastructure')}</h3>
                            <p className="text-muted-foreground text-sm">{t('features.infrastructureDesc')}</p>
                        </div>
                        <div className="pointer-events-none relative -ml-7 flex size-44 items-center justify-center pt-5">
                            <Shield className="absolute inset-0 top-2.5 size-full stroke-[0.1px] opacity-15" />
                            <Shield className="size-32 stroke-[0.1px]" />
                        </div>
                    </Card>
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid">
                        <div className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">New</span>
                            <h3 className="font-medium">{t('features.knowledgeHub')}</h3>
                            <p className="text-muted-foreground text-sm">{t('features.knowledgeHubDesc')}</p>
                        </div>
                        <div aria-hidden className="flex h-44 flex-col items-center justify-center gap-2 pt-4">
                            <div className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-xs">📄</div>
                                <div className="h-px w-8 bg-border"></div>
                                <div className="h-8 w-8 rounded-lg bg-blue-500/15 flex items-center justify-center text-blue-600 dark:text-blue-400 text-xs">⚡</div>
                                <div className="h-px w-8 bg-border"></div>
                                <div className="h-8 w-8 rounded-lg bg-purple-500/15 flex items-center justify-center text-purple-600 dark:text-purple-400 text-xs">🔍</div>
                            </div>
                            <p className="text-xs text-muted-foreground/60 mt-2">Upload → Embed → Search</p>
                        </div>
                    </Card>
                    <Card
                        variant="mixed"
                        className="row-span-2 grid grid-rows-subgrid">
                        <div className="space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">New</span>
                            <h3 className="font-medium">{t('features.unifiedChat')}</h3>
                            <p className="text-muted-foreground text-sm">{t('features.unifiedChatDesc')}</p>
                        </div>
                        <div aria-hidden className="flex h-44 flex-col justify-center gap-2 px-4 pt-4">
                            <div className="rounded-xl bg-foreground/5 border border-border/40 p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <div className="h-5 w-5 rounded-full bg-blue-500/20"></div>
                                    <div className="h-2 w-24 rounded bg-foreground/10"></div>
                                </div>
                                <div className="h-2 w-full rounded bg-foreground/5"></div>
                                <div className="h-2 w-3/4 rounded bg-foreground/5"></div>
                            </div>
                            <p className="text-xs text-muted-foreground/60 text-center">Any model. Your knowledge.</p>
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    )
}
