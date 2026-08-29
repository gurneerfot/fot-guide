import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Poppins } from 'next/font/google'
import './globals.css'

/** Standing in for licensed Gilroy, exactly as on the mock-test platform. */
const display = Poppins({
  variable: '--font-display-face',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  display: 'swap',
})

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

/** Access codes and page numbers only — a code whose glyphs shift width is
 *  harder to read back off a screen. */
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Study Material — Français on Tips',
  description: 'French study material for TEF Canada, read online.',
  // The storefront is worth indexing; nothing behind the login is. Per-page
  // metadata turns this off again for the reader.
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#f8f5f0',
  // Buyers zoom into scanned pages. Never block that.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${manrope.variable} ${geistMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  )
}
