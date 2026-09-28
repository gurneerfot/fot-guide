'use client'

import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/** In the owner's browser zone. Rendered client-side because the server is in UTC. */
export function LocalTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }).format(new Date(iso)),
    () => null,
  )
  return <time dateTime={iso}>{text ?? '…'}</time>
}

async function call(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    // The caller refreshes after every call, and a refreshed /admin with no
    // session redirects itself to the login page.
    if (response.status === 401) return 'Signed out — please sign in again.'
    if (!response.ok) return ((await response.json().catch(() => null))?.error as string) ?? 'Something went wrong.'
    return null
  } catch {
    return 'Could not reach the server.'
  }
}

export function AddSlotForm({ googleConnected }: { googleConnected: boolean }) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [meetUrl, setMeetUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setAdded(null)
    // `new Date('YYYY-MM-DDTHH:MM')` is read in the browser's own zone — the
    // owner's — and toISOString turns it into the instant the server stores.
    const local = new Date(`${date}T${time}`)
    if (Number.isNaN(local.getTime())) {
      setError('Pick a date and time.')
      setBusy(false)
      return
    }
    const failure = await call('/api/admin/slots', 'POST', { startsAt: local.toISOString(), meetUrl })
    setBusy(false)
    if (failure) {
      setError(failure)
      router.refresh()
      return
    }
    // Keep the date: adding several times on one day is the common case.
    setAdded(`${date} ${time}`)
    setTime('')
    setMeetUrl('')
    router.refresh()
  }

  const input =
    'mt-1.5 w-full rounded-lg border border-rule bg-card px-3.5 py-2.5 text-ink disabled:opacity-60'

  return (
    <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="block">
        <span className="text-sm font-semibold text-ink">Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={busy} className={input} />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-ink">Start time</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required disabled={busy} step={300} className={input} />
      </label>
      <button
        type="submit"
        disabled={busy || !date || !time || (!googleConnected && !meetUrl)}
        className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-white hover:bg-ink-deep disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add slot'}
      </button>
      <label className="block sm:col-span-3">
        <span className="text-sm font-semibold text-ink">
          Meet link {googleConnected ? '(optional — leave empty to create one)' : ''}
        </span>
        <input
          type="url"
          value={meetUrl}
          onChange={(e) => setMeetUrl(e.target.value)}
          required={!googleConnected}
          disabled={busy}
          placeholder="https://meet.google.com/abc-defg-hij"
          className={input}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-rouge/30 bg-rouge-wash px-3.5 py-3 text-sm text-rouge sm:col-span-3">
          {error}
        </p>
      )}
      {added && <p className="text-sm text-ink-soft sm:col-span-3">Added {added}.</p>}
    </form>
  )
}

function ConfirmButton({
  label,
  confirmText,
  run,
}: {
  label: string
  confirmText: string
  run: () => Promise<string | null>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(confirmText)) return
        setBusy(true)
        const failure = await run()
        setBusy(false)
        if (failure) window.alert(failure)
        router.refresh()
      }}
      className="shrink-0 rounded-lg border border-rule px-3 py-1.5 text-sm font-semibold text-ink-soft hover:border-rouge hover:text-rouge disabled:opacity-50"
    >
      {busy ? '…' : label}
    </button>
  )
}

export function RemoveSlotButton({ id }: { id: string }) {
  return (
    <ConfirmButton
      label="Remove slot"
      confirmText="Remove this empty slot?"
      run={() => call('/api/admin/slots', 'DELETE', { id })}
    />
  )
}

export function RemoveBookingButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmButton
      label="Remove"
      confirmText={`Remove ${name}'s booking? Their seat opens up again. They are not emailed — tell them yourself.`}
      run={() => call('/api/admin/bookings', 'DELETE', { id })}
    />
  )
}

export function AdminSignOut() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/admin/logout', { method: 'POST' })
        router.refresh()
        router.replace('/admin/login')
      }}
      className="text-sm font-semibold text-ink-soft underline underline-offset-2"
    >
      Sign out
    </button>
  )
}
