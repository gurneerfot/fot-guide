'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PageMeta } from '@/lib/entitlement'

/**
 * Continuous vertical scroll rather than a page-turn control. This is study
 * material people read for an hour at a stretch, mostly on a phone, and a
 * next/previous button turns that into several hundred taps.
 */
export function Reader({
  slug,
  title,
  pages,
  viewerName,
}: {
  slug: string
  title: string
  pages: PageMeta[]
  viewerName: string
}) {
  const [current, setCurrent] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Tracks which page is under the middle of the viewport so the counter
  // reflects what is actually being read, not what happens to be topmost.
  useEffect(() => {
    const nodes = containerRef.current?.querySelectorAll('[data-page]')
    if (!nodes?.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) {
          setCurrent(Number((visible.target as HTMLElement).dataset.page))
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [pages.length])

  /**
   * Casual-copy friction only. Ctrl+P, Ctrl+S and right-click are the three
   * routes someone takes without thinking about it; none of this stops a
   * screenshot, which no web page can. The burnt-in watermark is what actually
   * carries the deterrent.
   */
  const blockShortcuts = useCallback((event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && (key === 'p' || key === 's')) {
      event.preventDefault()
    }
  }, [])

  useEffect(() => {
    const blockMenu = (event: MouseEvent) => event.preventDefault()
    window.addEventListener('keydown', blockShortcuts)
    window.addEventListener('contextmenu', blockMenu)
    return () => {
      window.removeEventListener('keydown', blockShortcuts)
      window.removeEventListener('contextmenu', blockMenu)
    }
  }, [blockShortcuts])

  if (pages.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-20 text-center">
        <h1 className="font-display text-xl font-medium">{title}</h1>
        <p className="mt-3 text-read text-ink-soft">
          This material is being prepared and will appear here shortly.
        </p>
        <Link
          href="/library"
          className="mt-6 inline-block font-semibold text-ink underline underline-offset-2"
        >
          Back to your material
        </Link>
      </main>
    )
  }

  return (
    <>
      <div className="reader-shell flex min-h-full flex-col">
        <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
            <Link
              href="/library"
              className="shrink-0 text-sm font-semibold text-ink-soft underline underline-offset-2"
            >
              &larr; Library
            </Link>
            <h1 className="truncate font-display text-sm font-medium sm:text-base">{title}</h1>
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
              {current} / {pages.length}
            </span>
          </div>
        </header>

        <main ref={containerRef} className="mx-auto w-full max-w-3xl flex-1 px-3 py-6">
          <div className="space-y-4">
            {pages.map((page) => (
              <figure
                key={page.pageNumber}
                data-page={page.pageNumber}
                className="reader-page overflow-hidden rounded border border-rule bg-card"
              >
                {/* eslint-disable-next-line @next/next/no-img-element --
                    next/image would proxy these through the optimiser, which
                    caches by URL and would serve one buyer's watermarked page
                    to another. These must stay one-request-per-viewer. */}
                <img
                  src={`/api/page/${encodeURIComponent(slug)}/${page.pageNumber}`}
                  alt={`Page ${page.pageNumber}`}
                  width={page.width}
                  height={page.height}
                  // Reserves the right box before the bytes arrive, so scrolling
                  // ahead does not yank the page out from under the reader.
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                  className="block h-auto w-full"
                  loading={page.pageNumber <= 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                />
              </figure>
            ))}
          </div>

          <p className="py-10 text-center text-sm text-ink-soft">
            End of {title} — {pages.length} pages.
          </p>
        </main>

        <footer className="border-t border-rule px-4 py-4 text-center">
          <p className="text-xs text-ink-soft">
            Licensed to {viewerName}. For your personal study only — please
            don&rsquo;t share or redistribute.
          </p>
        </footer>
      </div>

      {/* Print produces this instead of the material. `display:none` here is
          flipped by the print media query in globals.css. */}
      <div className="reader-print-notice hidden p-10 text-center">
        <p style={{ fontSize: 18 }}>
          This study material is licensed to {viewerName} for personal use and is
          not available to print.
        </p>
      </div>
    </>
  )
}
