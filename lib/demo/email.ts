import { escapeHtml, send, shell } from '@/lib/email'
import { adminTimeZone, formatSlot, slotEnd } from './time'

/**
 * The two emails a booking sends: one to the booker in their zone, one to the
 * owner in theirs. Both best-effort — the booking is already saved and the
 * success screen shows the same time and link, so a bounce costs convenience,
 * not the call.
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

function icsDate(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

/**
 * A calendar file in UTC. Every calendar app converts it to the reader's own
 * zone on import, which is the most reliable time-zone handling there is.
 */
function calendarInvite(b: Booking): { filename: string; content: string } {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Francais on Tips//Demo class//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.bookingId}@francaisontips.com`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(b.startsAt)}`,
    `DTEND:${icsDate(slotEnd(b.startsAt))}`,
    `SUMMARY:${icsText('Français on Tips — free demo class')}`,
    `DESCRIPTION:${icsText(`Join on Google Meet: ${b.meetUrl}`)}`,
    `LOCATION:${icsText(b.meetUrl)}`,
    `URL:${b.meetUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return { filename: 'demo-class.ics', content: Buffer.from(lines.join('\r\n') + '\r\n').toString('base64') }
}

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}"
      style="display:inline-block;background:#2B4C9B;color:#fff;text-decoration:none;
             padding:12px 22px;border-radius:4px;font-weight:600;">${escapeHtml(label)}</a>`

export function sendDemoBookedToBooker(b: Booking) {
  const when = formatSlot(b.startsAt, b.timeZone)
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;">Bonjour ${escapeHtml(b.name)},</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 20px;">
      Your free demo class is booked.
    </p>
    <p style="font-size:18px;line-height:1.5;font-weight:600;margin:0 0 6px;">${escapeHtml(when)}</p>
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:0 0 24px;">
      Shown in your time zone (${escapeHtml(b.timeZone)}). The attached calendar
      file adds it to your calendar at the right local time.
    </p>
    ${button(b.meetUrl, 'Join on Google Meet')}
    <p style="font-size:14px;line-height:1.6;color:#5A6980;margin:24px 0 0;">
      Link: ${escapeHtml(b.meetUrl)}<br>
      The class is 30 minutes${b.capacity > 1 ? ' and you may share it with other learners' : ''}.
      If you are let in from a waiting screen, that is normal — we admit you
      when the class starts. Can&rsquo;t make it? Just reply to this email.
    </p>`
  return send({
    to: b.email,
    subject: `Your demo class — ${when}`,
    html: shell(body),
    attachments: [calendarInvite(b)],
    // "Can't make it? Reply" has to reach the owner, not the sending address.
    replyTo: process.env.ADMIN_EMAIL || undefined,
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
    <p style="font-size:14px;color:#5A6980;margin:0 0 20px;">Seat ${b.seat} of ${b.capacity}</p>
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
    attachments: [calendarInvite(b)],
  })
}
