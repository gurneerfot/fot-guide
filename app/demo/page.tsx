import type { Metadata } from 'next'
import { SiteHeader } from '@/app/_components/site-header'
import { listBookableSlots, type OpenSlot } from '@/lib/demo/slots'
import { BookingPanel } from './booking-panel'

export const dynamic = 'force-dynamic'

// TCF demos are booked through Calendly, not our own slots.
const TCF_CALENDLY_URL = 'https://calendly.com/francaisontips/bookdemo'

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

        <nav aria-label="Demo type" className="mb-12 flex flex-wrap justify-center gap-3 sm:mb-16">
          <a
            href="#tef"
            className="rounded-lg border border-rule bg-card px-5 py-2.5 font-semibold text-ink transition-colors duration-200 hover:border-ink/30"
          >
            TEF demo booking
          </a>
          <a
            href="#tcf"
            className="rounded-lg border border-rule bg-card px-5 py-2.5 font-semibold text-ink transition-colors duration-200 hover:border-ink/30"
          >
            TCF demo booking
          </a>
        </nav>

        <section id="tef" aria-labelledby="tef-heading" className="scroll-mt-24">
          <SectionHeading id="tef-heading">TEF demo booking</SectionHeading>
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
        </section>

        <section id="tcf" aria-labelledby="tcf-heading" className="mt-16 scroll-mt-24 sm:mt-24">
          <SectionHeading id="tcf-heading">TCF demo booking</SectionHeading>
          <div className="mx-auto max-w-xl rounded-card border border-rule bg-card p-8 text-center shadow-card sm:p-10">
            <p className="text-read text-ink-soft">
              Preparing for TCF Canada? Pick a time for your free TCF demo class on our Calendly page.
            </p>
            <a
              href={TCF_CALENDLY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex rounded-lg bg-ink px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
            >
              Book a TCF demo on Calendly
            </a>
          </div>
        </section>
      </main>
    </>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-8 text-center font-display text-2xl font-bold text-ink sm:text-3xl">
      {children}
    </h2>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-card border border-rule bg-card p-10 text-center shadow-card">
      <p className="text-read text-ink-soft">{children}</p>
    </div>
  )
}
