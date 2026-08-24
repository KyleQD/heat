/**
 * HEAT domain — canonical, provider-independent vocabulary.
 *
 * These enums are the single source of truth for the canonical HEAT event
 * model. Provider-specific values are mapped into these by ingestion adapters
 * and never leak past the API boundary (ADR: provider independence).
 */

/** Canonical top-level event category keys (seeded via migration). */
export const EVENT_CATEGORY_KEYS = [
  "music",
  "nightlife",
  "festival",
  "sports",
  "food",
  "arts",
  "community",
  "convention",
  "party",
  "other",
] as const;
export type EventCategoryKey = (typeof EVENT_CATEGORY_KEYS)[number];

/**
 * Explicit lifecycle status of a canonical event.
 * Derived runtime state (upcoming/active/...) is computed from time and is
 * separate; explicit status always takes precedence over derived time state.
 */
export const EVENT_STATUSES = [
  "scheduled",
  "canceled",
  "postponed",
  "moved",
  "completed",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Visibility / moderation state. Hidden or removed events never render publicly. */
export const VISIBILITY_STATUSES = [
  "published",
  "hidden",
  "removed",
  "pending_review",
] as const;
export type VisibilityStatus = (typeof VISIBILITY_STATUSES)[number];

/** Trust/verification ladder surfaced as a display badge (never a public numeric score). */
export const VERIFICATION_LEVELS = [
  "community",
  "source_verified",
  "multi_source_verified",
  "claimed",
  "verified_organizer",
  "verified_venue",
  "staff_verified",
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** Consumer-facing confidence labels. Internal numeric confidence stays 0-100 server-side. */
export const CONFIDENCE_LABELS = [
  "estimated",
  "medium",
  "high",
  "verified_live",
] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

/** Trend language (doc 02 §9). Derived separately from the raw HEAT score. */
export const TREND_LABELS = [
  "upcoming",
  "warming_up",
  "heating_up",
  "surging",
  "hot",
  "peaking",
  "steady",
  "cooling_down",
  "ending",
] as const;
export type TrendLabel = (typeof TREND_LABELS)[number];

/** Derived runtime phase used for lifecycle time-weighting in scoring. */
export const LIFECYCLE_PHASES = [
  "far_future",
  "today_pre_event",
  "soon",
  "starting",
  "active",
  "ending",
  "ended",
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

/** Map time windows supported in V1. */
export const TIME_WINDOWS = ["now", "tonight"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

/** Travel modes for GO/routing. Providers may not support all modes. */
export const TRAVEL_MODES = ["drive", "walk", "transit", "bike"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

/** External navigation providers for handoff. */
export const NAVIGATION_PROVIDERS = ["apple_maps", "google_maps"] as const;
export type NavigationProvider = (typeof NAVIGATION_PROVIDERS)[number];

/** Source providers that can attach evidence to a canonical event. `native` covers user creation. */
export const SOURCE_PROVIDERS = [
  "native",
  "ticketmaster",
  "seatgeek",
  "predicthq",
  "places",
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/** Attendance estimate types (doc 45 engine spec enum, authoritative). */
export const ATTENDANCE_ESTIMATE_TYPES = [
  "unknown",
  "pre_event_forecast",
  "intent_adjusted_forecast",
  "live_estimate",
  "organizer_reported",
  "verified_count",
] as const;
export type AttendanceEstimateType = (typeof ATTENDANCE_ESTIMATE_TYPES)[number];

/** Report reason codes (moderation spec §13.3). */
export const REPORT_REASONS = [
  "duplicate",
  "fake_event",
  "canceled",
  "postponed",
  "wrong_location",
  "wrong_time",
  "wrong_venue",
  "scam_ticket_link",
  "unsafe_location",
  "inappropriate_content",
  "impersonation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Interaction types recorded on canonical events (first-party intent telemetry). */
export const INTERACTION_TYPES = [
  "impression",
  "select",
  "expand",
  "star",
  "unstar",
  "ticket_click",
  "route_preview",
  "navigation_start",
  "create_duplicate_view",
  "report",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/**
 * Stable public error codes. Clients branch on these; messages are cosmetic.
 * Never expose internal diagnostics through codes.
 */
export const ERROR_CODES = [
  "INVALID_REQUEST",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "EVENT_NOT_FOUND",
  "VENUE_NOT_FOUND",
  "DUPLICATE_EVENT_LIKELY",
  "ROUTE_UNAVAILABLE",
  "PROVIDER_UNAVAILABLE",
  "LOCATION_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** HEAT model identity. Score/config changes ship via new versions without mobile releases. */
export const SCORING_MODEL_VERSION = "heat-v0.1-engine";
export const MARKER_PRIORITY_VERSION = "marker-priority-v1";
