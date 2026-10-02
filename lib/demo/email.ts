import { escapeHtml, send, shell } from '@/lib/email'
import { adminTimeZone, formatSlot } from './time'

/**
 * The emails demo booking sends. All best-effort — the booking is already
 * saved, Google has put it on the booker's calendar, and the success screen
 * shows the same time and link, so a bounce costs convenience, not the call.
 *
 * No calendar file is attached: the Google invitation already puts the class
 * on the booker's calendar, and a second copy from an .ics would duplicate it.
 */

type Booking = {
  bookingId: string
  name: string
  email: string
  phone: string
  levelNote: string
  timeZone: string
  seat: number
  capacity: number
  startsAt: Date
  meetUrl: string
}

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}"
      style="display:inline-block;background:#2B4C9B;color:#fff;text-decoration:none;
             padding:12px 22px;border-radius:4px;font-weight:600;">${escapeHtml(label)}</a>`

/** "Can't make it? Reply" has to reach the owner, not the sending address. */
const replyToOwner = () => process.env.ADMIN_EMAIL || undefined

export function sendDemoBookedToBooker(b: Booking) {
  const when = formatSlot(b.startsAt, b.timeZone)
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">Bonjour ${escapeHtml(b.name)},</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">
      Your free demo class is booked.
    </p>
    <p style="font-size:18px;line-height:1.5;font-weight:600;margin:0 0 6px;">${escapeHtml(when)}</p>
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:0 0 24px;">
      Shown in your time zone (${escapeHtml(b.timeZone)}). You will also get a
      Google Calendar invitation for it, and a reminder email an hour before.
    </p>
    ${button(b.meetUrl, 'Join on Google Meet')}
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:24px 0 0;">
      Link: ${escapeHtml(b.meetUrl)}<br>
      The class is 30 minutes${b.capacity > 1 ? ' and you may share it with other learners' : ''}.
      Can&rsquo;t make it? Just reply to this email.
    </p>`
  return send({
    to: b.email,
    subject: `Your demo class — ${when}`,
    html: shell(body),
    replyTo: replyToOwner(),
  })
}

export function sendDemoBookedToAdmin(b: Booking) {
  const to = process.env.ADMIN_EMAIL
  if (!to) {
    console.warn('[email] ADMIN_EMAIL not set — skipping owner notice for demo booking', b.bookingId)
    return Promise.resolve({ sent: false, reason: 'not-configured' })
  }
  const zone = adminTimeZone()
  const when = formatSlot(b.startsAt, zone)
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#5A6980;vertical-align:top;">${label}</td>
         <td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">New demo booking</h1>
    <p style="font-size:18px;line-height:1.5;font-weight:600;margin:0 0 6px;">${escapeHtml(when)}</p>
    <p style="font-size:14px;color:#5A6980;margin:0 0 20px;">Seat ${b.seat} of ${b.capacity} · on your Google Calendar</p>
    <table style="font-size:15px;line-height:1.5;border-collapse:collapse;margin:0 0 24px;">
      ${row('Name', b.name)}
      ${row('Email', b.email)}
      ${row('Phone', b.phone)}
      ${row('Their time', formatSlot(b.startsAt, b.timeZone))}
      ${row('French level', b.levelNote)}
    </table>
    ${button(b.meetUrl, 'Open the Meet')}`
  return send({
    to,
    subject: `Demo booked: ${b.name} — ${when}`,
    html: shell(body),
    // Replying to the notice writes to the booker.
    replyTo: b.email,
  })
}

/** Scheduled at booking time for an hour before the class; see reminders.ts. */
export function sendDemoReminder(r: {
  name: string
  email: string
  timeZone: string
  startsAt: Date
  meetUrl: string
  scheduledAt: Date
}) {
  const when = formatSlot(r.startsAt, r.timeZone)
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">Bonjour ${escapeHtml(r.name)},</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">
      A quick reminder: your free demo class starts in <strong>one hour</strong>.
    </p>
    <p style="font-size:18px;line-height:1.5;font-weight:600;margin:0 0 24px;">${escapeHtml(when)}</p>
    ${button(r.meetUrl, 'Join on Google Meet')}
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:24px 0 0;">
      Link: ${escapeHtml(r.meetUrl)}<br>
      Join a minute or two early from a quiet place, with headphones if you have
      them. Can&rsquo;t make it after all? Just reply to this email.
    </p>`
  return send({
    to: r.email,
    subject: 'Your Français on Tips demo class starts in 1 hour',
    html: shell(body),
    replyTo: replyToOwner(),
    scheduledAt: r.scheduledAt,
  })
}

/**
 * When Google refuses a booking's calendar event, the visitor is told to try
 * again — and the owner is told why, since a revoked Google sign-in means
 * every booking fails until it is fixed.
 */
export function sendCalendarFailureAlert(reason: string) {
  const to = process.env.ADMIN_EMAIL
  if (!to) return Promise.resolve({ sent: false, reason: 'not-configured' })
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">A demo booking just failed</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
      Someone tried to book a demo class, but Google Calendar refused to create
      the event, so the booking was not saved and they were asked to try again.
    </p>
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:0 0 16px;">Google said: ${escapeHtml(reason.slice(0, 500))}</p>
    <p style="font-size:16px;line-height:1.6;margin:0;">
      If it says the sign-in expired or was revoked, run <code>pnpm google:auth</code>,
      put the new GOOGLE_REFRESH_TOKEN in Vercel and redeploy. <code>pnpm google:check</code>
      confirms it works.
    </p>`
  return send({ to, subject: 'Action needed: demo bookings are failing (Google Calendar)', html: shell(body) })
}
