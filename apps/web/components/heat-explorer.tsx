'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import useSWR from 'swr'
import { LocateFixed } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_LOCATION, TIME_WINDOWS, windowRange, type HeatEvent, type TimeWindow } from '@/lib/events'
import { EventList } from '@/components/event-list'
import { AccountMenu } from '@/components/account-menu'

const EventMap = dynamic(() => import('@/components/event-map').then((m) => m.EventMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
})

type Location = { lat: number; lng: number; label: string }

const RADII = [5, 10, 25, 50]

async function fetchNearby([, lat, lng, radius, window]: [string, number, number, number, TimeWindow]) {
  const { from, to } = windowRange(window)
  const { data, error } = await createClient().rpc('heat_events_nearby', {
    p_lat: lat,
    p_lng: lng,
    p_radius_km: radius,
    p_from: from,
    p_to: to,
  })
  if (error) throw error
  return (data ?? []) as HeatEvent[]
}

async function fetchStars([, userId]: [string, string]) {
  const { data, error } = await createClient().from('heat_event_stars').select('event_id').eq('user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map((row) => row.event_id as string))
}

export function HeatExplorer({ userId, userEmail }: { userId: string | null; userEmail: string | null }) {
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION)
  const [locating, setLocating] = useState(false)
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('tonight')
  const [radius, setRadius] = useState(25)
  const [activeId, setActiveId] = useState<string | null>(null)

  const { data: events, error, isLoading } = useSWR(
    ['nearby', location.lat, location.lng, radius, timeWindow] as [string, number, number, number, TimeWindow],
    fetchNearby,
    { refreshInterval: 60_000, keepPreviousData: true },
  )
  const { data: stars, mutate: mutateStars } = useSWR(userId ? (['stars', userId] as [string, string]) : null, fetchStars)

  function locate() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your location' })
        setLocating(false)
      },
      () => setLocating(false),
      { timeout: 8000 },
    )
  }

  async function toggleStar(eventId: string) {
    if (!userId || !stars) return
    const supabase = createClient()
    const starred = stars.has(eventId)
    const next = new Set(stars)
    if (starred) next.delete(eventId)
    else next.add(eventId)
    await mutateStars(
      async () => {
        const { error } = starred
          ? await supabase.from('heat_event_stars').delete().eq('user_id', userId).eq('event_id', eventId)
          : await supabase.from('heat_event_stars').insert({ user_id: userId, event_id: eventId })
        if (error) throw error
        return next
      },
      { optimisticData: next, rollbackOnError: true, revalidate: false },
    )
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-primary">HEAT</h1>
          <span className="hidden text-sm text-muted-foreground sm:inline">a Flow satellite</span>
        </div>
        <AccountMenu email={userEmail} />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <div role="tablist" aria-label="Time window" className="flex gap-1 rounded-lg bg-muted p-1">
          {TIME_WINDOWS.map((w) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={timeWindow === w.id}
              onClick={() => setTimeWindow(w.id)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm"
            >
              {w.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="sr-only">Search radius</span>
          <select
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                Within {r} km
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={locate}
          disabled={locating}
          className="ml-auto flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          <LocateFixed className="size-4" aria-hidden />
          {locating ? 'Locating…' : location.label}
        </button>
      </div>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section aria-label="Map" className="h-[42vh] shrink-0 md:h-auto md:flex-1">
          <EventMap
            center={[location.lat, location.lng]}
            events={events ?? []}
            activeId={activeId}
            onSelect={setActiveId}
          />
        </section>
        <section
          aria-label="Events"
          className="flex min-h-0 flex-1 flex-col border-t border-border bg-background md:w-[420px] md:flex-none md:border-l md:border-t-0"
        >
          <EventList
            events={events}
            error={error}
            isLoading={isLoading}
            activeId={activeId}
            onSelect={setActiveId}
            stars={stars}
            canStar={Boolean(userId)}
            onToggleStar={toggleStar}
          />
        </section>
      </main>
    </div>
  )
}
