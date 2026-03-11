import React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { HeroHeader } from './header'
import { ChevronRight } from 'lucide-react'
import { SiWhatsapp, SiTelegram, SiDiscord, SiStripe } from 'react-icons/si'
import { Slack } from '@/components/ui/svgs/slack'
import { Claude } from '@/components/ui/svgs/claude'
import Image from 'next/image'

export default function HeroSection() {
    return (
        <>
            <HeroHeader />
            <main className="overflow-hidden">
                <section className="bg-background">
                    <div className="relative py-32 md:pt-44">
                        <div className="mask-radial-from-45% mask-radial-to-75% mask-radial-at-top mask-radial-[75%_100%] mask-t-from-50% lg:aspect-9/4 absolute inset-0 aspect-square lg:top-24">
                            <Image
                                src="https://images.unsplash.com/photo-1740516367177-ae20098c8786?q=80&w=2268&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                                alt="hero background"
                                width={2268}
                                height={1740}
                                className="size-full object-cover object-top"
                            />
                        </div>
                        <div className="relative z-10 mx-auto w-full max-w-5xl px-6">
                            <div className="mx-auto max-w-md text-center">
                                <h1 className="text-balance font-serif text-4xl font-medium sm:text-5xl">Deploy AI agents. Automate everything.</h1>
                                <p className="text-muted-foreground mt-4 text-balance">Build, deploy, and manage intelligent AI agents across WhatsApp, Telegram, Slack, and more — in minutes, not months.</p>

                                <Button
                                    asChild
                                    className="mt-6 pr-1.5">
                                    <Link href="/sign-up">
                                        <span className="text-nowrap">Start Building Free</span>
                                        <ChevronRight className="opacity-50" />
                                    </Link>
                                </Button>
                            </div>
                            <div className="mx-auto mt-24 max-w-xl">
                                <div className="**:fill-foreground grid scale-95 grid-cols-3 gap-12">
                                    <div className="ml-auto blur-[2px]">
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <SiWhatsapp className="size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">WhatsApp</span>
                                        </Card>
                                    </div>
                                    <div className="ml-auto">
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <Slack className="size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">Slack</span>
                                        </Card>
                                    </div>
                                    <div className="ml-auto blur-[2px]">
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <SiTelegram className="size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">Telegram</span>
                                        </Card>
                                    </div>
                                    <div className="mr-auto">
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <SiDiscord className="size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">Discord</span>
                                        </Card>
                                    </div>
                                    <div className="blur-[2px]">
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <SiStripe className="size-3 sm:size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">Stripe</span>
                                        </Card>
                                    </div>
                                    <div>
                                        <Card className="shadow-foreground/10 flex h-8 w-fit items-center gap-2 rounded-xl px-3 sm:h-10 sm:px-4">
                                            <Claude className="size-3 sm:size-4" />
                                            <span className="text-nowrap font-medium max-sm:text-xs">Claude AI</span>
                                        </Card>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </>
    )
}
