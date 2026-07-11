import type { Metadata } from 'next';
import { Providers } from './providers';
import '@counseliq/ui/global.css';

export const metadata: Metadata = {
  title: 'CounselIQ Client',
  description: 'Client app for CounselIQ learners.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Card/player brand fonts. Loaded as a stylesheet (not next/font)
            because the @counseliq/cards theme tokens reference the literal
            family names — next/font's hashed font-family would never match,
            and literal names keep the tokens portable to Remotion (M6). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400..700&family=Source+Sans+3:wght@400..700&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400..700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
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
