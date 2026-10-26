'use client'

import { useEffect, useRef } from 'react'
import { Star, Ticket } from 'lucide-react'
import clsx from 'clsx'
import { formatCrowd, formatPrice, formatWhen, heatColor, isLive, type HeatEvent } from '@/lib/events'

type Props = {
  events: HeatEvent[] | undefined
  error: unknown
  isLoading: boolean
  activeId: string | null
  onSelect: (id: string) => void
  stars: Set<string> | undefined
  canStar: boolean
  onToggleStar: (id: string) => void
}

export function EventList({ events, error, isLoading, activeId, onSelect, stars, canStar, onToggleStar }: Props) {
  if (error) {
    return <p className="p-6 text-sm text-muted-foreground">Couldn&apos;t load events. Try again in a moment.</p>
  }
  if (isLoading && !events) {
    return (
      <div className="flex flex-col gap-3 p-4" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  }
  if (!events?.length) {
    return (
      <div className="flex flex-col gap-1 p-6">
        <p className="font-display text-lg font-semibold">Nothing nearby yet</p>
        <p className="text-sm leading-relaxed text-muted-foreground">Widen the radius or try a longer time window.</p>
      </div>
    )
  }

  const sorted = [...events].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.heat_score - a.heat_score)

  return (
    <>
      <p className="border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {events.length} {events.length === 1 ? 'event' : 'events'} · hottest first
      </p>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {sorted.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            active={event.id === activeId}
            onSelect={onSelect}
            starred={stars?.has(event.id) ?? false}
            canStar={canStar}
            onToggleStar={onToggleStar}
          />
        ))}
      </ul>
    </>
  )
}

function EventRow({
  event,
  active,
  onSelect,
  starred,
  canStar,
  onToggleStar,
}: {
  event: HeatEvent
  active: boolean
  onSelect: (id: string) => void
  starred: boolean
  canStar: boolean
  onToggleStar: (id: string) => void
}) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const live = isLive(event)
  const meta = [formatPrice(event), formatCrowd(event), event.age_restriction].filter(Boolean)

  return (
    <li ref={ref}>
      <article
        className={clsx(
          'flex gap-3 rounded-lg border bg-card p-3 transition-colors',
          active ? 'border-foreground' : 'border-border hover:border-muted-foreground',
        )}
      >
        <div
          className="flex size-12 shrink-0 flex-col items-center justify-center rounded-md text-primary-foreground"
          style={{ background: heatColor(event.heat_score) }}
          aria-label={`Heat score ${event.heat_score}`}
        >
          <span className="font-display text-lg font-bold leading-none">{event.heat_score}</span>
          <span className="text-[10px] uppercase tracking-wide">heat</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <button onClick={() => onSelect(event.id)} className="text-left">
            <h2 className="line-clamp-2 font-display font-semibold leading-snug text-pretty">{event.title}</h2>
          </button>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className={clsx(live && 'font-semibold text-primary')}>{formatWhen(event)}</span>
            {event.venue_name && <span className="truncate">· {event.venue_name}</span>}
            <span>· {event.distance_km.toFixed(1)} km</span>
          </p>
          {event.status !== 'scheduled' && (
            <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase text-foreground">
              {event.status}
            </span>
          )}
          {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(' · ')}</p>}
        </div>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => onToggleStar(event.id)}
            disabled={!canStar}
            title={canStar ? undefined : 'Sign in with Flow to save events'}
            aria-pressed={starred}
            aria-label={starred ? 'Unsave event' : 'Save event'}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Star className={clsx('size-5', starred && 'fill-accent text-accent')} />
          </button>
          {event.ticket_url && (
            <a
              href={event.ticket_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Tickets"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <Ticket className="size-5" />
            </a>
          )}
        </div>
      </article>
    </li>
  )
}
