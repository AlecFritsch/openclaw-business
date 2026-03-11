'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchLocale(newLocale: string) {
    document.cookie = `locale=${newLocale};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  const nextLocale = locale === 'en' ? 'de' : 'en';

  return (
    <button
      onClick={() => switchLocale(nextLocale)}
      disabled={isPending}
      className="w-8 h-8 border border-border hover:border-foreground rounded-lg transition-all flex items-center justify-center font-mono uppercase text-xs tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
      title={locale === 'en' ? 'Auf Deutsch wechseln' : 'Switch to English'}
    >
      {isPending ? '...' : nextLocale}
    </button>
  );
}
