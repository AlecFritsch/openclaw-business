'use client';

import { useTranslations } from 'next-intl';
import { Navbar } from '@/components/navbar';

export default function TermsPage() {
  const t = useTranslations('terms');

  return (
    <div className="min-h-screen bg-card">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-24">
        <h1 className="text-2xl font-medium mb-8">{t('title')}</h1>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">{t('lastUpdated')}</strong> {t('date')}</p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">1. Acceptance of Terms</h2>
            <p>By accessing and using Havoc, you agree to be bound by these Terms of Service. If you do not agree, do not use our services.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">2. Service Description</h2>
            <p>Havoc provides an AI agent deployment and management platform. We offer tools for building, deploying, and monitoring AI agents across multiple communication channels.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">3. User Responsibilities</h2>
            <p>You are responsible for the agents you deploy and the content they generate. You must ensure your use complies with applicable laws and does not infringe on third-party rights.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">4. Billing & Subscriptions</h2>
            <p>Paid plans are billed monthly. You can cancel at any time. Refunds are handled on a case-by-case basis. Usage beyond plan limits may result in service restrictions.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">5. Limitation of Liability</h2>
            <p>Havoc is provided "as is" without warranties. We are not liable for damages arising from agent behavior, service interruptions, or data loss beyond the extent required by law.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">6. Contact</h2>
            <p>For questions about these terms, contact us at <a href="mailto:legal@usehavoc.com" className="underline hover:text-foreground">legal@usehavoc.com</a>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
