'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function AdminLoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error ?? 'Wrong password.')
        setBusy(false)
        return
      }
      router.refresh()
      router.replace('/admin')
    } catch {
      setError('Could not reach the server. Check your connection.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-semibold">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          disabled={busy}
          className="mt-1.5 w-full rounded border border-rule bg-card px-4 py-3 disabled:opacity-60"
        />
      </label>
      {error && (
        <p role="alert" className="rounded border border-rouge bg-rouge-wash px-3 py-2.5 text-sm text-rouge">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || password.length === 0}
        className="w-full rounded bg-ink px-5 py-3.5 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
