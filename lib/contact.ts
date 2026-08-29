/**
 * How a buyer reaches us after paying for something a person delivers.
 *
 * WhatsApp rather than an inbox: a mock test or a lesson plan needs a
 * back-and-forth to arrange, and that conversation is already happening on
 * WhatsApp for most buyers. It also means the buyer opens the thread, so
 * nothing depends on us noticing an order and reaching out first.
 */

/** International format, digits only — what wa.me expects. */
export const WHATSAPP_NUMBER = '14162781058'

/**
 * A wa.me link, optionally opening with the message already typed.
 *
 * The prefill carries what they bought, so the thread starts with the context
 * instead of "hi" and three questions to work out who is writing.
 */
export function whatsappUrl(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

/** "I've just purchased X and Y." — the opening line for a service order. */
export function purchaseMessage(titles: string[]): string {
  if (titles.length === 0) return "Hello! I've just made a purchase."
  const list =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`
  return `Hello! I've just purchased ${list}. I'd like to arrange the next steps.`
}
