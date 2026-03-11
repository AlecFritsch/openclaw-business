import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { CommandPalette } from "@/components/command-palette";
import { ToastContainer } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { DeployRefresh } from "@/components/deploy-refresh";
import { PlanGate } from "@/components/plan-gate";
import { ClerkProvider } from '@clerk/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { NextStepProvider, NextStep } from 'nextstepjs';
import { tourSteps } from '@/lib/tour-steps';
import { TourTrigger } from '@/components/tour-trigger';
import TourCard from '@/components/tour-card';

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "OpenClaw Business - AI Agents für dein Business",
  description: "Stelle autonome AI Agents ein, die 24/7 für dein Unternehmen arbeiten. Leads qualifizieren, Kunden betreuen, Tasks erledigen. DSGVO-konform, EU-hosted.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  icons: {
    icon: [
      {
        media: '(prefers-color-scheme: light)',
        url: '/images/favicon-dark.ico',
        href: '/images/favicon-dark.ico',
      },
      {
        media: '(prefers-color-scheme: dark)',
        url: '/images/favicon-light.ico',
        href: '/images/favicon-light.ico',
      },
    ],
  },
  openGraph: {
    title: "OpenClaw Business - AI Agents für dein Business",
    description: "Stelle autonome AI Agents ein, die 24/7 für dein Unternehmen arbeiten. Leads qualifizieren, Kunden betreuen, Tasks erledigen. DSGVO-konform, EU-hosted.",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    siteName: "OpenClaw Business",
    type: "website",
    locale: "de_DE",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenClaw Business - AI Agents für dein Business",
    description: "Stelle autonome AI Agents ein, die 24/7 für dein Unternehmen arbeiten. DSGVO-konform, EU-hosted.",
  },
  keywords: ["AI Mitarbeiter", "AI Agents", "autonome AI", "AI für Unternehmen", "DSGVO AI", "AI Workforce", "Business AI", "AI Automatisierung"],
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <ClerkProvider>
      <html lang={locale} className={inter.variable} suppressHydrationWarning>
        <body
          className="font-sans antialiased bg-background text-foreground"
          suppressHydrationWarning
        >
          <NextIntlClientProvider messages={messages}>
            <ThemeProvider>
              <TooltipProvider delayDuration={200}>
                <ConfirmProvider>
                <DeployRefresh />
                <CommandPalette />
                <ToastContainer />
                <PlanGate>
                <NextStepProvider>
                  <NextStep steps={tourSteps} cardComponent={TourCard} shadowOpacity="0.5">
                    <TourTrigger />
                    {children}
                  </NextStep>
                </NextStepProvider>
                </PlanGate>
                </ConfirmProvider>
              </TooltipProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
