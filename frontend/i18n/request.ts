import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

// Supported locales
export const locales = ['en', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  // 1. Check cookie first
  let locale = cookieStore.get('locale')?.value;

  // 2. Fall back to Accept-Language header
  if (!locale || !locales.includes(locale as Locale)) {
    const acceptLang = headerStore.get('accept-language') || '';
    const preferred = acceptLang
      .split(',')
      .map((part) => part.split(';')[0].trim().substring(0, 2).toLowerCase())
      .find((lang) => locales.includes(lang as Locale));
    locale = preferred || defaultLocale;
  }

  // 3. Validate
  if (!locales.includes(locale as Locale)) {
    locale = defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
