import Foundation

// MARK: - Canonical vocabulary (mirrors @heat/domain — provider-independent)

public enum EventCategory: String, Codable, CaseIterable, Sendable {
    case music, nightlife, festival, sports, food, arts, community, convention, party, other
}

/// Explicit lifecycle status. Takes precedence over derived time state.
public enum EventStatus: String, Codable, Sendable {
    case scheduled, canceled, postponed, moved, completed
}

public enum VerificationLevel: String, Codable, Sendable {
    case community
    case sourceVerified = "source_verified"
    case multiSourceVerified = "multi_source_verified"
    case claimed
    case verifiedOrganizer = "verified_organizer"
    case verifiedVenue = "verified_venue"
    case staffVerified = "staff_verified"

    public var displayText: String {
        switch self {
        case .community: return "Community"
        case .sourceVerified: return "Source verified"
        case .multiSourceVerified: return "Multi-source verified"
        case .claimed: return "Claimed"
        case .verifiedOrganizer: return "Verified organizer"
        case .verifiedVenue: return "Verified venue"
        case .staffVerified: return "Staff verified"
        }
    }
}

/// Consumer confidence labels. Never infer from score; never show raw %.
public enum ConfidenceLabel: String, Codable, Sendable {
    case estimated
    case medium
    case high
    case verifiedLive = "verified_live"

    public var displayText: String {
        switch self {
        case .estimated: return "Estimated"
        case .medium: return "Moderate confidence"
        case .high: return "High confidence"
        case .verifiedLive: return "Verified live count"
        }
    }
}

/// Trend language (mobile UX spec §9). Derived server-side separately from score.
public enum TrendLabel: String, Codable, Sendable {
    case upcoming
    case warmingUp = "warming_up"
    case heatingUp = "heating_up"
    case surging
    case hot
    case peaking
    case steady
    case coolingDown = "cooling_down"
    case ending

    public var displayText: String {
        switch self {
        case .upcoming: return "Upcoming"
        case .warmingUp: return "Warming up"
        case .heatingUp: return "Heating up"
        case .surging: return "Surging"
        case .hot: return "Hot"
        case .peaking: return "Peaking"
        case .steady: return "Steady"
        case .coolingDown: return "Cooling down"
        case .ending: return "Ending"
        }
    }
}

public enum TimeWindow: String, CaseIterable, Sendable {
    case now, tonight
    public var displayText: String { self == .now ? "Now" : "Tonight" }
}

public enum TravelMode: String, Codable, CaseIterable, Sendable {
    case drive, walk, transit, bike

    public var displayText: String {
        switch self {
        case .drive: return "Drive"
        case .walk: return "Walk"
        case .transit: return "Transit"
        case .bike: return "Bike"
        }
    }
}

public enum NavigationProvider: String, Codable, CaseIterable, Sendable {
    case appleMaps = "apple_maps"
    case googleMaps = "google_maps"
}

// MARK: - Wire models (/v1 canonical contracts)

public struct Coordinate: Codable, Hashable, Sendable {
    public let lat: Double
    public let lng: Double
    public init(lat: Double, lng: Double) { self.lat = lat; self.lng = lng }
}

/// Map marker summary. Deliberately bounded — no descriptions or raw payloads.
public struct MapEvent: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public let title: String
    public let lat: Double
    public let lng: Double
    public let startsAt: Date
    public let endsAt: Date?
    public let status: EventStatus
    public let category: EventCategory
    public let venueName: String?
    public let heatScore: Double
    public let confidence: ConfidenceLabel
    public let trend: TrendLabel
    public let starCount: Int
    /// Null when unauthenticated — the client must not assume a false "not starred".
    public let starred: Bool?
    public let markerPriority: Double
    public let verificationLevel: VerificationLevel
}

public struct HeatPoint: Codable, Hashable, Sendable {
    public let lat: Double
    public let lng: Double
    /// Visual weight 0..1 — server-owned transform f(HEAT)×g(significance).
    public let weight: Double
}

public struct ClusterPoint: Codable, Hashable, Sendable {
    public let lat: Double
    public let lng: Double
    public let count: Int
    public let maxHeatScore: Double
}

public struct MapEventsResponse: Codable, Sendable {
    public let generatedAt: Date
    public let events: [MapEvent]
    public let clusters: [ClusterPoint]
    public let heatPoints: [HeatPoint]
}

public struct AttendanceEstimate: Codable, Equatable, Sendable {
    public let low: Int
    public let high: Int
    public let type: String
    /// Server-owned copy, e.g. "~1.2K–1.6K expected". Nil means omit the row.
    public let displayText: String?
}

public struct EventDetailHeat: Codable, Equatable, Sendable {
    public let score: Double
    public let confidenceLabel: ConfidenceLabel
    public let trend: TrendLabel
    public let attendanceEstimate: AttendanceEstimate?
}

public struct EventStarsInfo: Codable, Equatable, Sendable {
    public let count: Int
    public let starredByViewer: Bool
    public let velocityPhrase: String?
}

public struct VenueSummary: Codable, Equatable, Sendable {
    public let id: UUID?
    public let name: String?
    public let address: String?
    public let locality: String?
    public let capacity: Int?
}

/// Canonical event detail (P4). Raw provider payloads never appear here.
public struct EventDetail: Identifiable, Codable, Equatable, Sendable {
    public let id: UUID
    public let title: String
    public let description: String?
    public let category: EventCategory
    public let status: EventStatus
    public let verificationLevel: VerificationLevel
    public let venue: VenueSummary?
    public let location: Coordinate
    public let timezone: String
    public let startsAt: Date
    public let endsAt: Date?
    public let startsAtPrecision: String
    public let priceMin: Double?
    public let priceMax: Double?
    public let currency: String?
    public let ticketUrl: URL?
    public let coverImageUrl: URL?
    public let ageRestriction: String?
    public let heat: EventDetailHeat
    public let stars: EventStarsInfo
    public let routeDestination: Coordinate
    public let canEdit: Bool
    public let canReport: Bool
    public let canClaim: Bool
    public let sourceCount: Int
}

public struct RouteOption: Codable, Hashable, Equatable, Sendable {
    public let mode: TravelMode
    public let durationSeconds: Int
    public let distanceMeters: Int
    public let polyline: String?
    public let provider: String
}

public struct RoutePreviewResponse: Codable, Equatable, Sendable {
    public let routeRequestId: UUID
    public let routes: [RouteOption]
    public let destination: Coordinate
    public let partial: Bool
}

public struct DuplicateCandidate: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID { eventId }
    public let eventId: UUID
    public let title: String
    public let venueName: String?
    public let startsAt: Date
    public let distanceMeters: Int?
    public let matchConfidence: Double
    public let reasons: [String]
}

public enum SearchItem: Identifiable, Codable, Sendable {
    case event(eventId: UUID, title: String, subtitle: String?, lat: Double, lng: Double, heatScore: Double, startsAt: Date?)
    case venue(venueId: UUID, name: String, locality: String?, lat: Double, lng: Double)

    public var id: String {
        switch self {
        case .event(let eventId, _, _, _, _, _, _): return "e-\(eventId)"
        case .venue(let venueId, _, _, _, _): return "v-\(venueId)"
        }
    }

    public var title: String {
        switch self {
        case .event(_, let title, _, _, _, _, _): return title
        case .venue(_, let name, _, _, _): return name
        }
    }

    public var coordinate: Coordinate {
        switch self {
        case .event(_, _, _, let lat, let lng, _, _): return Coordinate(lat: lat, lng: lng)
        case .venue(_, _, _, let lat, let lng): return Coordinate(lat: lat, lng: lng)
        }
    }
}

// MARK: - Config

public struct FeatureFlags: Codable, Equatable, Sendable {
    public var map_heat_layer_enabled: Bool
    public var native_event_creation_enabled: Bool
    public var stars_enabled: Bool
    public var routing_enabled: Bool
    public var ticketmaster_enabled: Bool
    public var seatgeek_enabled: Bool
    public var predicthq_enabled: Bool
    public var event_claims_enabled: Bool
    public var community_reports_enabled: Bool
    public var city_las_vegas_enabled: Bool

    public static let offlineDefaults = FeatureFlags(
        map_heat_layer_enabled: true,
        native_event_creation_enabled: true,
        stars_enabled: true,
        routing_enabled: true,
        ticketmaster_enabled: false,
        seatgeek_enabled: false,
        predicthq_enabled: false,
        event_claims_enabled: false,
        community_reports_enabled: true,
        city_las_vegas_enabled: true
    )
}

public struct CityConfig: Codable, Equatable, Sendable {
    public let cityKey: String
    public let displayName: String
    public let timezone: String
    public let center: Coordinate
    public let bounds: Bounds
    public let enabled: Bool
    public let tonightStartHourLocal: Int
    public let tonightEndHourLocal: Int
    public let defaultZoom: Double

    public struct Bounds: Codable, Equatable, Sendable {
        public let north: Double, south: Double, east: Double, west: Double
    }

    /// Fallback pilot city used when /v1/config is unreachable (M10 mode).
    public static let lasVegasFallback = CityConfig(
        cityKey: "las_vegas_nv",
        displayName: "Las Vegas",
        timezone: "America/Los_Angeles",
        center: Coordinate(lat: 36.1147, lng: -115.1728),
        bounds: Bounds(north: 36.331, south: 35.982, east: -114.948, west: -115.375),
        enabled: true,
        tonightStartHourLocal: 16,
        tonightEndHourLocal: 6,
        defaultZoom: 13
    )
}
