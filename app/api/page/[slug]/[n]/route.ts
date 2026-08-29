import { NextResponse } from 'next/server'
import { db, pageViews } from '@/db'
import { clientIp } from '@/lib/auth/rate-limit'
import { readSession } from '@/lib/auth/session'
import { readPageImage } from '@/lib/content'
import { hasAccess, productBySlug } from '@/lib/entitlement'
import { watermarkPage } from '@/lib/watermark'

export const runtime = 'nodejs'
// Every response is watermarked for one named buyer, so nothing here may be
// prerendered or shared between requests.
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; n: string }> },
) {
  const { slug, n } = await context.params

  const session = await readSession()
  if (!session) return new NextResponse('Not signed in', { status: 401 })

  const pageNumber = Number(n)
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return new NextResponse('Bad page number', { status: 400 })
  }

  const product = await productBySlug(slug)
  if (!product) return new NextResponse('Not found', { status: 404 })

  // 404 rather than 403 for a page they have not bought: a distinct "forbidden"
  // confirms the material exists at that slug, which is information a probe
  // does not need.
  if (!(await hasAccess(session.userId, product.id))) {
    return new NextResponse('Not found', { status: 404 })
  }

  const source = await readPageImage(product.id, pageNumber)
  if (!source) return new NextResponse('Not found', { status: 404 })

  const image = await watermarkPage(source, { name: session.name, email: session.email })

  // Recorded so a code being read from many places at once is visible later.
  // Never allowed to fail the read — a logging problem must not look to the
  // buyer like the page is broken.
  db.insert(pageViews)
    .values({
      userId: session.userId,
      productId: product.id,
      pageNumber,
      ip: clientIp(request),
    })
    .catch((error) => console.error('[page] view log failed', error))

  return new NextResponse(new Uint8Array(image), {
    headers: {
      'content-type': 'image/webp',
      // `private` is load-bearing: a shared cache must never hand one buyer's
      // watermarked page to another. Their own browser may keep it, so paging
      // back does not re-composite.
      'cache-control': 'private, max-age=600, must-revalidate',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow, noimageindex',
    },
  })
}
