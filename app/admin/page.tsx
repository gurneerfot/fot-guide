import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/demo/admin-auth'
import { googleConfigured } from '@/lib/demo/google'
import { listSlotsForAdmin } from '@/lib/demo/slots'
import { AdminSignOut } from './admin-controls'
import { SlotList, type ListedSlot } from './slot-list'
import { SlotPlanner } from './slot-planner'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Demo classes — Admin',
  robots: { index: false, follow: false },
}

type AdminSlot = Awaited<ReturnType<typeof listSlotsForAdmin>>['upcoming'][number]

/** Dates cross to the client as strings; only what the page shows goes over. */
function toListed(slot: AdminSlot): ListedSlot {
  return {
    id: slot.id,
    iso: slot.startsAt.toISOString(),
    capacity: slot.capacity,
    meetUrl: slot.meetUrl,
    bookings: slot.bookings.map((b) => ({
      id: b.id,
      name: b.name,
      email: b.email,
      phone: b.phone,
      timeZone: b.timeZone,
      levelNote: b.levelNote,
    })),
  }
}

export default async function AdminPage() {
  // Checked here, against the signing key — not in the proxy, which only ever
  // sees whether a cookie exists.
  if (!(await isAdmin())) redirect('/admin/login')

  const { upcoming, past } = await listSlotsForAdmin()
  const google = googleConfigured()

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold text-ink">Demo classes</h1>
        <AdminSignOut />
      </header>

      <section className="mb-10 rounded-card border border-rule bg-card p-6 shadow-card">
        <h2 className="font-display text-lg font-bold text-ink">Plan slots</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Pick days and half-hour slots, choose seats — every day × slot is created. Times are in
          your own time zone. Nothing goes on your calendar until someone books: then the class
          appears on yours and theirs, with a Google Meet link everyone in that slot shares.
        </p>
        {!google && (
          <p role="alert" className="mt-3 rounded-lg border border-rouge/30 bg-rouge-wash px-3.5 py-3 text-sm text-rouge">
            Google Calendar is not connected, so bookings will fail until it is. Set
            GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN, then redeploy.
          </p>
        )}
        <SlotPlanner
          existing={upcoming.map((s) => ({ iso: s.startsAt.toISOString(), booked: s.bookings.length, capacity: s.capacity }))}
        />
      </section>

      <SlotList title="Upcoming" slots={upcoming.map(toListed)} empty="No upcoming slots. Plan some above." />
      {past.length > 0 && <SlotList title="Last two weeks" slots={past.map(toListed)} empty="" past />}
    </main>
  )
}
