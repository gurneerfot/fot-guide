'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { IconClose, IconMenu } from './icons'

/**
 * The same header as francaisontips.com, so a buyer who followed a link here
 * does not feel they have left the site.
 *
 * Every nav item points back at the main site — this deployment is only the
 * shop and the reader, and duplicating those pages here would give the same
 * content two homes and two chances to go stale. The one link that stays local
 * is the sign-in, which is the only thing this domain does that the other
 * cannot.
 */

const MAIN_SITE = 'https://francaisontips.com'

/** Mirrors the main site's menu, in its order. Anchors resolve on its home page. */
const NAV = [
  { label: 'Home', href: `${MAIN_SITE}/#home` },
  { label: 'About Me', href: `${MAIN_SITE}/#about` },
  { label: 'TEF Canada', href: `${MAIN_SITE}/#tef` },
  { label: 'Programs', href: `${MAIN_SITE}/explore.html` },
  { label: 'Levels', href: `${MAIN_SITE}/#levels` },
  { label: 'Testimonials', href: `${MAIN_SITE}/#testimonials` },
  { label: 'Contact', href: `${MAIN_SITE}/contact.html` },
] as const

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Offering "Sign in" to someone already on the sign-in page is noise. The
  // store is the useful destination from there.
  const action =
    pathname === '/login'
      ? { href: '/', label: 'Study material' }
      : { href: '/login', label: 'Sign in' }

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex h-[4.5rem] w-full max-w-7xl items-center gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="shrink-0"
          aria-label="Français on Tips — study material"
          onClick={() => setOpen(false)}
        >
          <Image
            src="/logo.png"
            alt="Français on Tips"
            width={400}
            height={366}
            // Sized by height so the circular mark sits to the bar rather than
            // to a text baseline.
            className="h-11 w-auto sm:h-12"
            priority
          />
        </Link>

        <nav aria-label="Main" className="mx-auto hidden items-center gap-8 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-[0.9375rem] font-medium text-ink transition-colors duration-200 hover:text-rouge"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          <Link
            href={action.href}
            className="rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ink-deep sm:px-6"
          >
            {action.label}
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="rounded-lg border border-rule p-2.5 text-ink transition-colors duration-200 hover:border-ink lg:hidden"
          >
            {open ? <IconClose className="size-5" /> : <IconMenu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Rendered only when open, so its links stay out of the tab order. */}
      {open && (
        <nav
          id="site-menu"
          aria-label="Main, mobile"
          className="border-t border-rule bg-card lg:hidden"
        >
          <ul className="mx-auto w-full max-w-7xl px-5 py-2 sm:px-8">
            {NAV.map((item) => (
              <li key={item.label} className="border-b border-rule/70 last:border-0">
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block py-3.5 text-read font-medium text-ink transition-colors duration-200 hover:text-rouge"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  )
}
