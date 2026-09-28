/**
 * Google Meet links via the Calendar API, over plain `fetch` — no SDK.
 *
 * A personal Gmail account cannot be driven by a service account (that needs
 * Workspace domain-wide delegation), so this acts as the owner with a refresh
 * token they granted once through `pnpm google:auth`. Each slot becomes one
 * event on the owner's calendar, and the Meet link on that event is the one
 * both bookers are sent.
 *
 * The OAuth app must be "In production" in Google Cloud: in "Testing" the
 * refresh token dies after seven days and slot creation starts failing.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const EVENTS_URL = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

type Config = { clientId: string; clientSecret: string; refreshToken: string; calendarId: string }

function config(): Config | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  return { clientId, clientSecret, refreshToken, calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary' }
}

export function googleConfigured(): boolean {
  return config() !== null
}

/** Reused across warm invocations; an access token lives about an hour. */
let cached: { token: string; expiresAt: number } | null = null

async function accessToken(cfg: Config): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    // `invalid_grant` is the revoked/expired refresh token — the one failure
    // the owner has to fix by hand, so it gets named rather than buried.
    if (detail.includes('invalid_grant')) {
      throw new Error(
        'Google sign-in has expired or was revoked. Run `pnpm google:auth` again and update GOOGLE_REFRESH_TOKEN.',
      )
    }
    throw new Error(`Google token refresh failed (${response.status}): ${detail}`)
  }
  const body = (await response.json()) as { access_token: string; expires_in: number }
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return body.access_token
}

type GoogleEvent = {
  id: string
  hangoutLink?: string
  conferenceData?: {
    createRequest?: { status?: { statusCode?: string } }
    entryPoints?: { entryPointType: string; uri: string }[]
  }
}

function meetLink(event: GoogleEvent): string | null {
  return (
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
    null
  )
}

/**
 * Creates the calendar event and its Meet link.
 *
 * `requestId` is the slot's own id, so a retried request asks Google for the
 * same conference rather than a second one.
 */
export async function createMeetEvent(input: {
  slotId: string
  startsAt: Date
  endsAt: Date
}): Promise<{ eventId: string; meetUrl: string }> {
  const cfg = config()
  if (!cfg) throw new Error('Google Calendar is not configured')
  const token = await accessToken(cfg)

  const response = await fetch(`${EVENTS_URL(cfg.calendarId)}?conferenceDataVersion=1&sendUpdates=none`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: 'Français on Tips — free demo class',
      description: 'Booked through the demo page. Bookings are listed in /admin.',
      start: { dateTime: input.startsAt.toISOString() },
      end: { dateTime: input.endsAt.toISOString() },
      // Bookers are never added as guests, but if the owner adds anyone by
      // hand, two strangers should still not see each other's addresses.
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      conferenceData: {
        createRequest: {
          requestId: input.slotId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  })
  if (!response.ok) {
    throw new Error(`Google Calendar rejected the event (${response.status}): ${await response.text()}`)
  }

  let event = (await response.json()) as GoogleEvent

  // Conference creation is asynchronous on Google's side. It is almost always
  // done by the time the insert returns; when it is not, it is within seconds.
  for (let attempt = 0; !meetLink(event) && attempt < 4; attempt++) {
    if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') break
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)))
    const again = await fetch(`${EVENTS_URL(cfg.calendarId)}/${encodeURIComponent(event.id)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (again.ok) event = (await again.json()) as GoogleEvent
  }

  const url = meetLink(event)
  if (!url) {
    await deleteMeetEvent(event.id).catch(() => {})
    throw new Error('Google created the event but did not attach a Meet link')
  }
  return { eventId: event.id, meetUrl: url }
}

/** Best-effort. An orphaned calendar event is clutter, not harm. */
export async function deleteMeetEvent(eventId: string): Promise<void> {
  const cfg = config()
  if (!cfg) return
  const token = await accessToken(cfg)
  const response = await fetch(
    `${EVENTS_URL(cfg.calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  )
  // 410: already deleted by hand in Google Calendar — the outcome we wanted.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar delete failed (${response.status}): ${await response.text()}`)
  }
}
