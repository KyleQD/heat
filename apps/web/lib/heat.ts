import type { HeatEvent } from '@/lib/events'

export type Category = 'music' | 'nightlife' | 'sports' | 'arts' | 'food' | 'festival' | 'community' | 'party' | 'convention' | 'other'

export type SpotEvent = {
  id: string
  title: string
  description: string | null
  category: Category | string
  venueName: string | null
  venueAddress: string | null
  lat: number
  lng: number
  startsAt: number
  endsAt: number
  status: 'scheduled' | 'canceled' | 'postponed'
  capacity: number | null
  ticketsSold: number | null
  salesLastHour: number | null
  /** 24 values, 0–1: how busy this venue usually is at each hour of the day. */
  busyCurve: number[] | null
  priceMin: number | null
  priceMax: number | null
  ticketUrl: string | null
  ageRestriction: string | null
  verification: string
  /** Used when sales/history signals are unavailable (live rows from the HEAT DB). */
  baseScore: number | null
  saves: number
}

export type HeatSignals = {
  score: number
  presence: number
  sellThrough: number | null
  velocity: number | null
  historical: number | null
}

const HOUR = 3_600_000
const LEAD_IN = 3 * HOUR

/** 1 while running, ramps up over the 3h before start, 0 once it's over. */
export function presenceAt(event: SpotEvent, t: number) {
  if (event.status !== 'scheduled') return 0
  if (t >= event.startsAt && t <= event.endsAt) return 1
  if (t < event.startsAt && event.startsAt - t <= LEAD_IN) return 0.7 * (1 - (event.startsAt - t) / LEAD_IN)
  return 0
}

export function signalsAt(event: SpotEvent, t: number): HeatSignals {
  const presence = presenceAt(event, t)
  const hour = new Date(t).getHours()
  const sellThrough =
    event.capacity && event.ticketsSold != null ? Math.min(1, event.ticketsSold / event.capacity) : null
  const velocity =
    event.capacity && event.salesLastHour != null ? Math.min(1, event.salesLastHour / (event.capacity * 0.03)) : null
  const historical = event.busyCurve ? event.busyCurve[hour] : null

  let base: number
  if (sellThrough != null && velocity != null && historical != null) {
    base = 0.45 * sellThrough + 0.2 * velocity + 0.35 * historical
  } else {
    base = (event.baseScore ?? 30) / 100
  }
  const score = event.status === 'scheduled' ? Math.round(100 * base * (0.35 + 0.65 * presence)) : 0
  return { score, presence, sellThrough, velocity, historical }
}

export type Moment = 'live' | 'soon' | 'later' | 'ended' | 'canceled' | 'postponed'

export function momentAt(event: SpotEvent, t: number): Moment {
  if (event.status === 'canceled') return 'canceled'
  if (event.status === 'postponed') return 'postponed'
  if (t > event.endsAt) return 'ended'
  if (t >= event.startsAt) return 'live'
  if (event.startsAt - t <= 2 * HOUR) return 'soon'
  return 'later'
}

/** Events worth showing at time t: running, or starting within the next 6 hours. */
export function isRelevantAt(event: SpotEvent, t: number) {
  return event.endsAt >= t && event.startsAt <= t + 6 * HOUR
}

export function heatTier(score: number): 'blazing' | 'hot' | 'warm' | 'cool' {
  if (score >= 75) return 'blazing'
  if (score >= 55) return 'hot'
  if (score >= 30) return 'warm'
  return 'cool'
}

export const TIER_LABEL = { blazing: 'Blazing', hot: 'Hot', warm: 'Warming up', cool: 'Quiet' } as const

export function formatClock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatHour(hour: number) {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'a' : 'p'}`
}

export function formatStartsIn(event: SpotEvent, t: number) {
  const moment = momentAt(event, t)
  if (moment === 'canceled') return 'Canceled'
  if (moment === 'postponed') return 'Postponed'
  if (moment === 'ended') return 'Ended'
  if (moment === 'live') {
    const left = Math.round((event.endsAt - t) / 60_000)
    return left < 60 ? `Live · ends in ${left}m` : `Live · until ${formatClock(event.endsAt)}`
  }
  const mins = Math.round((event.startsAt - t) / 60_000)
  if (mins < 60) return `Starts in ${mins}m`
  const sameDay = new Date(event.startsAt).toDateString() === new Date(t).toDateString()
  if (sameDay) return `Starts ${formatClock(event.startsAt)}`
  return `${new Date(event.startsAt).toLocaleDateString([], { weekday: 'short' })} ${formatClock(event.startsAt)}`
}

export function formatPrice(event: SpotEvent) {
  if (event.priceMin == null) return 'Free'
  if (event.priceMax == null || event.priceMax === event.priceMin) return `$${event.priceMin}`
  return `$${event.priceMin}–${event.priceMax}`
}

export function compact(n: number) {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export function formatDistance(km: number) {
  const mi = km * 0.621371
  return mi < 0.2 ? `${Math.round(mi * 5280)} ft` : `${mi.toFixed(1)} mi`
}

export function fromHeatEvent(event: HeatEvent): SpotEvent {
  const startsAt = new Date(event.starts_at).getTime()
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    lat: event.lat,
    lng: event.lng,
    startsAt,
    endsAt: event.ends_at ? new Date(event.ends_at).getTime() : startsAt + 4 * HOUR,
    status: event.status,
    capacity: event.attendance_high,
    ticketsSold: null,
    salesLastHour: null,
    busyCurve: null,
    priceMin: event.price_min,
    priceMax: event.price_max,
    ticketUrl: event.ticket_url,
    ageRestriction: event.age_restriction,
    verification: event.verification,
    baseScore: event.heat_score,
    saves: Number(event.star_count ?? 0),
  }
}
