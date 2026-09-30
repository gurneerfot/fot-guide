'use client'

import { useSyncExternalStore } from 'react'
import { RemoveBookingButton, RemoveSlotButton, RemoveDaySlotsButton } from './admin-controls'

export type ListedSlot = {
  id: string
  iso: string
  capacity: number
  meetUrl: string
  bookings: {
    id: string
    name: string
    email: string
    phone: string
    timeZone: string
    levelNote: string
  }[]
}

const noSubscribe = () => () => {}
const isClient = () => true

/**
 * Grouped by day in the owner's browser zone, so it has to render on the
 * client — the server is in UTC and would put a 1 am IST slot on the wrong day.
 */
export function SlotList({ title, slots, empty, past }: { title: string; slots: ListedSlot[]; empty: string; past?: boolean }) {
  const ready = useSyncExternalStore(noSubscribe, isClient, () => false)

  if (!ready) {
    return (
      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        <div className="h-24 animate-pulse rounded-card bg-card" />
      </section>
    )
  }

  const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeLabel = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })

  const days = new Map<string, ListedSlot[]>()
  for (const slot of slots) {
    const key = dayLabel.format(new Date(slot.iso))
    days.set(key, [...(days.get(key) ?? []), slot])
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
      {slots.length === 0 ? (
        <p className="text-sm text-ink-soft">{empty}</p>
      ) : (
        <div className="space-y-3">
          {[...days].map(([day, daySlots]) => {
            const booked = daySlots.reduce((n, s) => n + s.bookings.length, 0)
            const seats = daySlots.reduce((n, s) => n + s.capacity, 0)
            const emptyIds = daySlots.filter((s) => s.bookings.length === 0).map((s) => s.id)
            return (
              <details key={day} open={booked > 0} className="group rounded-card border border-rule bg-card shadow-card">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-4">
                  <span className="font-semibold text-ink">
                    <span className="mr-2 inline-block text-ink-soft transition-transform group-open:rotate-90">›</span>
                    {day}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {daySlots.length} slot{daySlots.length === 1 ? '' : 's'} · {booked} of {seats} seats booked
                  </span>
                </summary>

                <ul className="divide-y divide-rule border-t border-rule">
                  {daySlots.map((slot) => (
                    <li key={slot.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm">
                          <span className="font-semibold text-ink">{timeLabel.format(new Date(slot.iso))}</span>
                          <span className="text-ink-soft">
                            {' '}· {slot.bookings.length} of {slot.capacity} booked ·{' '}
                            <a href={slot.meetUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                              Meet link
                            </a>
                          </span>
                        </p>
                        {!past && slot.bookings.length === 0 && <RemoveSlotButton id={slot.id} />}
                      </div>

                      {slot.bookings.length > 0 && (
                        <ul className="mt-3 space-y-3">
                          {slot.bookings.map((b) => (
                            <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-paper px-4 py-3 text-sm">
                              <div className="min-w-0">
                                <p className="font-semibold text-ink">{b.name}</p>
                                <p className="break-all text-ink-soft">
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

                {!past && emptyIds.length > 1 && (
                  <div className="border-t border-rule px-5 py-3 text-right">
                    <RemoveDaySlotsButton ids={emptyIds} day={day} />
                  </div>
                )}
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
