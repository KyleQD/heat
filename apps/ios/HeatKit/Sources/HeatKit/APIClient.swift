import Foundation

// MARK: - Stable error contract

/// Clients branch on `code`; messages are cosmetic (API contracts §13).
public enum HEATErrorCode: String, Sendable {
    case invalidRequest = "INVALID_REQUEST"
    case authRequired = "AUTH_REQUIRED"
    case forbidden = "FORBIDDEN"
    case rateLimited = "RATE_LIMITED"
    case eventNotFound = "EVENT_NOT_FOUND"
    case venueNotFound = "VENUE_NOT_FOUND"
    case duplicateEventLikely = "DUPLICATE_EVENT_LIKELY"
    case routeUnavailable = "ROUTE_UNAVAILABLE"
    case providerUnavailable = "PROVIDER_UNAVAILABLE"
    case locationRequired = "LOCATION_REQUIRED"
    case idempotencyConflict = "IDEMPOTENCY_CONFLICT"
    case internalError = "INTERNAL_ERROR"
    // Client-side synthesized codes
    case networkOffline
    case decodingFailed
}

public struct HEATError: Error, Equatable, Sendable {
    public let code: HEATErrorCode
    public let message: String
    public let requestId: String?
    public let candidates: [DuplicateCandidate]

    public init(code: HEATErrorCode, message: String, requestId: String? = nil,
                candidates: [DuplicateCandidate] = []) {
        self.code = code
        self.message = message
        self.requestId = requestId
        self.candidates = candidates
    }

    public static func == (lhs: HEATError, rhs: HEATError) -> Bool {
        lhs.code == rhs.code && lhs.message == rhs.message && lhs.requestId == rhs.requestId
    }
}

// MARK: - DTO envelopes

struct ErrorEnvelope: Decodable {
    struct Payload: Decodable {
        let code: String
        let message: String?
        let requestId: String?
    }
    let error: Payload
}

struct DuplicateGuardEnvelope: Decodable {
    let error: ErrorEnvelope.Payload
    let candidates: [DuplicateCandidate]?
}

// MARK: - Session token storage abstraction (Keychain-backed in app target)

public protocol TokenStore: Sendable {
    func load() -> String?
    func save(_ token: String)
    func clear()
}

public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private var token: String?
    public init() {}
    public func load() -> String? { token }
    public func save(_ token: String) { self.token = token }
    public func clear() { self.token = nil }
}

enum ISO8601Decoder {
    static func make() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            // API emits UTC ISO-8601; tolerate fractional seconds.
            if let date = Self.parse(raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date \(raw)")
        }
        return d
    }

    private static var formatters: [ISO8601DateFormatter] = {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return [fractional, plain]
    }()

    static func parse(_ raw: String) -> Date? {
        for f in formatters {
            if let d = f.date(from: raw) { return d }
        }
        return nil
    }
}

// MARK: - API client

/// Canonical /v1 client. The mobile app knows canonical IDs only; no provider
/// secrets ever reach this layer.
public final class APIClient: @unchecked Sendable {

    public var baseURL: URL
    private let session: URLSession
    private let tokens: TokenStore
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Test seam: override transport entirely.
    public var handler: (@Sendable (URLRequest) async throws -> (Data, HTTPURLResponse))?

    public init(baseURL: URL, session: URLSession = .shared, tokens: TokenStore = InMemoryTokenStore()) {
        self.baseURL = baseURL
        self.session = session
        self.tokens = tokens
        decoder = ISO8601Decoder.make()
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        encoder = e
    }

    public var currentToken: String? { tokens.load() }

    // -- Auth-on-action: anonymous session minted lazily at first write. ----

    public func ensureSession() async throws -> String {
        if let t = tokens.load() { return t }
        struct SessionResponse: Decodable { let token: String }
        let data = try await request("POST", path: "/v1/auth/session")
        let parsed = try decode(SessionResponse.self, from: data)
        tokens.save(parsed.token)
        return parsed.token
    }

    // -- Telemetry / moderation ----------------------------------------------

    /// Privacy boundary: server rejects any payload containing raw coordinates;
    /// we additionally never put lat/lng into payloads by construction.
    public func sendAnalyticsBatch(_ events: [AnalyticsEvent]) async throws {
        struct Payload: Codable {
            struct Item: Codable {
                let name: String
                let occurredAt: Date
                let payload: [String: String]
            }
            let events: [Item]
        }
        let items = events.map { e in
            Payload.Item(name: e.name, occurredAt: Date(), payload: e.payload)
        }
        _ = try await request("POST", path: "/v1/analytics/batch", body: Payload(events: items))
    }

    public func reportEvent(eventId: UUID, reasonCode: String, details: String?) async throws {
        try await ensureSession()
        struct Payload: Codable { let reason: String; let details: String? }
        _ = try await request("POST", path: "/v1/events/\(eventId.uuidString)/reports",
                              body: Payload(reason: reasonCode, details: details))
    }

    // -- Config -------------------------------------------------------------

    public struct ConfigResponse: Decodable {
        public let flags: FeatureFlags
        public let scoringModelVersion: String
    }

    public func config() async throws -> ConfigResponse {
        let data = try await request("GET", path: "/v1/config")
        return try decode(data)
    }

    // -- Map ----------------------------------------------------------------

    public struct MapQuery: Equatable, Sendable {
        public var north: Double, south: Double, east: Double, west: Double
        public var zoom: Int
        public var window: TimeWindow
        public var category: EventCategory?
        public var starredOnly: Bool
        public var includeStarredState: Bool

        public init(north: Double, south: Double, east: Double, west: Double,
                    zoom: Int, window: TimeWindow = .now,
                    category: EventCategory? = nil,
                    starredOnly: Bool = false,
                    includeStarredState: Bool = false) {
            self.north = north; self.south = south; self.east = east; self.west = west
            self.zoom = zoom; self.window = window; self.category = category
            self.starredOnly = starredOnly; self.includeStarredState = includeStarredState
        }
    }

    public func mapEvents(_ q: MapQuery) async throws -> MapEventsResponse {
        var items: [String] = [
            "north=\(q.north)", "south=\(q.south)", "east=\(q.east)", "west=\(q.west)",
            "zoom=\(q.zoom)", "window=\(q.window.rawValue)",
        ]
        if let c = q.category { items.append("category=\(c.rawValue)") }
        if q.starredOnly { items.append("starredOnly=true") }
        if q.includeStarredState { items.append("includeStarredState=true") }
        let url = baseURL.appendingPathComponent("/v1/map/events?\(items.joined(separator: "&"))")
        let data = try await request("GET", url: url)
        return try decode(data)
    }

    // -- Events -------------------------------------------------------------

    public func eventDetail(id: UUID) async throws -> EventDetail {
        let data = try await request("GET", path: "/v1/events/\(id.uuidString)")
        return try decode(data)
    }

    public func search(q: String, limit: Int = 10) async throws -> [SearchItem] {
        guard let encoded = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else {
            throw HEATError(code: .invalidRequest, message: "Bad query")
        }
        let url = baseURL.appendingPathComponent("/v1/search?q=\(encoded)&limit=\(limit)")
        let data = try await request("GET", url: url)
        return try decode(SearchEnvelope.self, from: data).events
    }

    private struct SearchEnvelope: Decodable { let events: [SearchItem] }

    // -- Stars --------------------------------------------------------------
    // PUT/DELETE are idempotent; response carries reconciled count.

    public struct StarResult: Codable, Equatable, Sendable {
        public let eventId: UUID
        public let starred: Bool
        public let starCount: Int
    }

    public func star(eventId: UUID) async throws -> StarResult {
        try await ensureSession()
        let data = try await request("PUT", path: "/v1/events/\(eventId.uuidString)/star", authenticated: true)
        return try decode(data)
    }

    public func unstar(eventId: UUID) async throws -> StarResult {
        try await ensureSession()
        let data = try await request("DELETE", path: "/v1/events/\(eventId.uuidString)/star", authenticated: true)
        return try decode(data)
    }

    // -- Routing ------------------------------------------------------------

    public func routePreview(eventId: UUID, origin: Coordinate, modes: [TravelMode]) async throws -> RoutePreviewResponse {
        struct Payload: Codable { let eventId: UUID; let origin: Coordinate; let modes: [TravelMode] }
        let data = try await request("POST", path: "/v1/routes/preview",
                                     body: Payload(eventId: eventId, origin: origin, modes: modes))
        return try decode(data)
    }

    public func navigationStart(eventId: UUID, mode: TravelMode,
                                provider: NavigationProvider,
                                routeRequestId: UUID?) async throws {
        struct Payload: Codable {
            let eventId: UUID; let mode: TravelMode
            let provider: NavigationProvider; let routeRequestId: UUID?
        }
        _ = try await request("POST", path: "/v1/routes/navigation-start",
                              body: Payload(eventId: eventId, mode: mode,
                                            provider: provider, routeRequestId: routeRequestId),
                              extraHeaders: [:])
    }

    // -- Native creation ----------------------------------------------------

    public struct CreateDraft: Codable, Sendable {
        public var title: String
        public var descriptionText: String?
        public var category: EventCategory
        public var startsAt: Date
        public var endsAt: Date
        public var lat: Double
        public var lng: Double
        public var venueId: UUID?
        public var ticketUrl: String?

        public init(title: String, descriptionText: String? = nil, category: EventCategory,
                    startsAt: Date, endsAt: Date, lat: Double, lng: Double,
                    venueId: UUID? = nil, ticketUrl: String? = nil) {
            self.title = title; self.descriptionText = descriptionText; self.category = category
            self.startsAt = startsAt; self.endsAt = endsAt
            self.lat = lat; self.lng = lng; self.venueId = venueId; self.ticketUrl = ticketUrl
        }
    }

    public func duplicateCheck(draft: CreateDraft) async throws -> [DuplicateCandidate] {
        struct LocationPayload: Codable { let lat: Double; let lng: Double; let venueId: UUID? }
        struct Payload: Codable {
            let title: String; let category: EventCategory
            let startsAt: Date; let endsAt: Date
            let location: LocationPayload
        }
        let payload = Payload(title: draft.title, category: draft.category,
                              startsAt: draft.startsAt, endsAt: draft.endsAt,
                              location: LocationPayload(lat: draft.lat, lng: draft.lng, venueId: draft.venueId))
        struct Response: Decodable { let candidates: [DuplicateCandidate] }
        let data = try await request("POST", path: "/v1/events/duplicate-check", body: payload)
        return try decode(Response.self, from: data).candidates
    }

    /// Publishes a logical creation attempt.
    ///
    /// R2-003 — the idempotency key is generated ONCE per publish attempt by
    /// the caller (CreateStore) and reused verbatim across network retries of
    /// that attempt. It is NOT derived from content, so identical events from
    /// different users can never collide.
    ///
    /// R2-004 — payload parity: description and venueId ride along with the
    /// required fields. Price/currency remain API-only for V1 (no UI fields).
    public func createEvent(draft: CreateDraft,
                            idempotencyKey: String,
                            allowDuplicate: Bool = false) async throws -> EventDetail {
        _ = try await ensureSession()
        struct LocationPayload: Codable { let lat: Double; let lng: Double; let venueId: UUID? }
        struct Payload: Codable {
            let title: String
            let description: String?
            let category: EventCategory
            let startsAt: Date
            let endsAt: Date
            let location: LocationPayload
            let ticketUrl: String?
        }
        let payload = Payload(title: draft.title,
                              description: draft.descriptionText,
                              category: draft.category,
                              startsAt: draft.startsAt, endsAt: draft.endsAt,
                              location: LocationPayload(lat: draft.lat, lng: draft.lng, venueId: draft.venueId),
                              ticketUrl: draft.ticketUrl)
        var headers = ["Idempotency-Key": idempotencyKey]
        if allowDuplicate { headers["X-Allow-Duplicate"] = "true" }
        struct Response: Decodable { let event: EventDetail }
        let data = try await request("POST", path: "/v1/events", body: payload, extraHeaders: headers)
        return try decode(Response.self, from: data).event
    }

    // -- Config fetch (see above) -------------------------------------------

    // -- Transport ----------------------------------------------------------

    private func request(_ method: String, url: URL) async throws -> Data {
        return try await rawRequest(method, url: url)
    }

    private func request(_ method: String, path: String) async throws -> Data {
        let url = baseURL.appendingPathComponent(path)
        return try await rawRequest(method, url: url)
    }

    private func request(_ method: String, path: String,
                         authenticated: Bool) async throws -> Data {
        let url = baseURL.appendingPathComponent(path)
        return try await rawRequest(method, url: url, authenticated: authenticated)
    }

    /// Typed GET for simple JSON endpoints (e.g. star hydration, R2-007).
    public func get<T: Decodable>(_ type: T.Type = T.self, path: String, authenticated: Bool = false) async throws -> T {
        let data = try await request("GET", path: path, authenticated: authenticated)
        do { return try decoder.decode(T.self, from: data) }
        catch { throw HEATError(code: .decodingFailed, message: "\(error)") }
    }

    private func request<B: Encodable>(_ method: String, path: String,
                                       body: B,
                                       extraHeaders: [String: String] = [:]) async throws -> Data {
        let payload = try encoder.encode(body)
        return try await rawRequest(method, url: baseURL.appendingPathComponent(path),
                                    body: payload, extraHeaders: extraHeaders)
    }

    private func rawRequest(_ method: String, url: URL,
                            body: Data? = nil,
                            extraHeaders: [String: String] = [:],
                            authenticated: Bool = false) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        for (k, v) in extraHeaders { req.setValue(v, forHTTPHeaderField: k) }
        if let data = body {
            req.httpBody = data
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authenticated || tokens.load() != nil {
            if let t = tokens.load() {
                req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization")
            }
        }

        let data: Data
        let response: HTTPURLResponse
        if let handler {
            (data, response) = try await handler(req)
        } else {
            do {
                let (d, r) = try await session.data(for: req)
                guard let http = r as? HTTPURLResponse else {
                    throw HEATError(code: .networkOffline, message: "Invalid response")
                }
                data = d
                response = http
            } catch let err as HEATError {
                throw err
            } catch {
                throw HEATError(code: .networkOffline, message: error.localizedDescription)
            }
        }

        if (200...299).contains(response.statusCode) { return data }

        // Duplicate guard carries candidates in the 409 envelope (P3-009).
        if response.statusCode == 409,
           let env = try? decoder.decode(DuplicateGuardEnvelope.self, from: data) {
            throw HEATError(code: HEATErrorCode(rawValue: env.error.code) ?? .duplicateEventLikely,
                            message: env.error.message ?? "Duplicate event likely",
                            requestId: env.error.requestId,
                            candidates: env.candidates ?? [])
        }
        if let env = try? decoder.decode(ErrorEnvelope.self, from: data) {
            throw HEATError(code: HEATErrorCode(rawValue: env.error.code) ?? .internalError,
                            message: env.error.message ?? "Request failed",
                            requestId: env.error.requestId)
        }
        throw HEATError(code: .internalError, message: "HTTP \(response.statusCode)")
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw HEATError(code: .decodingFailed, message: "\(error)")
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try decode(data) as T
    }
}
