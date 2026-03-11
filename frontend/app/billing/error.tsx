'use client';

import { useEffect } from 'react';

export default function BillingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Billing error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="text-4xl mb-4">💳</div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Billing konnte nicht geladen werden
      </h2>
      <p className="text-sm text-neutral-500 dark:text-muted-foreground mb-6 text-center max-w-sm">
        {error.message || 'Beim Laden der Billing-Seite ist ein Fehler aufgetreten.'}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-black text-white dark:bg-foreground dark:text-foreground hover:opacity-80 transition-opacity"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
