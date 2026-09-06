import '@nivik/ui/tokens.css';
import '@nivik/ui/styles.css';
import './globals.css';

import { ToastProvider } from '@nivik/ui';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { StoreHydrator } from '@/components/store-hydrator';

const inter = localFont({
  src: './fonts/inter-variable.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Nivik',
    template: '%s · Nivik',
  },
  description: 'AI-native diagramming — describe it, get a clear picture.',
  icons: { icon: '/brand/nivik-logo.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#faf9fb',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <ToastProvider>
          <StoreHydrator />
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
