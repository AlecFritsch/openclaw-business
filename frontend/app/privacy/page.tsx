'use client';

import { useTranslations } from 'next-intl';
import { Navbar } from '@/components/navbar';

export default function PrivacyPage() {
  const t = useTranslations('privacy');

  return (
    <div className="min-h-screen bg-card">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-24">
        <h1 className="text-2xl font-medium mb-8">{t('title')}</h1>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed">
          <p><strong className="text-foreground">{t('lastUpdated')}</strong> {t('date')}</p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">1. Information We Collect</h2>
            <p>We collect information you provide when creating an account, deploying agents, and using our platform. This includes your name, email address, organization details, and usage data.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">2. How We Use Your Information</h2>
            <p>We use collected information to provide and improve our services, process transactions, communicate with you, and ensure platform security.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">3. Data Storage & Security</h2>
            <p>Your data is stored securely using industry-standard encryption. Agent conversations and configurations are isolated per tenant. We do not sell your data to third parties.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">4. Third-Party Services</h2>
            <p>We use Clerk for authentication, Anthropic for AI processing, and Stripe for payment processing. Each service has its own privacy policy governing their handling of your data.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-foreground">5. Contact</h2>
            <p>For privacy inquiries, contact your platform operator (self-hosted: configure SUPPORT_EMAIL in your deployment).</p>
          </section>
        </div>
      </div>
    </div>
  );
}
