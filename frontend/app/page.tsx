'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useOrganizationList } from '@clerk/nextjs';
import { apiClient } from '@/lib/api-client';
import HeroSection from '@/components/hero-section-2';
import LogoCloud from '@/components/logo-cloud-2';
import Features from '@/components/features-2';
import Integrations from '@/components/integrations-1';
import ContentSection from '@/components/content-3';
import Stats from '@/components/stats-3';
import Testimonials from '@/components/testimonials-1';
import Pricing from '@/components/pricing-1';
import Comparator from '@/components/comparator-1';
import FAQs from '@/components/faqs-3';
import CallToAction from '@/components/call-to-action-4';
import Footer from '@/components/footer-1';
import { ScrollProgress } from '@/components/scroll-progress';

export default function LandingPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const { isLoaded: orgLoaded, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  useEffect(() => {
    if (isLoaded && isSignedIn && orgLoaded) {
      checkOnboardingStatus();
    }
  }, [isLoaded, isSignedIn, orgLoaded]);

  const checkOnboardingStatus = async () => {
    try {
      const hasOrganization = userMemberships && userMemberships.data && userMemberships.data.length > 0;
      if (!hasOrganization) { router.push('/onboarding'); return; }
      const token = await getToken();
      if (!token) return;
      const data = await apiClient.getProviders(token).catch(() => null);
      const hasProviders = data && data.providers && data.providers.length > 0;
      router.push(hasProviders ? '/dashboard' : '/onboarding');
    } catch {
      router.push('/dashboard');
    }
  };

  return (
    <div className="bg-white text-black">
      <ScrollProgress />
      <HeroSection />
      <LogoCloud />
      <Features />
      <ContentSection />
      <Integrations />
      <Stats />
      <Testimonials />
      <Pricing />
      <Comparator />
      <FAQs />
      <CallToAction />
      <Footer />
    </div>
  );
}
