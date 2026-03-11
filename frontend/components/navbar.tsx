"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Moon, Sun, X, Menu } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "./theme-provider";
import { usePathname } from "next/navigation";
import { UserButton, SignInButton, useUser } from "@clerk/nextjs";
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AnimatePresence, motion } from "motion/react";
import { usePairingCount } from "@/lib/use-pairing-count";
export function Navbar({ embedded }: { embedded?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const { isSignedIn, isLoaded } = useUser();
  const t = useTranslations('nav');
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLandingPage = pathname === '/';
  const agentMatch = pathname?.match(/^\/agents\/([a-f0-9]{24})/);
  const isAgentPage = !!agentMatch && !pathname?.startsWith("/agents/builder");
  const agentId = agentMatch?.[1];
  const isBuilderPage = pathname?.startsWith("/agents/builder");

  const pairingPendingCount = usePairingCount(agentId || undefined);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const agentNavItems = agentId ? [
    { href: `/agents/${agentId}`, label: t('overview'), exact: true },
    { href: `/agents/${agentId}/workspace`, label: t('workspace') },
    { href: `/agents/${agentId}/channels`, label: t('channels') },
    { href: `/agents/${agentId}/integrations`, label: t('integrations') },
    { href: `/agents/${agentId}/persona`, label: t('persona') },
    { href: `/agents/${agentId}/settings`, label: t('settings') },
  ] : [];

  // Primary navigation
  const primaryNavItems = [
    { href: "/dashboard", label: t('home'), id: 'tour-dashboard' },
    { href: "/agents", label: t('agents'), id: 'tour-agents' },
    { href: "/knowledge", label: t('knowledge'), id: 'tour-knowledge' },
  ];

  const secondaryNavItems = [
    { href: "/organization", label: t('team') },
    { href: "/billing", label: t('billing') },
    { href: "/settings", label: t('settings') },
  ];

  const isNavActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + '/');
  };

  const headerClass = embedded
    ? "w-full border-b border-border/60 shrink-0 bg-card z-10"
    : "w-full border-b border-border sticky top-0 left-0 right-0 bg-card/95 backdrop-blur-md z-50";

  return (
    <>
      <header className={headerClass}>
        <div className={`px-4 sm:px-5 flex items-center justify-between ${embedded ? 'h-10' : 'h-12'}`}>
          {/* Left: Back + Logo */}
          <div className="flex items-center gap-3 shrink-0">
            {(isAgentPage || isBuilderPage) && (
              <Link
                href="/agents"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
                <span className="hidden sm:inline">{t('agents')}</span>
              </Link>
            )}
            {(isAgentPage || isBuilderPage) && (
              <div className="w-px h-4 bg-border hidden sm:block" />
            )}
            <Link
              href={isSignedIn ? "/dashboard" : "/"}
              className="flex items-center gap-2 hover:opacity-70 transition-opacity"
            >
              <Image
                src="https://ucarecdn.com/df601530-a09a-4c18-b5e4-ed8072cfdf24/logo_transparent_dunkel.png"
                alt="OpenClaw Business"
                width={24}
                height={24}
                className="h-6 w-auto dark:hidden"
              />
              <Image
                src="https://ucarecdn.com/f9188e54-9da2-49b4-a1c7-9ebe496c7060/logo_transparent_weiss.png"
                alt="OpenClaw Business"
                width={24}
                height={24}
                className="h-6 w-auto hidden dark:block"
              />
              <span className="text-base font-medium tracking-tight">OpenClaw Business</span>
            </Link>
          </div>

          {/* Center: Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-0.5">
            {isBuilderPage ? (
              null
            ) : isLandingPage ? (
              <>
                <a href="#how-it-works" className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
                  {t('howItWorks')}
                </a>
                <a href="#pricing" className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5">
                  {t('pricing')}
                </a>
              </>
            ) : isAgentPage ? (
              agentNavItems.map((item) => {
                const isChannels = item.href === `/agents/${agentId}/channels`;
                const badgeCount = isChannels ? pairingPendingCount : null;
                return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                    isNavActive(item.href, item.exact)
                      ? "bg-foreground text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                  {isChannels && badgeCount !== null && badgeCount > 0 && (
                    <span className="min-w-[18px] h-4.5 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-medium px-1.5">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </Link>
              );})
            ) : (
              <>
                {primaryNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    id={item.id}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                      isNavActive(item.href, item.href === '/dashboard')
                        ? "bg-foreground text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="w-px h-3.5 bg-border mx-1" />
                {secondaryNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-all ${
                      isNavActive(item.href)
                        ? "bg-foreground text-primary-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </>
            )}
          </nav>

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isLandingPage && (
              <>
                {isLoaded && !isSignedIn ? (
                  <>
                    <SignInButton mode="modal">
                      <button className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 hidden sm:block">
                        {t('signIn')}
                      </button>
                    </SignInButton>
                    <Link
                      href="/sign-up"
                      className="px-4 py-1.5 text-xs bg-foreground text-primary-foreground hover:bg-foreground/80 rounded-lg transition-colors"
                    >
                      {t('getStarted')}
                    </Link>
                  </>
                ) : (
                  <Link
                    href="/dashboard"
                    className="px-4 py-1.5 text-xs bg-foreground text-primary-foreground hover:bg-foreground/80 rounded-lg transition-colors"
                  >
                    {t('dashboard')}
                  </Link>
                )}
              </>
            )}
            <LanguageSwitcher />
            <button
              onClick={toggleTheme}
              className="w-8 h-8 border border-border hover:border-foreground rounded-lg transition-all flex items-center justify-center"
              aria-label="Toggle theme"
              title={t('switchTheme', { mode: theme === 'light' ? 'dark' : 'light' })}
            >
              {theme === "light" ? (
                <Moon className="w-3.5 h-3.5" strokeWidth={2} />
              ) : (
                <Sun className="w-3.5 h-3.5" strokeWidth={2} />
              )}
            </button>
            {isLoaded && isSignedIn && (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: "w-8 h-8 border border-border rounded-lg",
                  }
                }}
              />
            )}
            {!isBuilderPage && (
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="md:hidden w-8 h-8 border border-border hover:border-foreground rounded-lg transition-all flex items-center justify-center ml-0.5"
                aria-label="Menu"
              >
                {mobileOpen ? (
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                ) : (
                  <Menu className="w-3.5 h-3.5" strokeWidth={2} />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Agent sub-nav: horizontal scroll on mobile */}
        {isAgentPage && agentNavItems.length > 0 && (
          <div className="md:hidden overflow-x-auto border-t border-border/60 scrollbar-hide">
            <div className="flex items-center gap-0.5 px-4 py-1.5 min-w-max">
              {agentNavItems.map((item) => {
                const isChannels = item.href === `/agents/${agentId}/channels`;
                const badgeCount = isChannels ? pairingPendingCount : null;
                return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    isNavActive(item.href, item.exact)
                      ? "bg-foreground text-primary-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                  {isChannels && badgeCount !== null && badgeCount > 0 && (
                    <span className="min-w-[18px] h-4.5 flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-medium px-1.5">
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </Link>
              );})}
            </div>
          </div>
        )}
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 md:hidden"
          >
            <div className="absolute inset-0 bg-black/20 dark:bg-background/40" onClick={() => setMobileOpen(false)} />
            <motion.nav
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute top-12 left-0 right-0 bg-card border-b border-border rounded-b-xl shadow-lg max-h-[calc(100vh-3rem)] overflow-y-auto"
            >
              <div className="px-4 py-3 space-y-1">
                {isLandingPage ? (
                  <>
                    <a href="#how-it-works" onClick={() => setMobileOpen(false)} className="block text-sm text-muted-foreground hover:text-foreground py-2.5 border-b border-border/60">
                      {t('howItWorks')}
                    </a>
                    <a href="#pricing" onClick={() => setMobileOpen(false)} className="block text-sm text-muted-foreground hover:text-foreground py-2.5 border-b border-border/60">
                      {t('pricing')}
                    </a>
                    {isLoaded && !isSignedIn && (
                      <SignInButton mode="modal">
                        <button className="block w-full text-left text-sm text-muted-foreground hover:text-foreground py-2.5">
                          {t('signIn')}
                        </button>
                      </SignInButton>
                    )}
                  </>
                ) : (
                  <>
                    {primaryNavItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center justify-between text-sm py-2.5 border-b border-border/60 ${
                          isNavActive(item.href, item.href === '/dashboard')
                            ? "text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                    <div className="pt-2 mt-1">
                      {secondaryNavItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileOpen(false)}
                          className={`block text-sm py-2.5 border-b border-border/60 ${
                            isNavActive(item.href)
                              ? "text-foreground font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
