import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://journey-api-workspace.zaidulhassan.chatgpt.site'),
  title: 'Runwire — Agent-native API workflows',
  description:
    'Wire, run, inspect, and repair executable API flows with your agent.',
  openGraph: {
    title: 'Runwire',
    description: 'Wire it. Run it. Repair it. API workflows for people and agents.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Runwire',
    description: 'Wire it. Run it. Repair it. API workflows for people and agents.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
