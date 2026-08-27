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
  metadataBase: new URL('http://localhost:3000'),
  title: 'Journey — API workspace',
  description:
    'Build, run, diagnose, and repair executable API journeys with your agent.',
  openGraph: {
    title: 'Journey',
    description: 'Build, test, and repair APIs with your agent.',
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Journey',
    description: 'Build, test, and repair APIs with your agent.',
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
