'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** A JSON call to an admin route. Null on success, otherwise the message to show. */
export async function call(url: string, method: string, body: unknown): Promise<string | null> {
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

/** Only ever passed slots with no bookings; the server re-checks each one anyway. */
export function RemoveDaySlotsButton({ ids, day }: { ids: string[]; day: string }) {
  return (
    <ConfirmButton
      label={`Remove ${ids.length} empty slots`}
      confirmText={`Remove all ${ids.length} empty slots on ${day}? Booked slots are kept.`}
      run={async () => {
        const failures: string[] = []
        for (const id of ids) {
          const failure = await call('/api/admin/slots', 'DELETE', { id })
          if (failure) failures.push(failure)
        }
        return failures.length ? `${failures.length} could not be removed: ${failures[0]}` : null
      }}
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
