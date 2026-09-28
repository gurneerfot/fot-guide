import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { adminConfigured, isAdmin } from '@/lib/demo/admin-auth'
import { AdminLoginForm } from './admin-login-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Admin — Français on Tips',
  robots: { index: false, follow: false },
}

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect('/admin')

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
      <h1 className="mb-8 text-center font-display text-2xl font-medium">Admin</h1>
      {adminConfigured() ? (
        <AdminLoginForm />
      ) : (
        <p className="rounded border border-rule bg-card px-4 py-3 text-sm text-ink-soft">
          Admin login is not configured. Set ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET.
        </p>
      )}
    </main>
  )
}
