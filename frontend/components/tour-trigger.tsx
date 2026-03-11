'use client';

import { useEffect, useRef } from 'react';
import { useNextStep } from 'nextstepjs';
import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';

export function TourTrigger() {
  const { startNextStep } = useNextStep();
  const { user, isLoaded } = useUser();
  const pathname = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (!isLoaded || !user || pathname !== '/dashboard' || started.current) return;
    if ((user.unsafeMetadata as any)?.tourDone) return;

    started.current = true;
    const t = setTimeout(() => {
      startNextStep('onboarding');
      user.update({ unsafeMetadata: { ...user.unsafeMetadata, tourDone: true } });
    }, 800);
    return () => clearTimeout(t);
  }, [isLoaded, user, pathname, startNextStep]);

  return null;
}
