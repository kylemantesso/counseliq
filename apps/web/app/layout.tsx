import type { Metadata } from 'next';
import { Providers } from './providers';
import '@counseliq/ui/global.css';

export const metadata: Metadata = {
  title: 'YourApp | Discover Something New',
  description: 'Built for what matters to you. Sign up to get started with your journey.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body
        className="font-sans flex min-h-full flex-1 flex-col"
        style={{ backgroundColor: '#f7f7f5' }}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
