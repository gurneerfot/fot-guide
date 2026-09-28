import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/demo/admin-auth'
import { googleConfigured } from '@/lib/demo/google'
import { listSlotsForAdmin } from '@/lib/demo/slots'
import { AddSlotForm, AdminSignOut, RemoveBookingButton, RemoveSlotButton, LocalTime } from './admin-controls'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Demo classes — Admin',
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  // Checked here, against the signing key — not in the proxy, which only ever
  // sees whether a cookie exists.
  if (!(await isAdmin())) redirect('/admin/login')

  const { upcoming, past } = await listSlotsForAdmin()

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-ink">Demo classes</h1>
        <AdminSignOut />
      </header>

      <section className="mb-10 rounded-card border border-rule bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold text-ink">Add a 30-minute slot</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Enter the time in your own time zone.{' '}
          {googleConfigured()
            ? 'A Google Meet link is created automatically.'
            : 'Google Calendar is not connected, so paste a Meet link for each slot.'}
        </p>
        <AddSlotForm googleConnected={googleConfigured()} />
      </section>

      <SlotList title="Upcoming" slots={upcoming} empty="No upcoming slots. Add one above." />
      {past.length > 0 && <SlotList title="Last two weeks" slots={past} empty="" past />}
    </main>
  )
}

type AdminSlot = Awaited<ReturnType<typeof listSlotsForAdmin>>['upcoming'][number]

function SlotList({ title, slots, empty, past }: { title: string; slots: AdminSlot[]; empty: string; past?: boolean }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
      {slots.length === 0 ? (
        <p className="text-sm text-ink-soft">{empty}</p>
      ) : (
        <ul className="space-y-4">
          {slots.map((slot) => (
            <li key={slot.id} className="rounded-card border border-rule bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    <LocalTime iso={slot.startsAt.toISOString()} />
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {slot.bookings.length} of 2 booked ·{' '}
                    <a href={slot.meetUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      Meet link
                    </a>
                  </p>
                </div>
                {!past && slot.bookings.length === 0 && <RemoveSlotButton id={slot.id} />}
              </div>

              {slot.bookings.length > 0 && (
                <ul className="mt-4 space-y-3 border-t border-rule pt-4">
                  {slot.bookings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{b.name}</p>
                        <p className="text-ink-soft">
                          <a href={`mailto:${b.email}`} className="underline underline-offset-2">{b.email}</a> ·{' '}
                          <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`} className="underline underline-offset-2">{b.phone}</a> ·{' '}
                          {b.timeZone}
                        </p>
                        <p className="mt-1 whitespace-pre-line text-ink">{b.levelNote}</p>
                      </div>
                      {!past && <RemoveBookingButton id={b.id} name={b.name} />}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
