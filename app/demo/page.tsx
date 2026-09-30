import type { Metadata } from 'next'
import { SiteHeader } from '@/app/_components/site-header'
import { listBookableSlots, type OpenSlot } from '@/lib/demo/slots'
import { BookingPanel } from './booking-panel'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Book a Free Demo Class — Français on Tips',
  description: 'Pick a 30-minute slot for a free French demo class on Google Meet.',
}

export default async function DemoPage() {
  // A failure here — the tables not migrated yet, the database unreachable —
  // closes this page and nothing else. The shop and the reader never import it.
  let slots: OpenSlot[] | null
  try {
    slots = await listBookableSlots()
  } catch (error) {
    console.error('[demo] could not load slots', error)
    slots = null
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
          <h1 className="font-display text-[2rem] leading-[1.15] font-bold tracking-tight text-ink sm:text-5xl">
            Book a Free Demo Class
          </h1>
          <span aria-hidden className="mx-auto mt-6 block h-[3px] w-16 rounded-full bg-rouge" />
          <p className="mx-auto mt-7 max-w-xl text-read text-ink-soft">
            Thirty minutes on Google Meet to see how we teach and where your
            French stands. Classes are small, so you may share yours with a
            few other learners.
          </p>
        </header>

        {slots === null ? (
          <Notice>Booking is not available right now. Please try again a little later.</Notice>
        ) : slots.length === 0 ? (
          <Notice>No demo classes are open right now. New times are added regularly — please check back soon.</Notice>
        ) : (
          <BookingPanel
            slots={slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), seatsLeft: s.seatsLeft }))}
            turnstileSiteKey={
              process.env.TURNSTILE_SECRET_KEY ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY : undefined
            }
          />
        )}
      </main>
    </>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-card border border-rule bg-card p-10 text-center shadow-card">
      <p className="text-read text-ink-soft">{children}</p>
    </div>
  )
}
