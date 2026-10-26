export type HeatEvent = {
  id: string
  slug: string
  title: string
  description: string | null
  category: string
  venue_name: string | null
  venue_address: string | null
  lat: number
  lng: number
  starts_at: string
  ends_at: string | null
  status: 'scheduled' | 'canceled' | 'postponed'
  heat_score: number
  confidence: number | null
  attendance_low: number | null
  attendance_high: number | null
  price_min: number | null
  price_max: number | null
  ticket_url: string | null
  age_restriction: string | null
  verification: string
  source: 'heat' | 'flow' | 'tourify'
  star_count: number
  distance_km: number
}

export type TimeWindow = 'now' | 'tonight' | 'week'

export const TIME_WINDOWS: { id: TimeWindow; label: string }[] = [
  { id: 'now', label: 'Happening now' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'week', label: 'This week' },
]

export const DEFAULT_LOCATION = { lat: 36.1255, lng: -115.1688, label: 'Las Vegas' }

export function windowRange(window: TimeWindow, now = new Date()) {
  const from = new Date(now)
  const to = new Date(now)
  if (window === 'now') {
    to.setHours(to.getHours() + 2)
  } else if (window === 'tonight') {
    to.setHours(to.getHours() + 18)
  } else {
    to.setDate(to.getDate() + 7)
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

export function isLive(event: HeatEvent, now = Date.now()) {
  const start = new Date(event.starts_at).getTime()
  const end = event.ends_at ? new Date(event.ends_at).getTime() : start + 4 * 3600_000
  return event.status === 'scheduled' && start <= now && end >= now
}

export function heatColor(score: number) {
  if (score >= 80) return 'var(--primary)'
  if (score >= 50) return 'var(--accent)'
  return 'var(--muted-foreground)'
}

export function formatWhen(event: HeatEvent) {
  const start = new Date(event.starts_at)
  if (isLive(event)) return 'Live now'
  const sameDay = start.toDateString() === new Date().toDateString()
  const time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  return `${start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}

export function formatPrice(event: HeatEvent) {
  if (event.price_min == null) return null
  if (event.price_max == null || event.price_max === event.price_min) return `$${event.price_min}`
  return `$${event.price_min}–$${event.price_max}`
}

export function formatCrowd(event: HeatEvent) {
  if (event.attendance_low == null || event.attendance_high == null) return null
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`)
  return `${fmt(event.attendance_low)}–${fmt(event.attendance_high)} expected`
}
