'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { call } from './admin-controls'

/**
 * Plan a month at once: tick days on the calendar, list the start times, set
 * the seats, and every day × time becomes a slot.
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

const noSubscribe = () => () => {}
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayKey = () => dayKey(new Date())

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}
function timeOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
function label12(time: string): string {
  const m = minutesOf(time)
  const h = Math.floor(m / 60)
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)} ${h < 12 ? 'am' : 'pm'}`
}

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

  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null)
  const [days, setDays] = useState<Set<string>>(new Set())
  const [times, setTimes] = useState<string[]>([])
  const [newTime, setNewTime] = useState('18:00')
  const [rangeFrom, setRangeFrom] = useState('17:00')
  const [rangeTo, setRangeTo] = useState('20:00')
  const [rangeStep, setRangeStep] = useState(30)
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

  const existingInstants = useMemo(() => new Set(existing.map((s) => new Date(s.iso).getTime())), [existing])

  if (!today) return <div className="mt-5 h-80 animate-pulse rounded-lg bg-paper" />

  const [ty, tm] = today.split('-').map(Number)
  const view = cursor ?? { year: ty, month: tm - 1 }
  const grid = monthGrid(view.year, view.month)
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(view.year, view.month, 1),
  )
  const isCurrentMonth = view.year === ty && view.month === tm - 1
  const selectable = (d: Date) => dayKey(d) >= today
  const busy = progress !== null && progress.done < progress.total

  function shiftMonth(delta: number) {
    const d = new Date(view.year, view.month + delta, 1)
    setCursor({ year: d.getFullYear(), month: d.getMonth() })
  }

  function toggleDay(key: string) {
    setDays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** Every remaining day of this month matching `pick`; toggles them off if all are already on. */
  function selectWhere(pick: (d: Date) => boolean) {
    const keys = grid.filter((d): d is Date => d !== null && selectable(d) && pick(d)).map(dayKey)
    setDays((prev) => {
      const next = new Set(prev)
      const allOn = keys.length > 0 && keys.every((k) => next.has(k))
      for (const k of keys) {
        if (allOn) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  function addTimes(list: string[]) {
    setTimes((prev) => [...new Set([...prev, ...list])].sort())
  }

  function addRange() {
    const from = minutesOf(rangeFrom)
    const to = minutesOf(rangeTo)
    if (!(to > from)) {
      setError('The range must end after it starts.')
      return
    }
    const list: string[] = []
    // The last slot must *start* early enough to finish by the end time.
    for (let m = from; m + 30 <= to; m += rangeStep) list.push(timeOf(m))
    setError(null)
    addTimes(list)
  }

  // Every day × time, dropping what has already passed or already exists.
  const planned = [...days]
    .sort()
    .flatMap((day) => times.map((time) => new Date(`${day}T${time}`)))
    .filter((at) => !Number.isNaN(at.getTime()))
  const nowish = Date.parse(`${today}T00:00`)
  const toCreate = planned.filter((at) => at.getTime() > nowish && !existingInstants.has(at.getTime()))
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
    if (state.created > 0) {
      setDays(new Set())
    }
    router.refresh()
  }

  const input = 'rounded-lg border border-rule bg-card px-3 py-2 text-ink disabled:opacity-60'

  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ------------------------------------------------ calendar -- */}
      <div>
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
              onClick={() => selectWhere((d) => (d.getDay() + 6) % 7 === i)}
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
                onClick={() => toggleDay(key)}
                className={`relative aspect-square rounded-lg text-sm font-semibold transition-colors ${
                  on
                    ? 'bg-ink text-white'
                    : open
                      ? 'text-ink hover:bg-paper'
                      : 'text-ink-soft/40'
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
          <QuickButton disabled={busy} onClick={() => selectWhere(() => true)}>All days left</QuickButton>
          <QuickButton disabled={busy} onClick={() => selectWhere((d) => d.getDay() >= 1 && d.getDay() <= 5)}>
            Weekdays
          </QuickButton>
          <QuickButton disabled={busy} onClick={() => selectWhere((d) => d.getDay() === 0 || d.getDay() === 6)}>
            Weekends
          </QuickButton>
          <QuickButton disabled={busy || days.size === 0} onClick={() => setDays(new Set())}>
            Clear
          </QuickButton>
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          Click days to pick them, or a weekday name to pick all of them. Red numbers are slots
          that already exist. Selected days carry over when you change month.
        </p>
      </div>

      {/* ------------------------------------------ times & seats -- */}
      <div className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-ink">Start times (30 minutes each)</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="time" value={newTime} step={300} onChange={(e) => setNewTime(e.target.value)} disabled={busy} className={input} />
            <button
              type="button"
              disabled={busy || !newTime}
              onClick={() => addTimes([newTime])}
              className="rounded-lg border border-ink px-3 py-2 text-sm font-semibold text-ink hover:bg-ink hover:text-white disabled:opacity-50"
            >
              Add time
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>or every</span>
            <select value={rangeStep} onChange={(e) => setRangeStep(Number(e.target.value))} disabled={busy} className={input}>
              <option value={30}>30 min</option>
              <option value={60}>hour</option>
            </select>
            <span>from</span>
            <input type="time" value={rangeFrom} step={300} onChange={(e) => setRangeFrom(e.target.value)} disabled={busy} className={input} />
            <span>to</span>
            <input type="time" value={rangeTo} step={300} onChange={(e) => setRangeTo(e.target.value)} disabled={busy} className={input} />
            <button
              type="button"
              disabled={busy}
              onClick={addRange}
              className="rounded-lg border border-ink px-3 py-2 text-sm font-semibold text-ink hover:bg-ink hover:text-white disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {times.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {times.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-paper py-1 pr-1 pl-3 text-sm font-semibold text-ink">
                  {label12(t)}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setTimes(times.filter((x) => x !== t))}
                    aria-label={`Remove ${label12(t)}`}
                    className="rounded-full px-1.5 text-ink-soft hover:bg-rouge-wash hover:text-rouge"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">No times yet.</p>
          )}
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-ink">Seats per slot</span>
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
            <span className="font-semibold">{times.length}</span> time{times.length === 1 ? '' : 's'} ={' '}
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
