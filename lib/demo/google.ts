/**
 * Google Meet links via the Calendar API, over plain `fetch` — no SDK.
 *
 * A personal Gmail account cannot be driven by a service account (that needs
 * Workspace domain-wide delegation), so this acts as the owner with a refresh
 * token they granted once through `pnpm google:auth`.
 *
 * Nothing touches the calendar until someone books. Each booking then becomes
 * its own event on the owner's calendar with the booker as its only guest, so
 * Google puts it in their calendar too and nobody sees another booker's
 * address. The first booking of a slot starts a Meet call; every later
 * booking's event copies that call's conference data, so everyone in a slot
 * still joins the same room.
 *
 * The OAuth app must be "In production" in Google Cloud: in "Testing" the
 * refresh token dies after seven days and bookings start failing.
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

/**
 * The part of an event that *is* the Meet call. Copied onto another event, it
 * puts that event in the same call — which is how every booking in a slot
 * shares one link while each booker gets an invite of their own.
 */
export type Conference = {
  conferenceId: string
  conferenceSolution: unknown
  entryPoints: { entryPointType: string; uri: string; [key: string]: unknown }[]
}

type GoogleEvent = {
  id: string
  hangoutLink?: string
  conferenceData?: {
    conferenceId?: string
    conferenceSolution?: unknown
    entryPoints?: Conference['entryPoints']
    createRequest?: { status?: { statusCode?: string } }
  }
}

function conferenceOf(event: GoogleEvent): Conference | null {
  const data = event.conferenceData
  if (!data?.conferenceId || !data.entryPoints?.some((e) => e.entryPointType === 'video')) return null
  return { conferenceId: data.conferenceId, conferenceSolution: data.conferenceSolution, entryPoints: data.entryPoints }
}

export function meetUrlOf(conference: Conference): string {
  return conference.entryPoints.find((e) => e.entryPointType === 'video')!.uri
}

/**
 * Whether Google emails the booker an invite. On by default; `pnpm demo:local`
 * turns it off so trying the site locally does not send real invitations.
 */
function sendUpdates(notify: boolean): 'all' | 'none' {
  return notify && process.env.GOOGLE_SEND_INVITES !== 'off' ? 'all' : 'none'
}

async function authed(): Promise<{ cfg: Config; token: string }> {
  const cfg = config()
  if (!cfg) throw new Error('Google Calendar is not configured')
  return { cfg, token: await accessToken(cfg) }
}

/**
 * Creates one event for one booking.
 *
 * With `conference` null it starts a new Meet call; otherwise it joins that
 * call. `requestId` is the booking's id, so a retried request asks Google for
 * the same new call rather than a second one.
 */
export async function createDemoEvent(input: {
  requestId: string
  startsAt: Date
  endsAt: Date
  summary: string
  description: string
  attendee?: { email: string; name: string }
  conference: Conference | null
}): Promise<{ eventId: string; conference: Conference; meetUrl: string }> {
  const { cfg, token } = await authed()
  const notify = Boolean(input.attendee)

  const response = await fetch(
    `${EVENTS_URL(cfg.calendarId)}?conferenceDataVersion=1&sendUpdates=${sendUpdates(notify)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.startsAt.toISOString() },
        end: { dateTime: input.endsAt.toISOString() },
        attendees: input.attendee ? [{ email: input.attendee.email, displayName: input.attendee.name }] : [],
        guestsCanSeeOtherGuests: false,
        guestsCanInviteOthers: false,
        conferenceData: input.conference ?? {
          createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`Google Calendar rejected the event (${response.status}): ${await response.text()}`)
  }

  let event = (await response.json()) as GoogleEvent

  // A new call is created asynchronously on Google's side. It is almost always
  // ready by the time the insert returns; when it is not, it is within seconds.
  for (let attempt = 0; !conferenceOf(event) && attempt < 4; attempt++) {
    if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') break
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)))
    const again = await fetch(`${EVENTS_URL(cfg.calendarId)}/${encodeURIComponent(event.id)}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    if (again.ok) event = (await again.json()) as GoogleEvent
  }

  const conference = conferenceOf(event)
  if (!conference) {
    await deleteDemoEvent(event.id, { notify: false }).catch(() => {})
    throw new Error('Google created the event but did not attach a Meet link')
  }
  return { eventId: event.id, conference, meetUrl: meetUrlOf(conference) }
}

/**
 * The call on an existing event — used for slots made before bookings had
 * their own events, whose one slot-wide event holds the call. Null if the
 * event is gone or has no call.
 */
export async function eventConference(eventId: string): Promise<Conference | null> {
  const { cfg, token } = await authed()
  const response = await fetch(`${EVENTS_URL(cfg.calendarId)}/${encodeURIComponent(eventId)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 404 || response.status === 410) return null
  if (!response.ok) throw new Error(`Google Calendar read failed (${response.status}): ${await response.text()}`)
  const event = (await response.json()) as GoogleEvent & { status?: string }
  return event.status === 'cancelled' ? null : conferenceOf(event)
}

/**
 * Removes an event. With `notify`, a booker on it gets Google's cancellation
 * email. An event already deleted by hand is the outcome wanted, not an error.
 */
export async function deleteDemoEvent(eventId: string, options: { notify: boolean }): Promise<void> {
  const cfg = config()
  if (!cfg) return
  const token = await accessToken(cfg)
  const response = await fetch(
    `${EVENTS_URL(cfg.calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=${sendUpdates(options.notify)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
  )
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(`Google Calendar delete failed (${response.status}): ${await response.text()}`)
  }
}
