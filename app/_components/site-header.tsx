'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { IconCalendar, IconClose, IconMenu } from './icons'

/**
 * The same header as francaisontips.com, so a buyer who followed a link here
 * does not feel they have left the site.
 *
 * Every nav item points back at the main site — this deployment is only the
 * shop and the reader, and duplicating those pages here would give the same
 * content two homes and two chances to go stale. The exceptions are Study
 * Material, which is what this domain *is*, and the sign-in, which is the only
 * thing this domain does that the other cannot.
 */

const MAIN_SITE = 'https://francaisontips.com'
const BOOK_DEMO = 'https://calendly.com/francaisontips/bookdemo'

type NavItem = {
  label: string
  href: string
  /**
   * Stays on this deployment. The main site's menu sends Study Material here,
   * so from this side that item is the page you are already on — it is drawn
   * as the current one on every route, exactly as the main site draws Home.
   */
  here?: true
  badge?: string
}

/** Mirrors the main site's menu, in its order. Anchors resolve on its home page. */
const NAV: readonly NavItem[] = [
  { label: 'Home', href: `${MAIN_SITE}/#home` },
  { label: 'About Me', href: `${MAIN_SITE}/#about` },
  { label: 'TEF Canada', href: `${MAIN_SITE}/#tef` },
  { label: 'Programs', href: `${MAIN_SITE}/explore.html` },
  { label: 'Study Material', href: '/', here: true, badge: 'New' },
  { label: 'Levels', href: `${MAIN_SITE}/#levels` },
  { label: 'Testimonials', href: `${MAIN_SITE}/#testimonials` },
  { label: 'Contact', href: `${MAIN_SITE}/contact.html` },
]

/**
 * Study Material is a route on this deployment, so it navigates client-side;
 * every other item is a full trip to the main site.
 */
function NavLink({
  item,
  className,
  onClick,
  children,
}: {
  item: NavItem
  className: string
  onClick?: () => void
  children: React.ReactNode
}) {
  const props = {
    className,
    onClick,
    'aria-current': item.here ? ('page' as const) : undefined,
  }

  return item.here ? (
    <Link href={item.href} {...props}>
      {children}
    </Link>
  ) : (
    <a href={item.href} {...props}>
      {children}
    </a>
  )
}

/**
 * The main site's badge, without its pulse. There it is a nudge towards a page
 * you have not visited; here you are standing on that page, so the animation
 * would be pointing at the floor.
 */
function NewBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-rouge px-1.5 py-0.5 text-[0.625rem] leading-[1.3] font-bold tracking-[0.06em] text-white uppercase">
      {label}
    </span>
  )
}

export function SiteHeader() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Offering "Sign in" to someone already on the sign-in page is noise.
  const showSignIn = pathname !== '/login'

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

        {/*
          Eight items, a wide call to action and a sign-in do not survive a
          1024px bar, so the full menu waits for xl and everything below it
          folds into the panel.
        */}
        <nav
          aria-label="Main"
          className="mx-auto hidden items-center gap-5 xl:flex 2xl:gap-7"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              className={`relative inline-flex items-center gap-1.5 py-1.5 text-[0.8125rem] whitespace-nowrap transition-colors duration-200 2xl:text-[0.9375rem] ${
                item.here
                  ? 'font-semibold text-rouge'
                  : 'font-medium text-ink hover:text-rouge'
              }`}
            >
              {item.label}
              {item.badge && <NewBadge label={item.badge} />}
              {item.here && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-rouge"
                />
              )}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0 xl:gap-3">
          {showSignIn && (
            <Link
              href="/login"
              className="rounded-lg border border-rule px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:border-ink sm:px-5"
            >
              Sign in
            </Link>
          )}

          {/* Phones get it in the panel instead — see below. */}
          <a
            href={BOOK_DEMO}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ink-deep sm:inline-flex"
          >
            <IconCalendar className="size-[1.125rem]" />
            Book a Free Demo Class
          </a>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="rounded-lg border border-rule p-2.5 text-ink transition-colors duration-200 hover:border-ink xl:hidden"
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
          className="border-t border-rule bg-card xl:hidden"
        >
          <ul className="mx-auto w-full max-w-7xl px-5 py-2 sm:px-8">
            {NAV.map((item) => (
              <li key={item.label} className="border-b border-rule/70 last:border-0">
                <NavLink
                  item={item}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 py-3.5 text-read transition-colors duration-200 ${
                    item.here
                      ? 'font-semibold text-rouge'
                      : 'font-medium text-ink hover:text-rouge'
                  }`}
                >
                  {item.label}
                  {item.badge && <NewBadge label={item.badge} />}
                </NavLink>
              </li>
            ))}
          </ul>

          <div className="mx-auto w-full max-w-7xl px-5 pb-5 sm:hidden">
            <a
              href={BOOK_DEMO}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
            >
              <IconCalendar className="size-[1.125rem]" />
              Book a Free Demo Class
            </a>
          </div>
        </nav>
      )}
    </header>
  )
}
