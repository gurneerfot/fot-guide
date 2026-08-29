import { markPaid, provisionPayment, type ProvisionResult } from '@/lib/provision'
import { sendOrderConfirmation } from '@/lib/email'

/**
 * The one path from "Razorpay says this was paid" to the buyer being looked
 * after — an access code for material hosted here, a WhatsApp link for a mock
 * test or a lesson plan, and both at once when the basket held both.
 *
 * Called by both the webhook and the browser confirm. Whichever arrives first
 * does the work; the second is told it was already settled and sends nothing,
 * so nobody receives two codes or two confirmations for one order.
 */
export async function settlePayment(input: {
  razorpayOrderId: string
  razorpayPaymentId: string
  baseUrl: string
}): Promise<ProvisionResult> {
  await markPaid(input.razorpayOrderId, input.razorpayPaymentId)
  const result = await provisionPayment(input.razorpayOrderId)
  if (result.status !== 'settled') return result

  // Best-effort by design — a send must not fail a settled payment. The success
  // screen carries the same code and the same WhatsApp link, so a bounce costs
  // the buyer convenience rather than access.
  await sendOrderConfirmation({
    to: result.email,
    name: result.name,
    code: result.code,
    readerTitles: result.readerTitles,
    serviceTitles: result.serviceTitles,
    readUrl: `${input.baseUrl}/login`,
  })

  return result
}

/**
 * Where emails should point. Vercel sets VERCEL_URL per deployment, which is
 * the preview host on previews — fine, because a preview's links should stay
 * inside that preview rather than sending testers to production.
 */
export function baseUrlFrom(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return new URL(request.url).origin
}
