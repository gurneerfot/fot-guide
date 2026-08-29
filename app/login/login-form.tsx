'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error ?? 'That code was not recognised.')
        setBusy(false)
        return
      }
      // `refresh` first so the server components re-read the new session cookie
      // before the destination renders.
      router.refresh()
      router.replace(next?.startsWith('/') ? next : '/library')
    } catch {
      setError('Could not reach the server. Check your connection.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-semibold">Access code</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          maxLength={64}
          placeholder="FOT-7K2M-4QX9"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={busy}
          className="mt-1.5 w-full rounded border border-rule bg-card px-4 py-3 text-center font-mono text-lg tracking-[0.12em] uppercase placeholder:text-ink-soft/50 disabled:opacity-60"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded border border-rouge bg-rouge-wash px-3 py-2.5 text-sm text-rouge"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || code.trim().length === 0}
        className="w-full rounded bg-ink px-5 py-3.5 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-center text-xs text-ink-soft">
        Dashes and spaces don&rsquo;t matter — type it however it appears.
      </p>
    </form>
  )
}
