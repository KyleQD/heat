import Foundation
import Combine

// MARK: - Selection store (P4-001) — single source of truth for selected event

@MainActor
public final class SelectionStore: ObservableObject {

    @Published public private(set) var selectedEventId: UUID?
    @Published public private(set) var detail: EventDetail?
    @Published public private(set) var detailLoading = false
    @Published public private(set) var detailError: HEATError?

    private var cache: [UUID: EventDetail] = [:]
    private var detailTask: Task<Void, Never>?
    private let api: APIClient
    private let analytics: AnalyticsClient
    private var lastFetchAt: [UUID: Date] = [:]

    /// Selected-event detail refreshes more aggressively than background map (P4-010).
    public var refreshInterval: TimeInterval = 30

    public init(api: APIClient, analytics: AnalyticsClient) {
        self.api = api
        self.analytics = analytics
    }

    public func select(eventId: UUID, source: AnalyticsClient.SelectionSource) {
        selectedEventId = eventId
        analytics.track(.eventSelected, ["event_id": eventId.uuidString,
                                         "selection_source": source.rawValue])
        loadDetailIfNeeded(eventId: eventId)
    }

    public func clearSelection() {
        selectedEventId = nil
        detailTask?.cancel()
    }

    public func cachedDetail(for id: UUID) -> EventDetail? {
        cache[id]
    }

    func ingest(detail: EventDetail) {
        cache[detail.id] = detail
        if selectedEventId == detail.id {
            self.detail = detail
        }
    }

    private func loadDetailIfNeeded(eventId: UUID) {
        if let cached = cache[eventId] {
            detail = cached
            // Refresh stale cache in background.
            if isStale(eventId) { fetchDetail(eventId) }
            return
        }
        detail = nil
        fetchDetail(eventId)
    }

    public func reload() {
        guard let id = selectedEventId else { return }
        detailLoading = true
        fetchDetail(id)
    }

    /// P4-010: selected active events refresh more aggressively than the
    /// background map; callers poll this on a timer.
    public func refreshIfStale() {
        guard let id = selectedEventId else { return }
        guard isStale(id) else { return }
        reload()
    }

    private func fetchDetail(_ id: UUID) {
        detailTask?.cancel()
        detailLoading = true
        detailError = nil
        let task = Task { [api] () -> EventDetail in
            try await api.eventDetail(id: id)
        }
        detailTask = Task { [weak self] in
            do {
                let d = try await task.value
                guard !Task.isCancelled else { return }
                self?.detailLoading = false
                self?.lastFetchAt[d.id] = self?.now()
                self?.ingest(detail: d)
            } catch let error as HEATError {
                guard !Task.isCancelled else { return }
                self?.detailLoading = false
                if case .eventNotFound = error.code {
                    self?.selectedEventId = nil
                    self?.detail = nil
                }
                self?.detailError = error
            } catch {}
        }
    }

    private func isStale(_ id: UUID) -> Bool {
        guard let at = lastFetchAt[id] else { return true }
        return now().timeIntervalSince(at) > refreshInterval
    }

    private func now() -> Date { Date() }
}

// MARK: - Star store (P5-006) — optimistic with rollback + race protection

@MainActor
public final class StarStore: ObservableObject {

    @Published public private(set) var starredIds: Set<UUID> = []
    @Published public private(set) var counts: [UUID: Int] = [:]
    @Published public private(set) var inflight: Set<UUID> = []

    private let api: APIClient
    private let analytics: AnalyticsClient
    private let discovery: DiscoveryStore
    private let selection: SelectionStore
    private let session: SessionStore

    public init(api: APIClient, analytics: AnalyticsClient,
                discovery: DiscoveryStore, selection: SelectionStore,
                session: SessionStore) {
        self.api = api
        self.analytics = analytics
        self.discovery = discovery
        self.selection = selection
        self.session = session
    }

    public func isStarred(_ id: UUID) -> Bool {
        starredIds.contains(id)
    }

    /// Sync starred state from a server response (map/detail payloads).
    public func reconcile(id: UUID, starred: Bool?, count: Int) {
        counts[id] = count
        if starred == true { starredIds.insert(id) }
    }

    /// Optimistic toggle (P5-004/006). Rapid taps are serialized per event.
    public func toggleStar(_ eventId: UUID) async {
        guard !inflight.contains(eventId) else { return }
        let wasStarred = starredIds.contains(eventId)
        let target = !wasStarred

        // Optimistic update.
        inflight.insert(eventId)
        applyLocal(eventId, starred: target)

        do {
            session.pendingAction = nil
            let result = target ? try await api.star(eventId: eventId)
                                : try await api.unstar(eventId: eventId)
            counts[eventId] = result.starCount
            if result.starred { starredIds.insert(eventId) } else { starredIds.remove(eventId) }
            discovery.applyStar(eventId: eventId, starred: result.starred, countDelta: 0)
            selection.reload()
        } catch {
            // Roll back and surface lightweight error (P5-004).
            applyLocal(eventId, starred: wasStarred)
        }
        inflight.remove(eventId)
    }

    private func applyLocal(_ id: UUID, starred: Bool) {
        if starred {
            starredIds.insert(id)
            counts[id] = (counts[id] ?? 0) + 1
        } else {
            starredIds.remove(id)
            counts[id] = max(0, (counts[id] ?? 1) - 1)
        }
        discovery.applyStar(eventId: id, starred: starred, countDelta: 0)
    }
}

// MARK: - Route store (P6-002..P6-013) — GO state machine

@MainActor
public final class RouteStore: ObservableObject {

    public enum Phase: Equatable, Sendable {
        case idle
        case requesting(eventId: UUID)
        case preview(RoutePreviewResponse, selectedMode: TravelMode)
        case failed(HEATError)
    }

    @Published public private(set) var phase: Phase = .idle
    private var currentEventId: UUID?

    private let api: APIClient
    private let location: LocationProviding
    private let analytics: AnalyticsClient
    private let starStore: StarStore

    public init(api: APIClient, location: LocationProviding,
                analytics: AnalyticsClient, starStore: StarStore) {
        self.api = api
        self.location = location
        self.analytics = analytics
        self.starStore = starStore
    }

    public var previewResponse: RoutePreviewResponse? {
        if case .preview(let r, _) = phase { return r }
        return nil
    }

    public var selectedMode: TravelMode? {
        if case .preview(_, let m) = phase { return m }
        return nil
    }

    /// GO tapped. Origin stays transient; only buckets reach telemetry (ADR-0007).
    public func requestPreview(destination: Coordinate, modes: [TravelMode], eventId: UUID) async {
        guard let origin = location.currentCoordinate else {
            phase = .failed(HEATError(code: .locationRequired, message: "Location unavailable"))
            analytics.track(.routePreviewFailed, ["error_code": "LOCATION_REQUIRED", "event_id": eventId.uuidString])
            return
        }
        currentEventId = eventId
        phase = .requesting(eventId: eventId)
        analytics.track(.routePreviewRequested, [
            "event_id": eventId.uuidString,
            "requested_modes": modes.map(\.rawValue).joined(separator: ","),
            "starred": starStore.isStarred(eventId) ? "true" : "false",
        ])
        do {
            let response = try await api.routePreview(
                eventId: eventId,
                origin: origin,
                modes: modes.isEmpty ? [.drive] : modes)
            phase = .preview(response, selectedMode: response.routes.first?.mode ?? .drive)
            analytics.track(.routePreviewLoaded, [
                "event_id": eventId.uuidString,
                "mode_count": String(response.routes.count),
            ])
        } catch let error as HEATError {
            phase = .failed(error)
            analytics.track(.routePreviewFailed, ["error_code": error.code.rawValue, "event_id": eventId.uuidString])
        } catch {}
    }

    public func selectMode(_ mode: TravelMode) {
        guard case .preview(let response, _) = phase else { return }
        phase = .preview(response, selectedMode: mode)
        analytics.track(.routeModeSelected, ["mode": mode.rawValue])
    }

    /// Handoff to external navigation; records intent only.
    public func startNavigation(provider: NavigationProvider) async {
        guard case .preview(let response, let mode) = phase, let eventId = currentEventId else { return }
        try? await api.navigationStart(
            eventId: eventId,
            mode: mode,
            provider: provider,
            routeRequestId: response.routeRequestId)
        analytics.track(.navigationStarted, [
            "mode": mode.rawValue,
            "provider": provider.rawValue,
        ])
    }

    public func close() {
        phase = .idle
    }
}
