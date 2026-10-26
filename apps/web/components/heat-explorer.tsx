'use client'

import clsx from 'clsx'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Flame, LocateFixed, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { HeatEvent } from '@/lib/events'
import { DEMO_CENTER, buildDemoEvents } from '@/lib/demo'
import { fromHeatEvent, isRelevantAt, presenceAt, signalsAt, type SpotEvent } from '@/lib/heat'
import { EventRow, FilterChips, type Filter } from '@/components/event-list'
import { EventDetail } from '@/components/event-detail'
import { STEPS, STEP_MINUTES, TimeScrubber } from '@/components/time-scrubber'
import { AccountMenu } from '@/components/account-menu'
import type { ScoredEvent } from '@/components/heat-map'

const HeatMap = dynamic(() => import('@/components/heat-map').then((m) => m.HeatMap), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-background" />,
})

type Mode = 'demo' | 'live'
type Snap = 'peek' | 'half' | 'full'
type Place = { lat: number; lng: number; label: string }

const SNAP_HEIGHT: Record<Snap, string> = { peek: '17.5rem', half: '58dvh', full: '88dvh' }

async function fetchLive([, lat, lng, from]: [string, number, number, number]) {
  const { data, error } = await createClient().rpc('heat_events_nearby', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: 25,
    p_from: new Date(from).toISOString(),
    p_to: new Date(from + 18 * 3_600_000).toISOString(),
  })
  if (error) throw error
  return ((data ?? []) as HeatEvent[]).map(fromHeatEvent)
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return desktop
}

function matchesFilter(event: ScoredEvent, filter: Filter, t: number) {
  if (filter === 'all') return true
  if (filter === 'live') return event.live
  if (filter === 'soon') return !event.live && event.startsAt - t <= 2 * 3_600_000 && event.startsAt > t
  if (filter === 'nightlife') return event.category === 'nightlife' || event.category === 'party'
  return event.category === filter
}

export function HeatExplorer({ userId, userEmail }: { userId: string | null; userEmail: string | null }) {
  const [now] = useState(() => Date.now())
  const [mode, setMode] = useState<Mode>('demo')
  const [place, setPlace] = useState<Place>(DEMO_CENTER)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [step, setStep] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [snap, setSnap] = useState<Snap>('peek')
  const [saved, setSaved] = useState<Set<string>>(() => new Set())
  const desktop = useIsDesktop()

  const t = now + step * STEP_MINUTES * 60_000

  const demoEvents = useMemo(() => buildDemoEvents(place, now), [place, now])
  const live = useSWR(
    mode === 'live' ? (['live', place.lat, place.lng, now] as [string, number, number, number]) : null,
    fetchLive,
    { refreshInterval: 60_000, keepPreviousData: true },
  )
  const source: SpotEvent[] = mode === 'demo' ? demoEvents : (live.data ?? [])

  const scored = useMemo<ScoredEvent[]>(
    () =>
      source
        .filter((e) => isRelevantAt(e, t))
        .map((e) => ({ ...e, score: signalsAt(e, t).score, live: presenceAt(e, t) === 1 }))
        .sort((a, b) => {
          const aActive = a.status === 'scheduled' ? 1 : 0
          const bActive = b.status === 'scheduled' ? 1 : 0
          return bActive - aActive || b.score - a.score || a.startsAt - b.startsAt
        }),
    [source, t],
  )

  const totals = useMemo(
    () =>
      Array.from({ length: STEPS + 1 }, (_, i) => {
        const at = now + i * STEP_MINUTES * 60_000
        return source.reduce((sum, e) => sum + signalsAt(e, at).score * (presenceAt(e, at) > 0 ? 1 : 0), 0)
      }),
    [source, now],
  )

  const listed = scored.filter((e) => matchesFilter(e, filter, t))
  const active = scored.find((e) => e.id === activeId) ?? null
  const liveCount = scored.filter((e) => e.live).length

  const select = useCallback(
    (id: string) => {
      setActiveId(id)
      setSnap((s) => (s === 'full' ? 'full' : 'half'))
    },
    [],
  )

  function locate() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Near you' }
        setPlace(next)
        setUserLocation([next.lat, next.lng])
        setActiveId(null)
        setLocating(false)
      },
      () => setLocating(false),
      { timeout: 8000, maximumAge: 300_000 },
    )
  }

  async function toggleSave(id: string) {
    const next = new Set(saved)
    const removing = next.has(id)
    if (removing) next.delete(id)
    else next.add(id)
    setSaved(next)
    if (mode === 'live' && userId) {
      const supabase = createClient()
      const { error } = removing
        ? await supabase.from('heat_event_stars').delete().eq('user_id', userId).eq('event_id', id)
        : await supabase.from('heat_event_stars').insert({ user_id: userId, event_id: id })
      if (error) setSaved(saved)
    }
  }

  const dragStart = useRef<number | null>(null)
  function onHandlePointerDown(e: React.PointerEvent) {
    dragStart.current = e.clientY
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onHandlePointerUp(e: React.PointerEvent) {
    if (dragStart.current == null) return
    const dy = e.clientY - dragStart.current
    dragStart.current = null
    const order: Snap[] = ['peek', 'half', 'full']
    const i = order.indexOf(snap)
    if (Math.abs(dy) < 8) setSnap(order[(i + 1) % order.length])
    else if (dy < -30) setSnap(order[Math.min(2, i + 1)])
    else if (dy > 30) setSnap(order[Math.max(0, i - 1)])
  }

  const [viewportH, setViewportH] = useState(800)
  useEffect(() => {
    const update = () => setViewportH(window.innerHeight)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const bottomInset = desktop ? 0 : snap === 'peek' ? 280 : viewportH * 0.58

  const panel = (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <TimeScrubber now={now} step={step} onStepChange={setStep} totals={totals} />
      {active ? (
        <EventDetail
          event={active}
          t={t}
          origin={place}
          demo={mode === 'demo'}
          saved={saved.has(active.id)}
          onToggleSave={() => toggleSave(active.id)}
          onBack={() => setActiveId(null)}
        />
      ) : (
        <>
          <FilterChips value={filter} onChange={setFilter} />
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold text-foreground">
              {step === 0 ? 'Hottest near you' : 'Forecast'}
            </h2>
            <span className="text-sm text-muted-foreground">
              {liveCount} live · {scored.length} total
            </span>
          </div>
          {mode === 'live' && live.isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading live events…
            </div>
          ) : mode === 'live' && live.error ? (
            <p className="py-6 text-sm text-muted-foreground">{"Couldn't reach HEAT right now. Try again shortly."}</p>
          ) : listed.length === 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-6 text-center">
              <p className="font-medium text-foreground">Nothing matches here yet</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mode === 'live' ? 'No live events in this area. Switch to the demo to explore.' : 'Try another filter or scrub forward in time.'}
              </p>
            </div>
          ) : (
            <ol className="-mx-2 flex flex-col">
              {listed.map((event, i) => (
                <EventRow key={event.id} event={event} t={t} rank={i + 1} onSelect={select} />
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )

  return (
    <div className="relative h-dvh overflow-hidden bg-background md:flex">
      <aside
        aria-label="Events"
        className="hidden md:order-first md:flex md:w-[420px] md:shrink-0 md:flex-col md:border-r md:border-border md:bg-card"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <Brand />
          <AccountMenu email={userEmail} />
        </div>
        <div className="flex-1 overflow-y-auto pt-1">{desktop && panel}</div>
      </aside>

      <main
        className="absolute inset-0 md:relative md:flex-1"
        style={{ '--sheet-h': desktop ? '0px' : SNAP_HEIGHT[snap] } as React.CSSProperties}
      >
        <HeatMap
          center={[place.lat, place.lng]}
          userLocation={userLocation}
          events={scored}
          activeId={activeId}
          onSelect={select}
          bottomInset={bottomInset}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="pointer-events-auto flex items-center justify-between gap-2 md:hidden">
            <div className="glass flex h-11 items-center rounded-full px-4">
              <Brand />
            </div>
            <AccountMenu email={userEmail} compact />
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className="glass flex h-11 min-w-0 items-center gap-2 rounded-full px-4 text-sm font-medium text-foreground"
            >
              {locating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LocateFixed className="size-4" aria-hidden />}
              <span className="truncate">{locating ? 'Locating…' : place.label}</span>
            </button>
            <div role="radiogroup" aria-label="Data source" className="glass ml-auto flex h-11 items-center rounded-full p-1">
              {(['demo', 'live'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => {
                    setMode(m)
                    setActiveId(null)
                  }}
                  className="h-9 rounded-full px-3.5 text-sm font-medium capitalize text-muted-foreground aria-checked:bg-foreground aria-checked:text-background"
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!desktop && (
          <section
            aria-label="Events"
            className="absolute inset-x-0 bottom-0 z-[600] flex flex-col rounded-t-3xl border-t border-border bg-card shadow-[0_-12px_40px_rgb(0_0_0/0.45)] transition-[height] duration-300 ease-out"
            style={{ height: SNAP_HEIGHT[snap] }}
          >
            <button
              type="button"
              aria-label={snap === 'full' ? 'Collapse event list' : 'Expand event list'}
              onPointerDown={onHandlePointerDown}
              onPointerUp={onHandlePointerUp}
              className="flex h-7 shrink-0 touch-none items-center justify-center"
            >
              <span className="h-1.5 w-10 rounded-full bg-muted" />
            </button>
            <div className={clsx('flex-1 overscroll-contain', snap === 'peek' ? 'overflow-hidden' : 'overflow-y-auto')}>
              {panel}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-1.5" aria-label="HEAT home">
      <Flame className="size-5 text-primary" aria-hidden />
      <span className="font-display text-lg font-bold tracking-tight text-foreground">HEAT</span>
    </Link>
  )
}
