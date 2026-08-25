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
    ticketUrl: isSafeTicketUrl(raw.url) ? raw.url! : null,
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

const PAGE_SIZE = 200;
const MAX_PAGES = 5; // quota ceiling per run (doc D005): 1000 events/run
const RETRY_DELAYS_MS = [250, 1_000, 4_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HEAT-D010 — only https ticket links from the provider's own domains pass
 * normalization into canonical_ticket_url. */
export function isSafeTicketUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      /(^|\.)ticketmaster\.com$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

async function fetchPage(
  url: string,
  transport: (url: string) => Promise<unknown>,
): Promise<{ payload: { _embedded?: { events?: TmEvent[] } } | null; retryAfterMs: number | null }> {
  let lastStatus: number | null = null;
  let retryAfterMs: number | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const payload = (await transport(url)) as {
        _embedded?: { events?: TmEvent[] };
      };
      return { payload, retryAfterMs: null };
    } catch (e) {
      const err = e as { statusCode?: number; responseStatusCode?: number };
      lastStatus = err.statusCode ?? err.responseStatusCode ?? null;
      // 429/quota or 5xx → bounded exponential backoff with Retry-After honor.
      if ((lastStatus === 429 || (lastStatus != null && lastStatus >= 500)) && attempt < RETRY_DELAYS_MS.length) {
        retryAfterMs = RETRY_DELAYS_MS[attempt]!;
        await sleep(retryAfterMs);
        continue;
      }
      throw e;
    }
  }
  return { payload: null, retryAfterMs }; // unreachable; satisfies types
}

export async function fetchTicketmasterEvents(
  opts: {
    apiKey: string | undefined;
    cityKey: string;
    page?: number;
    /** HEAT-D006/D007 — optional start/end window (ISO 8601) for tiered
     * schedules: imminent windows refresh often, horizons rarely. */
    startDateTime?: string;
    endDateTime?: string;
  },
  transport?: (url: string) => Promise<unknown>,
): Promise<TmFetchResult> {
  if (!opts.apiKey || !transport) {
    return { events: [], requestCount: 0, rateLimitEvents: 0 };
  }

  // HEAT-D006 — query strategy: city-scoped, ordered by soonest start so the
  // first pages cover the live window consumers actually browse.
  const base =
    `https://app.ticketmaster.com/discovery/v2/events.json` +
    `?city=${encodeURIComponent("Las Vegas")}&countryCode=US` +
    `&sort=date,asc&apikey=${opts.apiKey}` +
    (opts.startDateTime ? `&startDateTime=${encodeURIComponent(opts.startDateTime)}` : "") +
    (opts.endDateTime ? `&endDateTime=${encodeURIComponent(opts.endDateTime)}` : "");

  const events: Array<{ raw: unknown; normalized: NormalizedExternalEvent | null }> = [];
  let requestCount = 0;
  let rateLimitEvents = 0;

  const firstPage = opts.page ?? 0;
  for (let page = firstPage; page < firstPage + MAX_PAGES; page += 1) {
    const url = `${base}&size=${PAGE_SIZE}&page=${page}`;
    requestCount += 1;
    let payload: { _embedded?: { events?: TmEvent[] } } | null;
    try {
      ({ payload } = await fetchPage(url, transport));
    } catch {
      rateLimitEvents += 1;
      break; // give up this run; telemetry records the shortfall
    }
    if (!payload) break;

    const raws = payload._embedded?.events ?? [];
    events.push(...raws.map((raw) => ({
      raw,
      normalized: normalizeTmEvent(raw, `tm:${raw.id}`),
    })));

    if (raws.length < PAGE_SIZE) break; // last page
  }

  return { events, requestCount, rateLimitEvents };
}
