import './globals.css';
import { siteUrl } from '../lib/http';

export const metadata = {
  metadataBase: new URL(siteUrl()),
  title: 'Core Share',
  description: 'A research prototype for sharing the part of a video that matters.',
  robots: { index: false, follow: false },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
