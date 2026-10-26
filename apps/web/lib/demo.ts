import type { SpotEvent } from '@/lib/heat'

type BusyPattern = 'club' | 'arena' | 'bar' | 'daytime' | 'theater' | 'market'

const PEAKS: Record<BusyPattern, [peakHour: number, width: number, floor: number]> = {
  club: [0.5, 3, 0.05],
  arena: [20, 2.5, 0.08],
  bar: [21, 3.5, 0.12],
  daytime: [14, 3, 0.05],
  theater: [20.5, 1.8, 0.06],
  market: [18.5, 2.5, 0.1],
}

function busyCurve(pattern: BusyPattern, jitter: number) {
  const [peak, width, floor] = PEAKS[pattern]
  return Array.from({ length: 24 }, (_, hour) => {
    const raw = Math.abs(hour - peak)
    const d = Math.min(raw, 24 - raw)
    const v = floor + (1 - floor) * Math.exp(-(d * d) / (2 * width * width))
    return Math.max(0, Math.min(1, v * (0.85 + jitter * 0.15)))
  })
}

type DemoVenue = {
  key: string
  name: string
  address: string
  /** Offset from the demo center, in km east/north. */
  dx: number
  dy: number
  capacity: number
  pattern: BusyPattern
}

const VENUES: DemoVenue[] = [
  { key: 'dome', name: 'The Dome', address: 'Arena District', dx: 0.1, dy: 0.05, capacity: 18000, pattern: 'arena' },
  { key: 'ember', name: 'Ember Room', address: 'The Strip', dx: 0.45, dy: 0.4, capacity: 2800, pattern: 'club' },
  { key: 'halo', name: 'Halo Nightclub', address: 'South Strip', dx: -0.6, dy: -1.05, capacity: 3200, pattern: 'club' },
  { key: 'velvet', name: 'Velvet Theater', address: 'Resort Row', dx: -0.15, dy: 0.25, capacity: 5500, pattern: 'theater' },
  { key: 'basement', name: 'Basement 9', address: 'North Strip', dx: 0.6, dy: 0.65, capacity: 1400, pattern: 'club' },
  { key: 'pool', name: 'Lagoon Pool Club', address: 'Center Strip', dx: -0.5, dy: 0.15, capacity: 3000, pattern: 'club' },
  { key: 'stadium', name: 'Desert Bowl Stadium', address: 'Stadium Way', dx: -1.4, dy: -3.9, capacity: 65000, pattern: 'arena' },
  { key: 'icehouse', name: 'Icehouse Arena', address: 'Arena Blvd', dx: -0.9, dy: -2.5, capacity: 20000, pattern: 'arena' },
  { key: 'country', name: 'Fremont Social', address: 'Downtown', dx: 2.6, dy: 5.2, capacity: 900, pattern: 'bar' },
  { key: 'containers', name: 'Container Yard', address: 'Downtown', dx: 2.5, dy: 4.85, capacity: 1200, pattern: 'market' },
  { key: 'lounge', name: 'Sand & Soul Lounge', address: 'West Side', dx: -2.9, dy: 2.95, capacity: 250, pattern: 'bar' },
  { key: 'warehouse', name: 'The Warehouse 15', address: 'Arts Corridor', dx: -1.6, dy: 2.2, capacity: 4000, pattern: 'theater' },
  { key: 'lanes', name: 'Strike Lanes', address: 'East Strip', dx: 1.05, dy: 0.3, capacity: 2000, pattern: 'bar' },
  { key: 'notes', name: 'Notes Comedy Club', address: 'Downtown', dx: 2.25, dy: 5.05, capacity: 400, pattern: 'theater' },
  { key: 'hall', name: 'Convention Hall', address: 'Paradise Rd', dx: 1.5, dy: 0.65, capacity: 50000, pattern: 'daytime' },
  { key: 'park', name: 'Sunset Park', address: 'Sunset Rd', dx: -2.0, dy: -0.9, capacity: 5000, pattern: 'daytime' },
  { key: 'arts', name: 'Arts Factory', address: 'Arts District', dx: 1.95, dy: 3.7, capacity: 350, pattern: 'market' },
  { key: 'ballroom', name: 'Valley Ballroom', address: 'West Sahara', dx: -3.6, dy: -0.4, capacity: 600, pattern: 'theater' },
]

type DemoEvent = {
  key: string
  venue: string
  title: string
  category: string
  /** Hours from now, can be negative (already running). */
  start: number
  duration: number
  fill: number
  velocity: number
  price: [number, number] | null
  age?: string
  status?: SpotEvent['status']
  description: string
  ticketed?: boolean
}

const EVENTS: DemoEvent[] = [
  { key: 'skyline', venue: 'dome', title: 'Neon Skyline World Tour', category: 'music', start: -1.25, duration: 3.5, fill: 0.97, velocity: 0.35, price: [89, 340], description: 'Arena-scale synth pop with a 360° light show. Final North American date.' },
  { key: 'midnight', venue: 'ember', title: 'Midnight Gold Residency', category: 'nightlife', start: -0.5, duration: 5.5, fill: 0.82, velocity: 0.9, price: [40, 120], age: '21+', description: 'Weekly house residency. Lines usually peak around 11:30 PM.' },
  { key: 'picnic', venue: 'park', title: 'Community Night Market', category: 'community', start: -2, duration: 4, fill: 0.4, velocity: 0.2, price: null, ticketed: false, description: 'Local makers, food trucks and live acoustic sets. Free entry.' },
  { key: 'trio', venue: 'lounge', title: 'Desert Soul Live Trio', category: 'music', start: 0.6, duration: 2.5, fill: 0.72, velocity: 0.55, price: [15, 25], description: 'Intimate soul and funk set in a 250-cap lounge.' },
  { key: 'afterdark', venue: 'halo', title: 'After Dark: Neon Nights', category: 'nightlife', start: 2.5, duration: 5, fill: 0.68, velocity: 0.75, price: [30, 100], age: '21+', description: 'Headline DJ set with a guest b2b at 1 AM.' },
  { key: 'kings', venue: 'icehouse', title: 'Valley Kings vs Coastal Sharks', category: 'sports', start: 1.5, duration: 3, fill: 0.93, velocity: 0.5, price: [65, 420], description: 'Rivalry night. Playoff seeding on the line.' },
  { key: 'vinyl', venue: 'country', title: 'Late Night Vinyl Sessions', category: 'party', start: 4, duration: 4, fill: 0.55, velocity: 0.45, price: [10, 20], description: 'All-vinyl disco and boogie until close.' },
  { key: 'rooftop', venue: 'containers', title: 'Open Decks Rooftop Social', category: 'party', start: 1, duration: 4, fill: 0.48, velocity: 0.3, price: [0, 10], description: 'Bring your USB, sign up at the door for a 30-minute slot.' },
  { key: 'wander', venue: 'warehouse', title: 'Wanderland Immersive', category: 'arts', start: -0.75, duration: 6, fill: 0.61, velocity: 0.4, price: [49, 99], description: 'Walk-through light and sound installation across 12 rooms.' },
  { key: 'standup', venue: 'notes', title: 'Standup Under the Lights', category: 'arts', start: 2, duration: 2, fill: 0.88, velocity: 0.65, price: [25, 45], age: '18+', description: 'Five comics, one headliner, two-drink minimum.' },
  { key: 'indie', venue: 'lanes', title: 'Strike & Sound: Indie Night', category: 'music', start: 3, duration: 3.5, fill: 0.64, velocity: 0.5, price: [20, 60], description: 'Three indie bands and bowling lanes open all night.' },
  { key: 'pool', venue: 'pool', title: 'Poolside Afterhours', category: 'nightlife', start: 5, duration: 5, fill: 0.58, velocity: 0.8, price: [30, 150], age: '21+', description: 'Heated pool, cabanas and a sunrise closing set.' },
  { key: 'basement', venue: 'basement', title: 'Basement Beats Vol. 12', category: 'nightlife', start: 2.75, duration: 5, fill: 0.77, velocity: 0.85, price: [35, 125], age: '21+', description: 'Techno all night in the low-ceiling room.' },
  { key: 'velvet', venue: 'velvet', title: 'Velvet Mic Residency Finale', category: 'music', start: 1.25, duration: 2.75, fill: 0.95, velocity: 0.6, price: [95, 450], description: 'The last night of the residency. Limited resale left.' },
  { key: 'twilight', venue: 'lanes', title: 'Twilight Sessions: Early Set', category: 'music', start: -0.3, duration: 2.2, fill: 0.7, velocity: 0.2, price: [15, 15], description: 'Acoustic opener set before Indie Night.' },
  { key: 'revue', venue: 'lounge', title: 'Red Rocks Revue', category: 'music', start: 4.5, duration: 2.5, fill: 0.35, velocity: 0.3, price: [12, 18], description: 'Americana songwriters round.' },
  { key: 'jazz', venue: 'ballroom', title: 'Midnight Quartet: Jazz Standards', category: 'music', start: 3.5, duration: 3, fill: 0.42, velocity: 0.25, price: [28, 60], description: 'An evening of standards and stories with special guests.' },
  { key: 'trucks', venue: 'arts', title: 'First Friday Food Truck Rally', category: 'food', start: 7, duration: 5, fill: 0.3, velocity: 0.15, price: null, ticketed: false, description: 'Forty trucks, three blocks, one very long dessert line.' },
  { key: 'summit', venue: 'hall', title: 'Silver State Tech Summit', category: 'convention', start: 14, duration: 8, fill: 0.74, velocity: 0.35, price: [199, 899], description: 'Day one keynotes and expo floor.' },
  { key: 'canyon', venue: 'stadium', title: 'Canyon Lights Music Festival', category: 'festival', start: 9, duration: 10, fill: 0.86, velocity: 0.7, price: [129, 899], description: 'Two stages, 24 artists, gates open at noon.' },
  { key: 'harbor', venue: 'notes', title: 'Harbor Lights Acoustic Evening', category: 'music', start: 3, duration: 2, fill: 0.2, velocity: 0, price: [20, 20], status: 'canceled', description: 'Canceled by the artist. Refunds issued automatically.' },
]

export const DEMO_CENTER = { lat: 36.1215, lng: -115.1739, label: 'Las Vegas Strip' }

function hash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

const QUARTER_HOUR = 15 * 60_000

/** A believable evening of events laid out around `center`, timed relative to `now`. */
export function buildDemoEvents(center: { lat: number; lng: number }, now: number): SpotEvent[] {
  const kmPerLng = 111.32 * Math.cos((center.lat * Math.PI) / 180)
  const venues = new Map(VENUES.map((v) => [v.key, v]))

  return EVENTS.map((e) => {
    const v = venues.get(e.venue)!
    const startsAt = Math.round((now + e.start * 3_600_000) / QUARTER_HOUR) * QUARTER_HOUR
    const capacity = v.capacity
    const ticketed = e.ticketed !== false
    return {
      id: `demo-${e.key}`,
      title: e.title,
      description: e.description,
      category: e.category,
      venueName: v.name,
      venueAddress: v.address,
      lat: center.lat + v.dy / 110.574,
      lng: center.lng + v.dx / kmPerLng,
      startsAt,
      endsAt: startsAt + e.duration * 3_600_000,
      status: e.status ?? 'scheduled',
      capacity,
      ticketsSold: Math.round(capacity * e.fill),
      salesLastHour: Math.round(capacity * 0.03 * e.velocity),
      busyCurve: busyCurve(v.pattern, hash(v.key)),
      priceMin: e.price?.[0] ?? null,
      priceMax: e.price?.[1] ?? null,
      ticketUrl: ticketed ? '#demo-checkout' : null,
      ageRestriction: e.age ?? null,
      verification: e.fill > 0.8 ? 'multi_source_verified' : 'source_verified',
      baseScore: null,
      saves: Math.round(40 + hash(e.key) * 900 * e.fill),
    }
  })
}
