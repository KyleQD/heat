import Foundation
import Combine

// MARK: - Analytics taxonomy (P0-011 / doc 29). No exact coordinates, ever.

public struct AnalyticsEvent: Sendable {
    public let name: String
    public let payload: [String: String]
}

/// Type-safe taxonomy. Payload builders accept only bucketed/derived values —
/// there is no API surface for attaching lat/lng.
public final class AnalyticsClient: @unchecked Sendable {

    public enum EventName: String, CaseIterable, Sendable {
        case appOpened = "app_opened"
        case mapReady = "map_ready"
        case locationPermissionPrompted = "location_permission_prompted"
        case locationPermissionResult = "location_permission_result"
        case mapViewChanged = "map_view_changed"
        case eventSelected = "event_selected"
        case eventSheetExpanded = "event_sheet_expanded"
        case ticketClicked = "ticket_clicked"
        case eventStarred = "event_starred"
        case eventUnstarred = "event_unstarred"
        case starredFilterEnabled = "starred_filter_enabled"
        case starredFilterDisabled = "starred_filter_disabled"
        case routePreviewRequested = "route_preview_requested"
        case routePreviewLoaded = "route_preview_loaded"
        case routePreviewFailed = "route_preview_failed"
        case routeModeSelected = "route_mode_selected"
        case navigationStarted = "navigation_started"
        case eventCreationStarted = "event_creation_started"
        case eventCreationLocationSelected = "event_creation_location_selected"
        case eventCreationDuplicateCheck = "event_creation_duplicate_check"
        case eventCreationPublished = "event_creation_published"
        case eventCreationFailed = "event_creation_failed"
        case mapDataLoadFailed = "map_data_load_failed"
    }

    public enum SelectionSource: String { case marker, search, starred }
    public enum LocationPermissionResult: String { case granted, denied, restricted, error }
    public enum CreationLocationMode: String { case venue, current, dropPin }

    private var sink: @Sendable (AnalyticsEvent) -> Void
    private var sessionID: String
    private let clock: @Sendable () -> Date

    public init(sessionID: String = UUID().uuidString,
                clock: @escaping @Sendable () -> Date = { Date() },
                sink: @escaping @Sendable (AnalyticsEvent) -> Void = { _ in }) {
        self.sessionID = sessionID
        self.clock = clock
        self.sink = sink
    }

    public func track(_ name: EventName, _ payload: [String: String] = [:]) {
        var full = payload
        full["session_id"] = sessionID
        full["timestamp"] = ISO8601DateFormatter().string(from: clock())
        sink(AnalyticsEvent(name: name.rawValue, payload: full))
    }
}

// MARK: - Pending action (auth-on-action resume, doc 25 §4)

public enum PendingAction: Equatable, Sendable {
    case starEvent(UUID)
    case createEvent
    case reportEvent(UUID)
}

// MARK: - Session store

@MainActor
public final class SessionStore: ObservableObject {
    @Published public private(set) var isAnonymousSessionActive: Bool
    @Published public var pendingAction: PendingAction?

    private let api: APIClient

    public init(api: APIClient) {
        self.api = api
        self.isAnonymousSessionActive = api.currentToken != nil
    }

    /// Minted lazily at first write action; browsing never requires it.
    public func ensureSession() async throws {
        guard !isAnonymousSessionActive else { return }
        _ = try await api.ensureSession()
        isAnonymousSessionActive = true
    }

    /// Resume a deferred action after auth completes (P5-007).
    public func consumePendingAction() -> PendingAction? {
        defer { pendingAction = nil }
        return pendingAction
    }
}

// MARK: - Discovery store (viewport + filters + lifecycle)

@MainActor
public final class DiscoveryStore: ObservableObject {

    public enum LoadState: Equatable, Sendable {
        case idle, loading, loaded(Date), stale(Date), failed(HEATError)
    }

    @Published public private(set) var events: [MapEvent] = []
    @Published public private(set) var clusters: [ClusterPoint] = []
    @Published public private(set) var heatPoints: [HeatPoint] = []
    @Published public private(set) var state: LoadState = .idle
    @Published public var window: TimeWindow = .now {
        didSet { if oldValue != window { refetchIfPossible() } }
    }
    @Published public var categoryFilter: EventCategory? {
        didSet { if oldValue != categoryFilter { refetchIfPossible() } }
    }
    @Published public var starredOnlyMode = false {
        didSet { if oldValue != starredOnlyMode { applyStarredPresentation() } }
    }

    /// R2-001 — retained camera geometry ONLY. Filters live in their own
    /// published properties and are joined at fetch time, so stationary
    /// NOW/TONIGHT/category/starred changes always alter the next request.
    public struct ViewportGeometry: Equatable, Sendable {
        public let north: Double, south: Double, east: Double, west: Double
        public let zoom: Int

        public init(north: Double, south: Double, east: Double, west: Double, zoom: Int) {
            self.north = north; self.south = south; self.east = east; self.west = west; self.zoom = zoom
        }
    }

    private let api: APIClient
    private let analytics: AnalyticsClient
    /// Debounce + cancellation per P1-005/P1-008: rapid panning cancels obsolete requests.
    private var fetchTask: Task<Void, Never>?
    private var lastQueryKey: String?
    private var viewport: ViewportGeometry?

    public init(api: APIClient, analytics: AnalyticsClient) {
        self.api = api
        self.analytics = analytics
    }

    /// The exact request the NEXT fetch would issue (viewport + current
    /// filters). Exposed for tests and diagnostics.
    public func composeQuery() -> APIClient.MapQuery? {
        guard let v = viewport else { return nil }
        return APIClient.MapQuery(
            north: v.north, south: v.south, east: v.east, west: v.west,
            zoom: v.zoom,
            window: window,
            category: categoryFilter,
            starredOnly: starredOnlyMode,
            // Personalized dimension rides along whenever we hold a session;
            // anonymous responses simply carry starred=null.
            includeStarredState: true)
    }

    public func setWindow(_ w: TimeWindow) {
        window = w
    }

    /// Debounced viewport updates; coalesces gesture-end events.
    public func viewportChanged(_ geometry: ViewportGeometry, debounceMs: Int = 300) {
        viewport = geometry
        scheduleFetch(debounceMs: debounceMs)
    }

    private func scheduleFetch(debounceMs: Int) {
        fetchTask?.cancel()
        fetchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(debounceMs) * 1_000_000)
            guard !Task.isCancelled else { return }
            await self?.fetch()
        }
    }

    public func refetchIfPossible() {
        guard viewport != nil else { return }
        scheduleFetch(debounceMs: 0)
    }

    /// R2-006 — force-fetch ignoring query-key equality. Used after canonical
    /// writes (create/edit/moderation) so stationary viewports update instantly.
    public func invalidateAndRefresh() {
        lastQueryKey = nil
        retryDelay = 4_000_000_000   // reset backoff: this is a fresh user intent
        refetchIfPossible()
    }

    public func refresh() async {
        await fetch()
    }

    private func queryKey(_ q: APIClient.MapQuery) -> String {
        ["\(q.north)", "\(q.south)", "\(q.east)", "\(q.west)",
         "z\(q.zoom)", q.window.rawValue,
         q.category?.rawValue ?? "-", q.starredOnly ? "s" : "a",
         q.includeStarredState ? "ps" : "pu"].joined(separator: "|")
    }

    private func fetch() async {
        guard let query = composeQuery() else { return }
        let key = queryKey(query)
        guard key != lastQueryKey || state.isTerminalFailure else { return }
        lastQueryKey = key
        fetchTask?.cancel()
        let task = Task { [api] in
            try await api.mapEvents(query)
        }
        state = events.isEmpty ? .loading : state
        do {
            let response = try await task.value
            // Ignore results that no longer match the newest requested key.
            if key == lastQueryKey {
                ingest(response, authenticated: api.currentToken != nil,
                       includeStarredState: query.includeStarredState)
            }
        } catch let error as HEATError {
            if case .networkOffline = error.code {
                markStale()
            } else if key == lastQueryKey {
                state = .failed(error)
                analytics.track(.mapDataLoadFailed, ["error_code": error.code.rawValue])
                scheduleRetry()
            }
        } catch {}
    }

    /// P1-009 resilience: one automatic retry after a failure (exponential
    /// backoff capped at 30s); user Retry resets the schedule.
    private var retryTask: Task<Void, Never>?
    private var retryDelay: UInt64 = 4_000_000_000

    public func retryNow() async {
        retryTask?.cancel()
        retryDelay = 4_000_000_000
        lastQueryKey = nil   // allow refetch of same key
        await fetch()
    }

    private func scheduleRetry() {
        retryTask?.cancel()
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, 30_000_000_000)
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await self?.retryNow()
        }
    }

    /// Test/preview seam: inject marker rows without network access.
    public func injectForDiagnostics(_ rows: [MapEvent]) {
        events = rows
        state = .loaded(Date())
    }

    private func ingest(_ response: MapEventsResponse, authenticated: Bool, includeStarredState: Bool) {
        events = response.events
        clusters = response.clusters
        heatPoints = response.heatPoints
        state = .loaded(response.generatedAt)
        _ = authenticated
        _ = includeStarredState
    }

    public func markStale() {
        if case .loaded(let at) = state { state = .stale(at) }
    }

    private func applyStarredPresentation() {
        analytics.track(starredOnlyMode ? .starredFilterEnabled : .starredFilterDisabled)
        refetchIfPossible()
    }

    /// Merge an optimistic star change without refetching (FR-STAR-002).
    public func applyStar(eventId: UUID, starred: Bool, countDelta: Int) {
        guard let idx = events.firstIndex(where: { $0.id == eventId }) else { return }
        let e = events[idx]
        events[idx] = MapEvent(
            id: e.id, title: e.title, lat: e.lat, lng: e.lng,
            startsAt: e.startsAt, endsAt: e.endsAt, status: e.status,
            category: e.category, venueName: e.venueName,
            heatScore: e.heatScore, confidence: e.confidence, trend: e.trend,
            starCount: max(0, e.starCount + countDelta),
            starred: starred,
            markerPriority: e.markerPriority, verificationLevel: e.verificationLevel)
    }
}

extension DiscoveryStore.LoadState {
    var isTerminalFailure: Bool {
        if case .failed = self { return true }
        return false
    }

    public static func == (lhs: DiscoveryStore.LoadState, rhs: DiscoveryStore.LoadState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle): return true
        case (.loading, .loading): return true
        case (.loaded(let a), .loaded(let b)): return a == b
        case (.stale(let a), .stale(let b)): return a == b
        case (.failed(let a), .failed(let b)): return a == b
        default: return false
        }
    }
}
