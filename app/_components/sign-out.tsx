'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function SignOut() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.refresh()
        router.replace('/login')
      }}
      className="text-sm font-semibold text-ink-soft underline underline-offset-2 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
