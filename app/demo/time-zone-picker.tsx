'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'

/**
 * Which zone the booking page shows times in: the visitor's own by default,
 * any other on request.
 *
 * A raw list of 400 IANA names ("America/Argentina/ComodRivadavia") is not
 * something a learner can use, so each zone is shown by its everyday name and
 * its offset, the likely ones come first, and the list can be searched by
 * city, country word or zone name.
 */

/** Where Français on Tips learners mostly are. Shown first, in this order. */
const POPULAR: { zone: string; hint: string }[] = [
  { zone: 'Asia/Kolkata', hint: 'India' },
  { zone: 'Europe/Paris', hint: 'France' },
  { zone: 'Europe/London', hint: 'United Kingdom' },
  { zone: 'America/Toronto', hint: 'Canada (also Montréal, Ottawa)' },
  { zone: 'America/Vancouver', hint: 'Canada' },
  { zone: 'America/Edmonton', hint: 'Canada (also Calgary)' },
  { zone: 'America/Winnipeg', hint: 'Canada' },
  { zone: 'America/Halifax', hint: 'Canada' },
  { zone: 'Asia/Dubai', hint: 'United Arab Emirates' },
  { zone: 'America/New_York', hint: 'United States' },
  { zone: 'Australia/Sydney', hint: 'Australia' },
]

const noSubscribe = () => () => {}
/** Minute-granular so the snapshot is stable between renders. */
const currentMinute = () => Math.floor(Date.now() / 60_000)

/**
 * Old IANA names some browsers still report. The zone itself is fine to use;
 * only the label would look dated ("Calcutta" for an Indian visitor).
 */
const OLD_CITY_NAMES: Record<string, string> = {
  Calcutta: 'Kolkata',
  Kiev: 'Kyiv',
  Saigon: 'Ho Chi Minh City',
  Rangoon: 'Yangon',
  Katmandu: 'Kathmandu',
}

/** "Kolkata", "Port of Spain" — the last part of the IANA name, readable. */
function city(zone: string): string {
  const raw = (zone.split('/').pop() ?? zone).replace(/_/g, ' ')
  return OLD_CITY_NAMES[raw] ?? raw
}

function part(zone: string, at: Date, option: 'shortOffset' | 'longGeneric'): string {
  try {
    return (
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: option })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/** "GMT+5:30"; plain "GMT" becomes "GMT+0" so every row lines up. */
export function zoneOffset(zone: string, at = new Date()): string {
  const value = part(zone, at, 'shortOffset')
  return value === 'GMT' ? 'GMT+0' : value
}

/** "India Standard Time", "Central European Time" — falls back to the city. */
export function zoneName(zone: string, at = new Date()): string {
  const value = part(zone, at, 'longGeneric')
  return value && !value.startsWith('GMT') ? value : city(zone)
}

function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return POPULAR.map((p) => p.zone)
  }
}

export function TimeZonePicker({
  value,
  detected,
  onChange,
}: {
  value: string
  /** The browser's own zone; null if it could not be read. */
  detected: string | null
  onChange: (zone: string) => void
}) {
  const minute = useSyncExternalStore(noSubscribe, currentMinute, () => null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const now = useMemo(() => (minute === null ? null : new Date(minute * 60_000)), [minute])

  const rows = useMemo(() => {
    if (!now) return []
    const popular = new Set(POPULAR.map((p) => p.zone))
    const hints = new Map(POPULAR.map((p) => [p.zone, p.hint]))
    const build = (zone: string) => ({
      zone,
      hint: hints.get(zone) ?? zone.split('/')[0].replace(/_/g, ' '),
      name: zoneName(zone, now),
      offset: zoneOffset(zone, now),
      city: city(zone),
    })
    const all = [...POPULAR.map((p) => p.zone), ...allZones().filter((z) => !popular.has(z))].map(build)
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, POPULAR.length)
    return all
      .filter((r) => `${r.zone} ${r.city} ${r.hint} ${r.name} ${r.offset}`.toLowerCase().includes(q))
      .slice(0, 40)
  }, [now, query])

  if (!now) return null

  const isDetected = detected !== null && value === detected
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: value, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)

  function choose(zone: string) {
    onChange(zone)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="rounded-card border border-rule bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
            Times shown in {isDetected ? '· detected automatically' : '· chosen by you'}
          </p>
          <p className="mt-1 font-semibold text-ink">
            {zoneName(value, now)} <span className="font-normal text-ink-soft">({zoneOffset(value, now)})</span>
          </p>
          <p className="text-sm text-ink-soft">
            {city(value)} — it&rsquo;s {clock} there now
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isDetected && detected && (
            <button
              type="button"
              onClick={() => choose(detected)}
              className="rounded-lg border border-rule px-3 py-2 text-sm font-semibold text-ink-soft hover:border-ink hover:text-ink"
            >
              Use my time zone
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="rounded-lg border border-ink px-3 py-2 text-sm font-semibold text-ink hover:bg-ink hover:text-white"
          >
            {open ? 'Close' : 'Change time zone'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 border-t border-rule pt-4">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a city or country — e.g. Toronto, Paris, India"
            aria-label="Search time zones"
            className="w-full rounded-lg border border-rule bg-card px-3.5 py-2.5 text-ink placeholder:text-ink-soft"
          />
          {!query && <p className="mt-3 text-xs font-semibold tracking-wide text-ink-soft uppercase">Popular</p>}
          <ul className="mt-2 max-h-72 divide-y divide-rule overflow-auto rounded-lg border border-rule">
            {rows.length === 0 && <li className="px-3.5 py-3 text-sm text-ink-soft">No time zone matches “{query}”.</li>}
            {rows.map((r) => (
              <li key={r.zone}>
                <button
                  type="button"
                  onClick={() => choose(r.zone)}
                  aria-current={r.zone === value}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-paper ${
                    r.zone === value ? 'bg-ink-wash font-semibold' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-ink">{r.name}</span>
                    <span className="block truncate text-xs text-ink-soft">
                      {r.city} · {r.hint}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-soft">{r.offset}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
