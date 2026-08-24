/**
 * HEAT public API contracts — request/response schemas and stable error shape.
 *
 * These schemas are the single validation boundary for the /v1 API. Mobile
 * renders only from these canonical responses; raw provider payloads never
 * appear here.
 */
import { z } from "zod";
import {
  CONFIDENCE_LABELS,
  ERROR_CODES,
  EVENT_CATEGORY_KEYS,
  TIME_WINDOWS,
  TREND_LABELS,
  TRAVEL_MODES,
  VERIFICATION_LEVELS,
  ATTENDANCE_ESTIMATE_TYPES,
  NAVIGATION_PROVIDERS,
} from "@heat/domain";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .brand<"IsoDateTime">();
export type IsoDateTime = z.infer<typeof isoDateTime>;

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);

// ---------------------------------------------------------------------------
// Errors — stable code + message + requestId. Clients branch on `code`.
// ---------------------------------------------------------------------------

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().nullable(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---------------------------------------------------------------------------
// GET /v1/config
// ---------------------------------------------------------------------------

export const featureFlagsSchema = z.object({
  map_heat_layer_enabled: z.boolean(),
  native_event_creation_enabled: z.boolean(),
  stars_enabled: z.boolean(),
  routing_enabled: z.boolean(),
  ticketmaster_enabled: z.boolean(),
  seatgeek_enabled: z.boolean(),
  predicthq_enabled: z.boolean(),
  event_claims_enabled: z.boolean(),
  community_reports_enabled: z.boolean(),
  city_las_vegas_enabled: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const cityConfigSchema = z.object({
  cityKey: z.string(),
  displayName: z.string(),
  timezone: z.string(),
  center: z.object({ lat: latitude, lng: longitude }),
  bounds: z.object({
    north: latitude,
    south: latitude,
    east: longitude,
    west: longitude,
  }),
  enabled: z.boolean(),
  tonightStartHourLocal: z.number().int().min(0).max(23),
  tonightEndHourLocal: z.number().int().min(0).max(23),
  defaultZoom: z.number().min(1).max(25),
});

export const configResponseSchema = z.object({
  flags: featureFlagsSchema,
  cities: z.array(cityConfigSchema),
  scoringModelVersion: z.string(),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;

// ---------------------------------------------------------------------------
// GET /v1/map/events
// ---------------------------------------------------------------------------

export const mapEventsQuerySchema = z
  .object({
    north: z.coerce.number().min(-90).max(90),
    south: z.coerce.number().min(-90).max(90),
    east: z.coerce.number().min(-180).max(180),
    west: z.coerce.number().min(-180).max(180),
    zoom: z.coerce.number().min(1).max(25).default(15),
    window: z.enum(TIME_WINDOWS).default("now"),
    category: z.enum(EVENT_CATEGORY_KEYS).optional(),
    starredOnly: z.coerce.boolean().optional(),
    includeStarredState: z.coerce.boolean().optional(),
  })
  .refine((q) => q.north > q.south, { message: "north must be > south" })
  .refine((q) => q.east > q.west, { message: "east must be > west" });
export type MapEventsQuery = z.infer<typeof mapEventsQuerySchema>;

/** Summary marker record. Bounded; no descriptions/images/raw payloads. */
export const mapEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  lat: latitude,
  lng: longitude,
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable(),
  status: z.string(),
  category: z.string(),
  venueName: z.string().nullable(),
  heatScore: z.number().min(0).max(100),
  confidence: z.enum(CONFIDENCE_LABELS),
  trend: z.enum(TREND_LABELS),
  starCount: z.number().int().min(0),
  starred: z.boolean().nullable(),
  markerPriority: z.number().min(0).max(100),
  verificationLevel: z.enum(VERIFICATION_LEVELS),
});
export type MapEvent = z.infer<typeof mapEventSchema>;

export const heatPointSchema = z.object({
  lat: latitude,
  lng: longitude,
  weight: z.number().min(0).max(1),
});
export type HeatPoint = z.infer<typeof heatPointSchema>;

export const clusterSchema = z.object({
  lat: latitude,
  lng: longitude,
  count: z.number().int().min(2),
  maxHeatScore: z.number().min(0).max(100),
});
export type Cluster = z.infer<typeof clusterSchema>;

export const mapEventsResponseSchema = z.object({
  generatedAt: isoDateTime,
  window: z.object({
    label: z.enum(TIME_WINDOWS),
    start: isoDateTime,
    end: isoDateTime,
  }),
  viewport: z.object({
    north: latitude,
    south: latitude,
    east: longitude,
    west: longitude,
    zoom: z.number(),
  }),
  events: z.array(mapEventSchema).max(400),
  clusters: z.array(clusterSchema).max(200),
  heatPoints: z.array(heatPointSchema).max(400),
});
export type MapEventsResponse = z.infer<typeof mapEventsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /v1/events/:id
// ---------------------------------------------------------------------------

export const eventDetailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  verificationLevel: z.enum(VERIFICATION_LEVELS),
  visibilityStatus: z.string().optional(),
  venue: z
    .object({
      id: z.string().uuid().nullable(),
      name: z.string().nullable(),
      address: z.string().nullable(),
      locality: z.string().nullable(),
      capacity: z.number().int().positive().nullable(),
    })
    .nullable(),
  location: z.object({ lat: latitude, lng: longitude }),
  timezone: z.string(),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable(),
  startsAtPrecision: z.enum(["exact", "time_tbd", "date_tbd", "date_only"]),
  priceMin: z.number().positive().nullable(),
  priceMax: z.number().positive().nullable(),
  currency: z.string().nullable(),
  ticketUrl: z.string().url().nullable(),
  coverImageUrl: z.string().url().nullable(),
  ageRestriction: z.string().nullable(),
  heat: z.object({
    score: z.number().min(0).max(100),
    confidenceLabel: z.enum(CONFIDENCE_LABELS),
    trend: z.enum(TREND_LABELS),
    attendanceEstimate: z
      .object({
        low: z.number().int().min(0),
        high: z.number().int().min(0),
        type: z.enum(ATTENDANCE_ESTIMATE_TYPES),
        /** Consumer copy, e.g. "~1.2K–1.6K expected". Server-owned language. */
        displayText: z.string().nullable(),
      })
      .nullable(),
  }),
  stars: z.object({
    count: z.number().int().min(0),
    starredByViewer: z.boolean(),
    /** Aggregate velocity phrase e.g. "+38 in the last hour". */
    velocityPhrase: z.string().nullable(),
  }),
  routeDestination: z.object({ lat: latitude, lng: longitude }),
  canEdit: z.boolean(),
  canReport: z.boolean(),
  canClaim: z.boolean(),
  sourceCount: z.number().int().min(0),
});
export type EventDetailResponse = z.infer<typeof eventDetailResponseSchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  lat: latitude.optional(),
  lng: longitude.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const searchResultSchema = z.union([
  z.object({
    type: z.literal("event"),
    eventId: z.string().uuid(),
    title: z.string(),
    subtitle: z.string().nullable(),
    lat: latitude,
    lng: longitude,
    heatScore: z.number().min(0).max(100),
    startsAt: isoDateTime.nullable(),
  }),
  z.object({
    type: z.literal("venue"),
    venueId: z.string().uuid(),
    name: z.string(),
    locality: z.string().nullable(),
    lat: latitude,
    lng: longitude,
  }),
]);
export type SearchResultItem = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  events: z.array(searchResultSchema).max(20),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

export const starResponseSchema = z.object({
  eventId: z.string().uuid(),
  starred: z.boolean(),
  starCount: z.number().int().min(0),
});
export type StarResponse = z.infer<typeof starResponseSchema>;

export const starredEventItemSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string(),
  venueName: z.string().nullable(),
  startsAt: isoDateTime,
  lat: latitude,
  lng: longitude,
  heatScore: z.number().min(0).max(100),
  starredAt: isoDateTime,
});
export type StarredEventItem = z.infer<typeof starredEventItemSchema>;

export const starredEventsResponseSchema = z.object({
  items: z.array(starredEventItemSchema),
});
export type StarredEventsResponse = z.infer<typeof starredEventsResponseSchema>;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const routePreviewRequestSchema = z
  .object({
    eventId: z.string().uuid(),
    origin: z.object({ lat: latitude, lng: longitude }),
    modes: z.array(z.enum(TRAVEL_MODES)).min(1).max(4),
  })
  .refine(
    (r) =>
      Math.abs(r.origin.lat) <= 90 &&
      Math.abs(r.origin.lng) <= 180 &&
      (r.origin.lat !== 0 || r.origin.lng !== 0),
    { message: "origin out of range" },
  );
export type RoutePreviewRequest = z.infer<typeof routePreviewRequestSchema>;

export const routeOptionSchema = z.object({
  mode: z.enum(TRAVEL_MODES),
  durationSeconds: z.number().int().min(0),
  distanceMeters: z.number().int().min(0),
  /** Encoded polyline of preview geometry; may be null when provider omits it. */
  polyline: z.string().nullable(),
  provider: z.string(),
});
export type RouteOption = z.infer<typeof routeOptionSchema>;

export const routePreviewResponseSchema = z.object({
  routeRequestId: z.string().uuid(),
  routes: z.array(routeOptionSchema),
  destination: z.object({ lat: latitude, lng: longitude }),
  partial: z.boolean(),
});
export type RoutePreviewResponse = z.infer<typeof routePreviewResponseSchema>;

export const navigationStartRequestSchema = z.object({
  eventId: z.string().uuid(),
  mode: z.enum(TRAVEL_MODES),
  provider: z.enum(NAVIGATION_PROVIDERS),
  routeRequestId: z.string().uuid().nullable().optional(),
});
export type NavigationStartRequest = z.infer<typeof navigationStartRequestSchema>;

export const navigationStartResponseSchema = z.object({
  accepted: z.literal(true),
});

// ---------------------------------------------------------------------------
// Native event creation
// ---------------------------------------------------------------------------

export const createLocationSchema = z.object({
  lat: latitude,
  lng: longitude,
  /** Canonical venue to attach instead of a free coordinate. */
  venueId: z.string().uuid().nullable().optional(),
});

export const createEventRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(2000).optional(),
    category: z.enum(EVENT_CATEGORY_KEYS),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    location: createLocationSchema,
    ticketUrl: z.string().url().startsWith("https://").max(2048).nullable().optional(),
    priceMin: z.number().positive().max(100000).nullable().optional(),
    priceMax: z.number().positive().max(100000).nullable().optional(),
    currency: z.string().length(3).nullable().optional(),
  })
  .refine((r) => Date.parse(r.endsAt) >= Date.parse(r.startsAt), {
    message: "endsAt must be >= startsAt",
  })
  .refine(
    (r) => Date.parse(r.endsAt) - Date.parse(r.startsAt) <= 14 * 24 * 3600 * 1000,
    { message: "event duration exceeds 14 days" },
  )
  .refine(
    (r) => {
      const drift = Date.now() - Date.parse(r.startsAt);
      // start cannot be absurdly far in the past (> 6h already started is fine;
      // > 7 days past is rejected).
      return drift < 7 * 24 * 3600 * 1000;
    },
    { message: "startsAt too far in the past" },
  );
export type CreateEventRequest = z.infer<typeof createEventRequestSchema>;

export const duplicateCandidateSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string(),
  venueName: z.string().nullable(),
  startsAt: isoDateTime,
  distanceMeters: z.number().min(0).nullable(),
  matchConfidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const duplicateCheckRequestSchema = z.object({
  title: z.string().trim().min(3).max(140),
  category: z.enum(EVENT_CATEGORY_KEYS),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  location: createLocationSchema,
});
export type DuplicateCheckRequest = z.infer<typeof duplicateCheckRequestSchema>;

export const duplicateCheckResponseSchema = z.object({
  candidates: z.array(duplicateCandidateSchema).max(5),
});
export type DuplicateCheckResponse = z.infer<typeof duplicateCheckResponseSchema>;

export const createEventResponseSchema = z.object({
  event: eventDetailResponseSchema,
  trustLevel: z.literal("community"),
});
export type CreateEventResponse = z.infer<typeof createEventResponseSchema>;
