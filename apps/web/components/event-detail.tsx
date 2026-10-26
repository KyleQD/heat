'use client'

import { ArrowLeft, Bookmark, MapPin, Minus, Navigation, Plus, Ticket, Users, X } from 'lucide-react'
import { useState } from 'react'
import {
  TIER_LABEL,
  compact,
  formatClock,
  formatDistance,
  formatHour,
  formatPrice,
  formatStartsIn,
  heatTier,
  signalsAt,
} from '@/lib/heat'
import type { ScoredEvent } from '@/components/heat-map'

function BusyChart({ curve, highlight, startHour, endHour }: { curve: number[]; highlight: number; startHour: number; endHour: number }) {
  const inWindow = (h: number) => (startHour <= endHour ? h >= startHour && h <= endHour : h >= startHour || h <= endHour)
  const hours = Array.from({ length: 24 }, (_, i) => (i + 12) % 24)
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">Usually busy</span>
        <span className="text-xs text-muted-foreground">Venue history · last 12 weeks</span>
      </figcaption>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label={`Busiest around ${formatHour(curve.indexOf(Math.max(...curve)))}`}>
        {hours.map((h) => (
          <div
            key={h}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${Math.max(6, curve[h] * 100)}%`,
              background: h === highlight ? 'var(--primary)' : inWindow(h) ? 'var(--heat-dim)' : 'var(--muted)',
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>12p</span>
        <span>6p</span>
        <span>12a</span>
        <span>6a</span>
        <span>11a</span>
      </div>
    </figure>
  )
}

function Signal({ label, value, detail, pct }: { label: string; value: string; detail: string; pct: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-display text-lg font-semibold leading-none text-foreground">{value}</span>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <span className="text-xs leading-snug text-muted-foreground">{detail}</span>
    </div>
  )
}

function Checkout({ event, onClose }: { event: ScoredEvent; onClose: () => void }) {
  const tiers = [
    { id: 'ga', name: 'General admission', price: event.priceMin ?? 0 },
    ...(event.priceMax && event.priceMax !== event.priceMin
      ? [{ id: 'vip', name: 'VIP', price: event.priceMax }]
      : []),
  ]
  const [tier, setTier] = useState(tiers[0].id)
  const [qty, setQty] = useState(2)
  const [done, setDone] = useState(false)
  const price = tiers.find((t) => t.id === tier)!.price
  const fees = Math.round(price * qty * 0.12 * 100) / 100
  const remaining = event.capacity && event.ticketsSold != null ? event.capacity - event.ticketsSold : null

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Ticket className="size-6" aria-hidden />
        </div>
        <p className="font-display text-xl font-semibold text-foreground">{"You're going"}</p>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          {qty} × {tiers.find((t) => t.id === tier)!.name} for {event.title}. In the live app, tickets land in your Flow
          wallet.
        </p>
        <p className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">Demo — no card was charged</p>
        <button type="button" onClick={onClose} className="mt-1 h-11 w-full rounded-lg border border-border text-sm font-medium text-foreground">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-foreground">Get tickets</h3>
        <button type="button" onClick={onClose} aria-label="Close checkout" className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Ticket type</legend>
        {tiers.map((t) => (
          <label
            key={t.id}
            className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 has-checked:border-primary has-checked:bg-primary/10"
          >
            <span className="flex items-center gap-3">
              <input type="radio" name="tier" value={t.id} checked={tier === t.id} onChange={() => setTier(t.id)} className="accent-[var(--primary)]" />
              <span className="text-sm font-medium text-foreground">{t.name}</span>
            </span>
            <span className="text-sm text-foreground">{t.price === 0 ? 'Free' : `$${t.price}`}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center justify-between">
        <span className="text-sm text-foreground">Quantity</span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Fewer tickets" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground disabled:opacity-40" disabled={qty <= 1}>
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="w-8 text-center font-display text-lg font-semibold tabular-nums text-foreground" aria-live="polite">
            {qty}
          </span>
          <button type="button" aria-label="More tickets" onClick={() => setQty((q) => Math.min(8, q + 1))} className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground disabled:opacity-40" disabled={qty >= 8}>
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {remaining != null && remaining < 500 && (
        <p className="text-sm text-accent">Only {compact(Math.max(remaining, 3))} left at this price</p>
      )}
      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Fees</span>
          <span>${fees.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-semibold text-foreground">
          <span>Total</span>
          <span>${(price * qty + fees).toFixed(2)}</span>
        </div>
      </div>
      <button type="button" onClick={() => setDone(true)} className="h-12 rounded-lg bg-primary text-base font-semibold text-primary-foreground">
        Pay with Flow
      </button>
    </div>
  )
}

export function EventDetail({
  event,
  t,
  origin,
  demo,
  saved,
  onToggleSave,
  onBack,
}: {
  event: ScoredEvent
  t: number
  origin: { lat: number; lng: number }
  demo: boolean
  saved: boolean
  onToggleSave: () => void
  onBack: () => void
}) {
  const [checkout, setCheckout] = useState(false)
  const signals = signalsAt(event, t)
  const tier = heatTier(event.score)
  const km = Math.hypot((event.lat - origin.lat) * 110.574, (event.lng - origin.lng) * 111.32 * Math.cos((origin.lat * Math.PI) / 180))
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${event.lat},${event.lng}`
  const bookable = event.status === 'scheduled' && event.ticketUrl

  return (
    <article className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="-ml-2 flex h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          All events
        </button>
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save event'}
          className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground aria-pressed:text-primary"
        >
          <Bookmark className="size-5" fill={saved ? 'currentColor' : 'none'} aria-hidden />
        </button>
      </div>

      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span className="heat-chip" data-tier={tier}>
            {event.score} · {TIER_LABEL[tier]}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 capitalize text-muted-foreground">{event.category}</span>
          {event.ageRestriction && <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{event.ageRestriction}</span>}
        </div>
        <h2 className="text-balance font-display text-2xl font-bold leading-tight text-foreground">{event.title}</h2>
        <p className="text-sm text-muted-foreground">
          <span className={event.live ? 'font-semibold text-primary' : 'text-foreground'}>{formatStartsIn(event, t)}</span> ·{' '}
          {formatClock(event.startsAt)}–{formatClock(event.endsAt)}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venueName ?? 'Location pinned'}
            {event.venueAddress ? ` · ${event.venueAddress}` : ''} · {formatDistance(km)}
          </span>
        </p>
      </header>

      {checkout ? (
        <Checkout event={event} onClose={() => setCheckout(false)} />
      ) : (
        <div className="flex gap-2">
          {bookable ? (
            demo || event.ticketUrl === '#demo-checkout' ? (
              <button type="button" onClick={() => setCheckout(true)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground">
                <Ticket className="size-5" aria-hidden />
                Tickets · {formatPrice(event)}
              </button>
            ) : (
              <a href={event.ticketUrl!} target="_blank" rel="noopener noreferrer" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground">
                <Ticket className="size-5" aria-hidden />
                Tickets · {formatPrice(event)}
              </a>
            )
          ) : (
            <div className="flex h-12 flex-1 items-center justify-center rounded-lg bg-muted text-sm font-medium text-muted-foreground">
              {event.status === 'scheduled' ? `${formatPrice(event)} · No tickets needed` : `This event is ${event.status}`}
            </div>
          )}
          <a href={directions} target="_blank" rel="noopener noreferrer" aria-label="Get directions" className="flex size-12 items-center justify-center rounded-lg border border-border text-foreground">
            <Navigation className="size-5" aria-hidden />
          </a>
        </div>
      )}

      {signals.sellThrough != null && signals.velocity != null && signals.historical != null && (
        <section aria-labelledby="why-hot" className="flex flex-col gap-3">
          <h3 id="why-hot" className="text-sm font-medium text-foreground">
            Why {"it's"} {TIER_LABEL[tier].toLowerCase()}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <Signal
              label="Sold"
              value={`${Math.round(signals.sellThrough * 100)}%`}
              detail={`${compact(event.ticketsSold!)} of ${compact(event.capacity!)}`}
              pct={signals.sellThrough}
            />
            <Signal
              label="Momentum"
              value={`+${compact(event.salesLastHour!)}`}
              detail="tickets last hour"
              pct={signals.velocity}
            />
            <Signal
              label="Usual crowd"
              value={`${Math.round(signals.historical * 100)}%`}
              detail={`at ${formatHour(new Date(t).getHours())}`}
              pct={signals.historical}
            />
          </div>
        </section>
      )}

      {event.busyCurve && (
        <BusyChart
          curve={event.busyCurve}
          highlight={new Date(t).getHours()}
          startHour={new Date(event.startsAt).getHours()}
          endHour={new Date(event.endsAt).getHours()}
        />
      )}

      {event.description && <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{event.description}</p>}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="size-4" aria-hidden />
        {compact(event.saves)} people saved this
      </p>
    </article>
  )
}
