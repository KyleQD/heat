/**
 * Phase D — Ticketmaster adapter (P7).
 *
 * Contract: fetch → raw evidence → NORMALIZE into NormalizedExternalEvent →
 * resolution. Provider payloads never become canonical rows directly and never
 * reach mobile. Runs only when the `ticketmaster_enabled` flag is on; the
 * transport is injectable so tests run entirely from fixtures.
 */
import { EVENT_CATEGORY_KEYS, type EventCategoryKey } from "@heat/domain";

/** Doc 40 — normalized intermediate record. Disposable; NOT canonical. */
export interface NormalizedExternalEvent {
  provider: "ticketmaster";
  externalId: string;
  title: string;
  normalizedTitle: string;
  startsAtUtc: string | null;
  startsAtPrecision: "exact" | "time_tbd" | "date_tbd" | "date_only";
  endsAtUtc: string | null;
  status: "scheduled" | "canceled" | "postponed" | "moved";
  lat: number | null;
  lng: number | null;
  venueTmId: string | null;
  venueName: string | null;
  category: EventCategoryKey;
  ticketUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  imageUrl: string | null;
  sourceConfidence: number;
  /** Reference to the stored raw payload row — never inlined downstream. */
  rawRef: string;
}

// ---------------------------------------------------------------------------
// Normalization (pure, fixture-testable)
// ---------------------------------------------------------------------------

interface TmClassificationSegment {
  name?: string;
}
interface TmEmbeddedVenue {
  id?: string;
  name?: string;
  location?: { latitude?: string; longitude?: string };
  city?: { name?: string };
  state?: { stateCode?: string };
}
interface TmEvent {
  id: string;
  name?: string;
  dates?: {
    start?: { localDate?: string; localTime?: string; dateTime?: string; noSpecificTime?: boolean };
    end?: { dateTime?: string };
    status?: { code?: string };
  };
  classifications?: Array<{ segment?: TmClassificationSegment; genre?: TmClassificationSegment }>;
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  url?: string;
  images?: Array<{ url: string; width?: number }>;
  _embedded?: { venues?: TmEmbeddedVenue[] };
}

const CATEGORY_MAP: Record<string, EventCategoryKey> = {
  Music: "music",
  Sports: "sports",
  "Arts & Theatre": "arts",
  "Film": "arts",
  "Nightlife": "nightlife",
  "Comedy": "arts",
};

function mapCategory(tm: TmEvent): EventCategoryKey {
  const segment = tm.classifications?.[0]?.segment?.name;
  if (segment && CATEGORY_MAP[segment]) return CATEGORY_MAP[segment]!;
  return "other";
}

function mapStatus(code: string | undefined): NormalizedExternalEvent["status"] {
  switch ((code ?? "").toLowerCase()) {
    case "cancelled": case "canceled": return "canceled";
    case "postponed": return "postponed";
    case "rescheduled": return "moved";
    default: return "scheduled";
  }
}

export function normalizeTmEvent(raw: TmEvent, rawRef: string): NormalizedExternalEvent | null {
  if (!raw.id || !raw.name) return null;

  const start = raw.dates?.start;
  let precision: NormalizedExternalEvent["startsAtPrecision"] = "exact";
  let startsAtUtc: string | null = null;
  if (start?.dateTime) {
    startsAtUtc = new Date(start.dateTime).toISOString();
  } else if (start?.localDate) {
    startsAtUtc = null; // date-only kept as date precision without inventing a time
    precision = start.noSpecificTime ? "date_tbd" : "date_only";
  } else {
    precision = "time_tbd";
  }

  const venue = raw._embedded?.venues?.[0];
  const lat = venue?.location?.latitude != null ? Number(venue.location.latitude) : null;
  const lng = venue?.location?.longitude != null ? Number(venue.location.longitude) : null;
  const price = raw.priceRanges?.[0];

  const title = raw.name.trim();
  return {
    provider: "ticketmaster",
    externalId: raw.id,
    title,
    normalizedTitle: title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim(),
    startsAtUtc,
    startsAtPrecision: precision,
    endsAtUtc: raw.dates?.end?.dateTime ? new Date(raw.dates.end.dateTime).toISOString() : null,
    status: mapStatus(raw.dates?.status?.code),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    venueTmId: venue?.id ?? null,
    venueName: venue?.name ?? null,
    category: mapCategory(raw),
    ticketUrl: raw.url ?? null,
    priceMin: price?.min ?? null,
    priceMax: price?.max ?? null,
    currency: price?.currency ?? null,
    imageUrl: raw.images?.slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
    sourceConfidence: 0.9, // primary official source per doc 41 precedence class 3
    rawRef,
  };
}

// ---------------------------------------------------------------------------
// Fetch (transport injectable for fixtures)
// ---------------------------------------------------------------------------

export interface TmFetchResult {
  events: Array<{ raw: unknown; normalized: NormalizedExternalEvent | null }>;
  requestCount: number;
  rateLimitEvents: number;
}

export async function fetchTicketmasterEvents(
  opts: { apiKey: string | undefined; cityKey: string; page?: number },
  transport?: (url: string) => Promise<unknown>,
): Promise<TmFetchResult> {
  if (!opts.apiKey || !transport) {
    return { events: [], requestCount: 0, rateLimitEvents: 0 };
  }
  const url =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?city=${encodeURIComponent("Las Vegas")}&countryCode=US&size=200&page=${opts.page ?? 0}` +
    `&apikey=${opts.apiKey}`;
  const payload = (await transport(url)) as { _embedded?: { events?: TmEvent[] } };
  const raws = payload._embedded?.events ?? [];
  return {
    events: raws.map((raw) => ({
      raw,
      normalized: normalizeTmEvent(raw, `tm:${raw.id}`),
    })),
    requestCount: 1,
    rateLimitEvents: 0,
  };
}
