import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// Phase 1 §1.2: the application must never be indexed. This is belt-and-braces
// alongside the X-Robots-Tag header set in middleware.
export const metadata: Metadata = {
  title: 'Operations platform',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Milestone 4 replaces this with locale-aware routing that sets lang and dir
// from the URL segment (Phase 1 §12). Until then the shell is English LTR.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
