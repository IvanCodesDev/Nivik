import '@nivik/ui/tokens.css';
import '@nivik/ui/styles.css';
import './globals.css';

import { ToastProvider } from '@nivik/ui';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { StoreHydrator } from '@/components/store-hydrator';
import { ThemeApplier } from '@/components/theme-applier';
import { I18nProvider } from '@/lib/i18n/provider';
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server';
import { getRequestTheme } from '@/lib/theme/server';
import { themeColorFor } from '@/lib/theme/themes';

const inter = localFont({
  src: './fonts/inter-variable.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getRequestDictionary();
  return {
    title: {
      default: 'Nivik',
      template: '%s · Nivik',
    },
    description: t.meta.description,
    icons: { icon: '/brand/nivik-logo.png' },
  };
}

export async function generateViewport(): Promise<Viewport> {
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: themeColorFor(await getRequestTheme()),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, theme] = await Promise.all([getRequestLocale(), getRequestTheme()]);
  return (
    <html lang={locale} className={inter.variable} data-theme={theme}>
      <body>
        <ToastProvider>
          <StoreHydrator />
          <ThemeApplier />
          <I18nProvider initialLocale={locale}>{children}</I18nProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
