'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-card px-4">
      <div className="text-center max-w-md">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          {t('title')}
        </h2>
        <p className="text-sm text-neutral-500 dark:text-muted-foreground mb-6">
          {error.message || t('defaultMessage')}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-black text-white dark:bg-foreground dark:text-foreground hover:opacity-80 transition-opacity"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
