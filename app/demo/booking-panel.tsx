'use client'

import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCheck } from '@/app/_components/icons'

type Slot = { id: string; startsAt: string; seatsLeft: number }

type Booked = { when: string; meetUrl: string; email: string }

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => string
      reset: (id?: string) => void
    }
  }
}

const noSubscribe = () => () => {}

/**
 * The browser's own zone. Read through an external store rather than state so
 * the server render (which has no zone worth using — Vercel runs in UTC)
 * renders nothing time-shaped, and the client fills it in without a mismatch.
 */
function useBrowserTimeZone(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null,
  )
}

function allTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

export function BookingPanel({ slots, turnstileSiteKey }: { slots: Slot[]; turnstileSiteKey?: string }) {
  const router = useRouter()
  const browserZone = useBrowserTimeZone()
  const [chosenZone, setChosenZone] = useState<string | null>(null)
  const timeZone = chosenZone ?? browserZone

  const [selected, setSelected] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', levelNote: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [booked, setBooked] = useState<Booked | null>(null)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileBox = useRef<HTMLDivElement>(null)
  const turnstileId = useRef<string | undefined>(undefined)

  const formRef = useRef<HTMLFormElement>(null)

  const days = useMemo(() => {
    if (!timeZone) return []
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' })
    const groups = new Map<string, { label: string; slots: Slot[] }>()
    for (const slot of slots) {
      const at = new Date(slot.startsAt)
      const key = dayKey.format(at)
      if (!groups.has(key)) groups.set(key, { label: dayLabel.format(at), slots: [] })
      groups.get(key)!.slots.push(slot)
    }
    return [...groups.values()]
  }, [slots, timeZone])

  const timeOf = (iso: string) =>
    timeZone
      ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(
          new Date(iso),
        )
      : ''

  const selectedSlot = slots.find((s) => s.id === selected) ?? null
  const selectedLabel =
    selectedSlot && timeZone
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }).format(new Date(selectedSlot.startsAt))
      : null

  function choose(id: string) {
    setSelected(id)
    setError(null)
    // On a phone the form is below the list; take them to it.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !timeZone) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/demo/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: selected, ...form, timeZone, turnstileToken: turnstileToken ?? undefined }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error ?? 'Could not book that time. Please try again.')
        if (payload.refresh) {
          setSelected(null)
          router.refresh()
        }
        window.turnstile?.reset(turnstileId.current)
        setTurnstileToken(null)
        setBusy(false)
        return
      }
      setBooked({ when: payload.when, meetUrl: payload.meetUrl, email: form.email })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      setError('Could not reach the server. Check your connection.')
      setBusy(false)
    }
  }

  if (booked) {
    return (
      <div className="mx-auto max-w-2xl rounded-card border border-rule bg-card p-8 text-center shadow-card sm:p-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-ink text-white">
          <IconCheck className="size-7" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-bold text-ink">You&rsquo;re booked.</h2>
        <p className="mt-4 font-display text-lg font-semibold text-ink">{booked.when}</p>
        <p className="mx-auto mt-4 max-w-md text-read text-ink-soft">
          We&rsquo;ve emailed the details and a calendar invite to {booked.email}. Join with this link
          at the time above:
        </p>
        <a
          href={booked.meetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex rounded-lg bg-ink px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep"
        >
          Google Meet link
        </a>
        <p className="mt-3 text-sm break-all text-ink-soft">{booked.meetUrl}</p>
      </div>
    )
  }

  if (!timeZone) {
    // Server render and the first client frame: no zone yet, so no times.
    return <div className="mx-auto h-64 max-w-xl animate-pulse rounded-card border border-rule bg-card" />
  }

  const zones = allTimeZones()

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-10">
      <section aria-label="Available times" className="space-y-6">
        <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-soft">
          <span>Times shown in</span>
          <select
            value={timeZone}
            onChange={(e) => setChosenZone(e.target.value)}
            className="max-w-full rounded-lg border border-rule bg-card px-3 py-1.5 font-semibold text-ink"
          >
            {!zones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        {days.map((day) => (
          <div key={day.label} className="rounded-card border border-rule bg-card p-5 shadow-card sm:p-6">
            <h2 className="font-display text-lg font-bold text-ink">{day.label}</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {day.slots.map((slot) => {
                const full = slot.seatsLeft === 0
                const active = slot.id === selected
                return (
                  <li key={slot.id}>
                    <button
                      type="button"
                      disabled={full || busy}
                      onClick={() => choose(slot.id)}
                      aria-pressed={active}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-200 disabled:cursor-not-allowed ${
                        active
                          ? 'border-ink bg-ink text-white'
                          : full
                            ? 'border-rule bg-paper text-ink-soft/70'
                            : 'border-rule text-ink hover:border-ink'
                      }`}
                    >
                      <span className="block font-semibold">{timeOf(slot.startsAt)}</span>
                      <span className={`block text-xs ${active ? 'text-white/80' : full ? '' : 'text-ink-soft'}`}>
                        {full ? 'Full' : slot.seatsLeft === 1 ? '1 place left' : `${slot.seatsLeft} places left`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </section>

      <form
        ref={formRef}
        onSubmit={submit}
        className="scroll-mt-24 space-y-4 rounded-card border border-rule bg-card p-6 shadow-card sm:p-7 lg:sticky lg:top-24"
      >
        <h2 className="font-display text-lg font-bold text-ink">Your details</h2>
        <p className="text-sm text-ink-soft">
          {selectedLabel ? (
            <>
              Booking <span className="font-semibold text-ink">{selectedLabel}</span> (30 minutes)
            </>
          ) : (
            'Choose a time first.'
          )}
        </p>

        <Field label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} autoComplete="name" maxLength={80} />
        <Field label="Email" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} autoComplete="email" maxLength={160} />
        <Field
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
          autoComplete="tel"
          maxLength={20}
          hint="With country code, e.g. +91 or +33."
        />
        <label className="block">
          <span className="text-sm font-semibold text-ink">Your French level</span>
          <textarea
            value={form.levelNote}
            onChange={(e) => setForm({ ...form, levelNote: e.target.value })}
            required
            maxLength={500}
            rows={3}
            disabled={busy}
            placeholder="e.g. Around A2, preparing for TEF Canada in March."
            className="mt-1.5 w-full rounded-lg border border-rule bg-card px-3.5 py-2.5 text-read text-ink transition-colors duration-200 placeholder:text-ink-soft hover:border-ink/30 disabled:opacity-60"
          />
        </label>

        {turnstileSiteKey && (
          <>
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
              onReady={() => {
                if (!turnstileBox.current || !window.turnstile || turnstileId.current) return
                turnstileId.current = window.turnstile.render(turnstileBox.current, {
                  sitekey: turnstileSiteKey,
                  callback: setTurnstileToken,
                  'expired-callback': () => setTurnstileToken(null),
                })
              }}
            />
            <div ref={turnstileBox} />
          </>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-rouge/30 bg-rouge-wash px-3.5 py-3 text-sm text-rouge">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !selected || (Boolean(turnstileSiteKey) && !turnstileToken)}
          className="w-full rounded-lg bg-ink px-5 py-3.5 font-semibold text-white transition-colors duration-200 hover:bg-ink-deep disabled:opacity-50"
        >
          {busy ? 'Booking…' : 'Book my free class'}
        </button>
        <p className="text-center text-xs text-ink-soft">Free. No payment, no account.</p>
      </form>
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  onChange,
  ...input
}: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <input
        {...input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="mt-1.5 w-full rounded-lg border border-rule bg-card px-3.5 py-2.5 text-read text-ink transition-colors duration-200 placeholder:text-ink-soft hover:border-ink/30 disabled:opacity-60"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-soft">{hint}</span>}
    </label>
  )
}
