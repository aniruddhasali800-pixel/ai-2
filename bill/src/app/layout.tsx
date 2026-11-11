import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sizzle Pay',
  description: 'Direct UPI collection and payment verification for Saffron & Smoke.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
