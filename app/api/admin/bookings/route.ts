import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdmin } from '@/lib/demo/admin-auth'
import { deleteBooking } from '@/lib/demo/slots'

export const runtime = 'nodejs'

const remove = z.object({ id: z.uuid() })

/** Frees a seat. Sends nothing — the owner tells the person themselves. */
export async function DELETE(request: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Signed out.' }, { status: 401 })

  const parsed = remove.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Unknown booking.' }, { status: 400 })

  return (await deleteBooking(parsed.data.id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'That booking no longer exists.' }, { status: 404 })
}
