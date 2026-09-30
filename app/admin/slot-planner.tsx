'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { call } from './admin-controls'

/**
 * Plan a month at once: tick days on the calendar, tick half-hour slots
 * (6:00–6:30, 6:30–7:00 …), set the seats, and every day × slot is created.
 *
 * A half-hour that already exists on the chosen days is drawn faded and
 * cannot be picked, so the grid itself shows what is already planned.
 *
 * Everything here is in the owner's browser zone — `new Date('YYYY-MM-DDTHH:MM')`
 * is read as local time — and each slot is sent as an instant, so the server
 * never guesses at a zone.
 *
 * Slots are created one request each, a few at a time, rather than in one big
 * request: with Google connected every slot is a Calendar call, and a month of
 * them in one request could outlive the function's time limit halfway through.
 */

type Existing = { iso: string; booked: number; capacity: number }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PARALLEL = 3
const HALF_HOUR = 30 * 60_000

const noSubscribe = () => () => {}
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayKey = () => dayKey(new Date())
/** Minute-granular so the snapshot stays stable between renders. */
const currentMinute = () => Math.floor(Date.now() / 60_000)

function timeOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
}

/** "6:00–6:30 pm", "11:30 am–12:00 pm" — the meridiem once unless it changes. */
function rangeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const start = h * 60 + m
  const end = start + 30
  const part = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24
    return { text: `${hh % 12 === 0 ? 12 : hh % 12}:${pad(mins % 60)}`, pm: hh >= 12 }
  }
  const a = part(start)
  const b = part(end)
  const mer = (pm: boolean) => (pm ? 'pm' : 'am')
  return a.pm === b.pm ? `${a.text}–${b.text} ${mer(b.pm)}` : `${a.text} ${mer(a.pm)}–${b.text} ${mer(b.pm)}`
}

/** Every half-hour of the day, in four blocks so the grid reads at a glance.
 *  Below the helpers it calls: it is built at module load. */
const BLOCKS = [
  { label: 'Morning', from: 6 * 60, to: 12 * 60 },
  { label: 'Afternoon', from: 12 * 60, to: 17 * 60 },
  { label: 'Evening', from: 17 * 60, to: 24 * 60 },
  { label: 'Night', from: 0, to: 6 * 60 },
].map((b) => ({
  label: b.label,
  times: Array.from({ length: (b.to - b.from) / 30 }, (_, i) => timeOf(b.from + i * 30)),
}))

/** Monday-first grid for one month; nulls pad the first week. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(year, month, i + 1)),
  ]
}

type Progress = { done: number; total: number; created: number; skipped: number; failed: string[] }

export function SlotPlanner({ googleConnected, existing }: { googleConnected: boolean; existing: Existing[] }) {
  const router = useRouter()
  // Null on the server and in the first client frame: "today" and the
  // calendar both depend on the owner's clock and zone, which the server lacks.
  const today = useSyncExternalStore(noSubscribe, todayKey, () => null)
  const nowMinute = useSyncExternalStore(noSubscribe, currentMinute, () => null)

  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null)
  const [days, setDays] = useState<Set<string>>(new Set())
  const [times, setTimes] = useState<Set<string>>(new Set())
  const [seats, setSeats] = useState(2)
  const [meetUrl, setMeetUrl] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const existingByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const slot of existing) {
      const key = dayKey(new Date(slot.iso))
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [existing])

  const existingMs = useMemo(() => existing.map((s) => new Date(s.iso).getTime()), [existing])

  if (!today || nowMinute === null) return <div className="mt-5 h-80 animate-pulse rounded-lg bg-paper" />

  const nowMs = nowMinute * 60_000
  /**
   * A half-hour is unavailable on a day if it has passed, or if any existing
   * slot overlaps it — the server refuses slots within 30 minutes of another,
   * so an older slot at 6:15 blocks both 6:00 and 6:30.
   */
  const unavailable = (day: string, time: string) => {
    const at = new Date(`${day}T${time}`).getTime()
    if (Number.isNaN(at) || at <= nowMs) return true
    return existingMs.some((ms) => Math.abs(ms - at) < HALF_HOUR)
  }

  const [ty, tm] = today.split('-').map(Number)
  const view = cursor ?? { year: ty, month: tm - 1 }
  const grid = monthGrid(view.year, view.month)
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(view.year, view.month, 1),
  )
  const isCurrentMonth = view.year === ty && view.month === tm - 1
  const selectable = (d: Date) => dayKey(d) >= today
  const busy = progress !== null && progress.done < progress.total
  const chosenDays = [...days].sort()

  function shiftMonth(delta: number) {
    const d = new Date(view.year, view.month + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  function toggle(set: (fn: (prev: Set<string>) => Set<string>) => void, key: string) {
    set((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Adds all of `keys`, or removes them all if every one is already on. */
  function toggleAll(set: (fn: (prev: Set<string>) => Set<string>) => void, keys: string[]) {
    set((prev) => {
      const next = new Set(prev)
      const allOn = keys.length > 0 && keys.every((k) => next.has(k))
      for (const k of keys) {
        if (allOn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  function selectDaysWhere(pick: (d: Date) => boolean) {
    toggleAll(setDays, grid.filter((d): d is Date => d !== null && selectable(d) && pick(d)).map(dayKey))
  }

  /** How many of the chosen days already have this half-hour (or have passed it). */
  const takenOn = (time: string) => chosenDays.filter((day) => unavailable(day, time)).length
  const fullyTaken = (time: string) => chosenDays.length > 0 && takenOn(time) === chosenDays.length

  // Every chosen day × chosen half-hour that is still free.
  const planned = chosenDays.flatMap((day) => [...times].sort().map((time) => ({ day, time })))
  const toCreate = planned.filter(({ day, time }) => !unavailable(day, time)).map(({ day, time }) => new Date(`${day}T${time}`))
  const alreadyThere = planned.length - toCreate.length

  async function create() {
    setError(null)
    if (!googleConnected && !meetUrl) {
      setError('Paste a Meet link — Google Calendar is not connected.')
      return
    }
    const state: Progress = { done: 0, total: toCreate.length, created: 0, skipped: 0, failed: [] }
    setProgress({ ...state })

    const queue = [...toCreate]
    let stop = false
    async function worker() {
      while (!stop && queue.length > 0) {
        const at = queue.shift()!
        const failure = await call('/api/admin/slots', 'POST', {
          startsAt: at.toISOString(),
          capacity: seats,
          meetUrl,
        })
        state.done++
        if (!failure) state.created++
        else if (/within 30 minutes|already passed/.test(failure)) state.skipped++
        else {
          state.failed.push(`${at.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}: ${failure}`)
          // Signed out or Google broken: every remaining request would fail the same way.
          if (/Signed out|Google/.test(failure)) stop = true
        }
        setProgress({ ...state, failed: [...state.failed] })
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
    setProgress({ ...state, total: state.done, failed: [...state.failed] })
    // Days stay selected so the slots just made show up faded in the grid.
    setTimes(new Set())
    router.refresh()
  }

  const input = 'rounded-lg border border-rule bg-card px-3 py-2 text-ink disabled:opacity-60'

  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* ------------------------------------------------ calendar -- */}
      <div>
        <p className="mb-3 text-sm font-semibold text-ink">1. Pick days</p>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            disabled={isCurrentMonth || busy}
            aria-label="Previous month"
            className="rounded-lg border border-rule px-3 py-1.5 text-ink hover:border-ink disabled:opacity-30"
          >
            ‹
          </button>
          <p className="font-display font-bold text-ink">{monthLabel}</p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={busy}
            aria-label="Next month"
            className="rounded-lg border border-rule px-3 py-1.5 text-ink hover:border-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <button
              key={w}
              type="button"
              disabled={busy}
              title={`Select every ${w} left in ${monthLabel}`}
              onClick={() => selectDaysWhere((d) => (d.getDay() + 6) % 7 === i)}
              className="rounded py-1 text-xs font-semibold text-ink-soft hover:bg-paper hover:text-ink"
            >
              {w}
            </button>
          ))}
          {grid.map((d, i) => {
            if (!d) return <span key={`pad-${i}`} />
            const key = dayKey(d)
            const on = days.has(key)
            const open = selectable(d)
            const count = existingByDay.get(key) ?? 0
            return (
              <button
                key={key}
                type="button"
                disabled={!open || busy}
                aria-pressed={on}
                onClick={() => toggle(setDays, key)}
                className={`relative aspect-square rounded-lg text-sm font-semibold transition-colors ${
                  on ? 'bg-ink text-white' : open ? 'text-ink hover:bg-paper' : 'text-ink-soft/40'
                } ${key === today && !on ? 'ring-1 ring-rouge' : ''}`}
              >
                {d.getDate()}
                {count > 0 && (
                  <span
                    className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[0.6rem] leading-none font-bold ${
                      on ? 'text-white/80' : 'text-rouge'
                    }`}
                    title={`${count} slot${count === 1 ? '' : 's'} already`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <QuickButton disabled={busy} onClick={() => selectDaysWhere(() => true)}>All days left</QuickButton>
          <QuickButton disabled={busy} onClick={() => selectDaysWhere((d) => d.getDay() >= 1 && d.getDay() <= 5)}>
            Weekdays
          </QuickButton>
          <QuickButton disabled={busy} onClick={() => selectDaysWhere((d) => d.getDay() === 0 || d.getDay() === 6)}>
            Weekends
          </QuickButton>
          <QuickButton disabled={busy || days.size === 0} onClick={() => setDays(new Set())}>
            Clear days
          </QuickButton>
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          Click a date, or a weekday name for all of them. Red numbers show how many slots a day
          already has. Selected days stay selected when you change month.
        </p>
      </div>

      {/* ------------------------------------------ half-hour grid -- */}
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-ink">2. Pick slots</p>
            {times.size > 0 && (
              <button type="button" disabled={busy} onClick={() => setTimes(new Set())} className="text-xs font-semibold text-ink-soft underline underline-offset-2">
                Clear slots
              </button>
            )}
          </div>
          {chosenDays.length === 0 && (
            <p className="mt-1 text-xs text-ink-soft">Pick days first — slots already added on them will show faded.</p>
          )}

          <div className="mt-3 space-y-4">
            {BLOCKS.map((block) => {
              const pickable = block.times.filter((t) => !fullyTaken(t))
              return (
                <div key={block.label}>
                  <button
                    type="button"
                    disabled={busy || pickable.length === 0}
                    onClick={() => toggleAll(setTimes, pickable)}
                    title={`Select every free slot in the ${block.label.toLowerCase()}`}
                    className="mb-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase hover:text-ink disabled:hover:text-ink-soft"
                  >
                    {block.label}
                  </button>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {block.times.map((time) => {
                      const taken = fullyTaken(time)
                      const partly = !taken && chosenDays.length > 1 ? takenOn(time) : 0
                      const on = times.has(time) && !taken
                      return (
                        <button
                          key={time}
                          type="button"
                          disabled={busy || taken}
                          aria-pressed={on}
                          onClick={() => toggle(setTimes, time)}
                          title={
                            taken
                              ? 'Already added on the chosen day(s)'
                              : partly
                                ? `Already added on ${partly} of ${chosenDays.length} chosen days — only the others get it`
                                : undefined
                          }
                          className={`rounded-lg border px-2 py-2 text-xs font-semibold whitespace-nowrap transition-colors sm:text-sm ${
                            taken
                              ? 'cursor-not-allowed border-rule bg-paper text-ink-soft/40 line-through'
                              : on
                                ? 'border-ink bg-ink text-white'
                                : 'border-rule text-ink hover:border-ink'
                          }`}
                        >
                          {rangeLabel(time)}
                          {partly > 0 && (
                            <span className={`ml-1 text-[0.65rem] ${on ? 'text-white/70' : 'text-ink-soft'}`}>
                              ({partly}/{chosenDays.length})
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            Faded and struck through = already added (or passed) on every chosen day. A small
            (2/5) means it already exists on 2 of 5 chosen days; only the other 3 get it.
            Click a block name to pick all its free slots.
          </p>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-ink">3. Seats per slot</span>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" disabled={busy || seats <= 1} onClick={() => setSeats(seats - 1)} className="rounded-lg border border-rule px-3 py-2 font-bold text-ink disabled:opacity-40" aria-label="Fewer seats">
              −
            </button>
            <input
              type="number"
              min={1}
              max={50}
              value={seats}
              disabled={busy}
              onChange={(e) => setSeats(Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)))}
              className={`${input} w-20 text-center`}
            />
            <button type="button" disabled={busy || seats >= 50} onClick={() => setSeats(seats + 1)} className="rounded-lg border border-rule px-3 py-2 font-bold text-ink disabled:opacity-40" aria-label="More seats">
              +
            </button>
            <span className="text-sm text-ink-soft">people can book each slot</span>
          </div>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-ink">
            Meet link {googleConnected ? '(optional — leave empty for a new link per slot)' : '(used for every slot)'}
          </span>
          <input
            type="url"
            value={meetUrl}
            onChange={(e) => setMeetUrl(e.target.value)}
            disabled={busy}
            placeholder="https://meet.google.com/abc-defg-hij"
            className={`${input} mt-2 w-full`}
          />
        </label>

        <div className="rounded-lg border border-rule bg-paper p-4">
          <p className="text-sm text-ink">
            <span className="font-semibold">{days.size}</span> day{days.size === 1 ? '' : 's'} ×{' '}
            <span className="font-semibold">{times.size}</span> slot{times.size === 1 ? '' : 's'} ={' '}
            <span className="font-display text-lg font-bold">{toCreate.length}</span> new slot
            {toCreate.length === 1 ? '' : 's'}, {seats} seat{seats === 1 ? '' : 's'} each
          </p>
          {alreadyThere > 0 && (
            <p className="mt-1 text-xs text-ink-soft">{alreadyThere} already exist or have passed and will be skipped.</p>
          )}
          <button
            type="button"
            disabled={busy || toCreate.length === 0}
            onClick={create}
            className="mt-3 w-full rounded-lg bg-ink px-5 py-3 font-semibold text-white hover:bg-ink-deep disabled:opacity-50"
          >
            {busy ? `Creating ${progress!.done} of ${progress!.total}…` : `Create ${toCreate.length} slot${toCreate.length === 1 ? '' : 's'}`}
          </button>

          {progress && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-rule">
                <div
                  className="h-full bg-ink transition-[width]"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }}
                />
              </div>
              {!busy && (
                <p className="mt-2 text-sm text-ink">
                  Created {progress.created}
                  {progress.skipped > 0 && `, skipped ${progress.skipped} (clash with an existing slot or already passed)`}
                  {progress.failed.length > 0 && `, ${progress.failed.length} failed`}.
                </p>
              )}
            </div>
          )}
          {progress && progress.failed.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs text-rouge">
              {progress.failed.slice(0, 10).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-rouge/30 bg-rouge-wash px-3 py-2 text-sm text-rouge">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-full border border-rule px-3 py-1 font-semibold text-ink-soft hover:border-ink hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  )
}
