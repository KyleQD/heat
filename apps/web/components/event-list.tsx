'use client'

import clsx from 'clsx'
import { TIER_LABEL, formatPrice, formatStartsIn, heatTier } from '@/lib/heat'
import type { ScoredEvent } from '@/components/heat-map'

export type Filter = 'all' | 'live' | 'soon' | 'nightlife' | 'music' | 'sports' | 'arts'

export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live now' },
  { id: 'soon', label: 'Starting soon' },
  { id: 'nightlife', label: 'Nightlife' },
  { id: 'music', label: 'Music' },
  { id: 'sports', label: 'Sports' },
  { id: 'arts', label: 'Arts' },
]

export function FilterChips({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  return (
    <div role="radiogroup" aria-label="Filter events" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="radio"
          aria-checked={value === f.id}
          onClick={() => onChange(f.id)}
          className="h-9 shrink-0 rounded-full border border-border px-3.5 text-sm font-medium text-muted-foreground transition-colors aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background"
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

export function EventRow({
  event,
  t,
  rank,
  onSelect,
}: {
  event: ScoredEvent
  t: number
  rank: number
  onSelect: (id: string) => void
}) {
  const tier = heatTier(event.score)
  const inactive = event.status !== 'scheduled'
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(event.id)}
        className={clsx(
          'flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60',
          inactive && 'opacity-50',
        )}
      >
        <div className="heat-score" data-tier={tier} aria-label={`Heat ${event.score}, ${TIER_LABEL[tier]}`}>
          <span className="font-display text-lg font-bold leading-none tabular-nums">{event.score}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">{event.title}</span>
          <span className="truncate text-sm text-muted-foreground">
            {event.venueName ?? 'Pinned location'} · {formatPrice(event)}
          </span>
          <span className={clsx('text-xs font-medium', event.live ? 'text-primary' : 'text-muted-foreground')}>
            {event.live && <span className="live-dot mr-1.5" aria-hidden />}
            {formatStartsIn(event, t)}
          </span>
        </div>
        <span className="sr-only">Rank {rank}</span>
      </button>
    </li>
  )
}
