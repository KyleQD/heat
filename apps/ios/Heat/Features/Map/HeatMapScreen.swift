import SwiftUI
import Network
import HeatKit

/// M1 — Explore. The map is the primary surface; every other state is an
/// overlay on top of it (M2 selection, M4 route, M5-M6 create, M7 search,
/// M9 empty, M10 location denied).
struct HeatMapScreen: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var discovery: DiscoveryStore
    @EnvironmentObject private var selection: SelectionStore
    @EnvironmentObject private var routes: RouteStore
    @EnvironmentObject private var create: CreateStore
    @EnvironmentObject private var stars: StarStore

    enum OverlayMode: Equatable {
        case explore
        case routePreview
        case createLocation
        case search
    }

    @State private var overlayMode: OverlayMode = .explore
    @State private var showOfflineBanner = false
    @State private var showNearbyList = false
    @ObservedObject private var reachability = Reachability()

    /// Shared camera commands (also driven by deep links).
    private var camera: MapCameraCommand { env.camera }

    var body: some View {
        ZStack {
            MapCanvas(
                events: presentedEvents,
                clusters: overlayMode == .explore ? discovery.clusters : [],
                heatPoints: env.flags.map_heat_layer_enabled ? discovery.heatPoints : [],
                routePolyline: routePolylineCoords,
                destination: routeDestination,
                isCreateMode: overlayMode == .createLocation,
                pinCoordinate: create.pinCoordinate,
                selectedEventId: selection.selectedEventId,
                starredIds: stars.starredIds,
                camera: camera,
                onViewportChange: handleViewport,
                onSelectEvent: handleSelectEvent,
                onSelectCluster: handleSelectCluster
            )
            .ignoresSafeArea()

            VStack {
                topControls
                HStack {
                    stalePill
                    Spacer()
                    Button {
                        withAnimation { showNearbyList = true }
                    } label: {
                        Image(systemName: "list.bullet")
                            .font(.system(size: 15))
                            .padding(9)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                    .accessibilityLabel("Browse nearby events as a list")
                    HeatLegend()
                        .environmentObject(env)
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                if showOfflineBanner { OfflineBanner().padding(.horizontal, 14).padding(.top, 6) }
                if env.locationService.phase == .denied || env.locationService.authorizationState == .denied {
                    HStack {
                        Spacer()
                        LocationDeniedCard().padding(.trailing, 16)
                    }
                    .padding(.top, 6)
                }
                Spacer()
                if case .failed = discovery.state { errorBanner }
            }

            bottomArea
        }
        .overlay(alternativeSheet)
        .onAppear {
            if discovery.events.isEmpty {
                centerOnDefaultCity()
            }
            env.locationService.refreshLocation()
        }
        .onChange(of: reachability.isOnline) { online in
            showOfflineBanner = !online
            if online { Task { await discovery.refresh() } }
        }
        .sheet(isPresented: createDetailsBinding) {
            CreateEventSheet(onClose: cancelCreate)
        }
        .sheet(isPresented: $showNearbyList) {
            NearbyListSheet(onClose: { showNearbyList = false }) { eventId in
                showNearbyList = false
                selection.select(eventId: eventId, source: .search)
            }
        }
        .onChange(of: env.pendingDeepLinkEventId) { pending in
            guard let id = pending else { return }
            withAnimation { overlayMode = .explore }
            selection.select(eventId: id, source: .search)
        }
        .onChange(of: discovery.events) { events in
            stars.reconcile(from: events)
        }
        .onChange(of: selection.detail?.stars) { starsInfo in
            guard let d = selection.detail, let info = starsInfo else { return }
            stars.reconcile(id: d.id, starred: info.starredByViewer, count: info.count)
        }
        .onChange(of: selection.detail?.id) { detailId in
            // Deep-link fly-to once the target detail lands.
            if let detailId, env.pendingDeepLinkEventId == detailId,
               let d = selection.detail {
                camera.flyTo(d.location)
                env.pendingDeepLinkEventId = nil
            }
        }
        // P4-010 selected active events refresh faster than background map.
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { tick in
            nowTick = tick
            guard overlayMode == .explore else { return }
            selection.refreshIfStale()
        }
    }

    /// Details sheet opens once a location mode is confirmed (M6 over map).
    private var createDetailsBinding: Binding<Bool> {
        Binding(get: {
            // R2-005 — `.published` intentionally CLOSES the sheet: the store
            // already selected the new event and reset the draft.
            switch create.step {
            case .requiredDetails, .optionalDetails, .checkingDuplicates,
                 .reviewDuplicates, .publishing:
                return true
            default:
                return false
            }
        }, set: { shown in
            if !shown { cancelCreate() }
        })
    }

    // MARK: Derived data -----------------------------------------------------

    /// Starred mode (M8): de-emphasis server-side filter keeps geography.
    private var presentedEvents: [MapEvent] {
        if overlayMode == .createLocation { return [] }
        return discovery.events
    }

    private var routePolylineCoords: [Coordinate] {
        // R2-009 — same RouteOption the panel displays (enhanced or estimate).
        guard case .preview(_, let mode) = routes.phase,
              let option = routes.displayOption(for: mode),
              let polyline = option.polyline else { return [] }
        return PolylineDecoder.decode(polyline)
    }

    private var routeDestination: Coordinate? {
        routes.previewResponse?.destination
    }

    // MARK: Top controls (brand + search) ------------------------------------

    private var topControls: some View {
        HStack(spacing: 12) {
            BrandButton()
            SearchBarButton {
                withAnimation(.spring(response: 0.35)) { overlayMode = .search }
            }
            .accessibilityLabel("Search events and venues")
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    // MARK: Bottom area -------------------------------------------------------

    @ViewBuilder
    private var bottomArea: some View {
        VStack(spacing: 12) {
            switch overlayMode {
            case .explore:
                Spacer()
                floatingButtons
                if isEmptyAndLoaded {
                    EmptyStateCard(
                        onTonight: { discovery.setWindow(.tonight) },
                        onExpand: expandSearchArea,
                        onCreate: beginCreateFromEmptyState
                    )
                }
                controlsBar
            case .routePreview:
                RoutePreviewPanel(onClose: closeRoute)
            case .createLocation:
                CreateLocationBar(
                    onSelectVenue: { id, name, coordinate in
                        create.selectVenue(id: id, name: name, coordinate: coordinate)
                        withAnimation { overlayMode = .explore }
                    },
                    onUseMyLocation: useMyLocationForCreate,
                    onNext: proceedWithPin,
                    onCancel: cancelCreate)
            case .search:
                Spacer()
            }
        }
        .padding(.bottom, 4)
    }

    private var isEmptyAndLoaded: Bool {
        if case .loaded = discovery.state { return discovery.events.isEmpty }
        return false
    }

    // MARK: Floating buttons --------------------------------------------------

    private var floatingButtons: some View {
        HStack {
            Spacer()
            VStack(spacing: 14) {
                CircleIconButton(systemImage: "location.fill",
                                 isActive: camera.followingUser) {
                    recenter()
                }
                .accessibilityLabel("Recenter on my location")

                if env.flags.native_event_creation_enabled {
                    CircleIconButton(systemImage: "plus", isActive: false) {
                        beginCreate()
                    }
                    .accessibilityLabel("Create event")
                }
            }
            .padding(.trailing, 16)
        }
    }

    private var controlsBar: some View {
        HStack(spacing: 10) {
            TimeWindowToggle(selection: Binding(
                get: { discovery.window },
                set: { discovery.setWindow($0) }))
            StarredToggleButton(isOn: Binding(
                get: { discovery.starredOnlyMode },
                set: { discovery.starredOnlyMode = $0 }))
            FilterButton(category: $discovery.categoryFilter)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    private var errorBanner: some View {
        InlineError(message: "Couldn't load HEAT right now.") {
            Task { await discovery.retryNow() }
        }
        .padding(.horizontal, 24)
    }

    /// Freshness indicator (P12 refresh rules): subtle "updated X ago" when
    /// serving stale data after an offline period.
    @State private var nowTick = Date()
    private var stalePill: some View {
        Group {
            if case .stale(let at) = discovery.state {
                let mins = Int(nowTick.timeIntervalSince(at) / 60)
                Label(mins < 1 ? "updated moments ago" : "updated \(mins)m ago",
                      systemImage: "clock.arrow.circlepath")
                    .font(.caption2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial, in: Capsule())
                    .transition(.opacity)
            }
        }
    }

    // MARK: Sheets ------------------------------------------------------------

    /// One managed sheet host — never two competing sheets (doc 25 §5).
    @ViewBuilder
    private func alternativeSheet() -> some View {
        if overlayMode == .search {
            SearchOverlayView(onClose: { overlayMode = .explore }) { item in
                handleSearchSelection(item)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if selection.selectedEventId != nil && overlayMode != .createLocation {
            EventBottomSheet(
                isExpanded: isSheetExpandedBinding,
                onClose: closeSelection,
                onStar: { toggleStarForSelected() },
                onGo: { beginRouteForSelected() },
                onTicket: recordTicketClick,
                onReportRequested: {}
            )
        }
    }

    private var isSheetExpandedBinding: Binding<Bool> {
        Binding(get: { selection.detail != nil && sheetExpanded }, set: { sheetExpanded = $0 })
    }

    @State private var sheetExpanded = false

    // MARK: Interactions ------------------------------------------------------

    private func handleViewport(_ region: ViewportRegion) {
        // M5: while placing a location, map center IS the pin (drag-to-place).
        if overlayMode == .createLocation {
            create.pinCoordinate = region.center
            return   // no viewport fetches during create mode
        }
        lastKnownCenter = region.center
        guard overlayMode != .search else { return }
        // R2-001 — the store retains geometry only and joins CURRENT filter
        // state at fetch time, so stationary filter changes always re-query.
        discovery.viewportChanged(DiscoveryStore.ViewportGeometry(
            north: region.north, south: region.south, east: region.east, west: region.west,
            zoom: Int(region.zoom)))
    }

    private func handleSelectEvent(id: UUID) {
        guard overlayMode != .createLocation else { return }         // conflict rule §7
        guard overlayMode != .routePreview else { return }           // don't silently swap dest §8
        selection.select(eventId: id, source: .marker)
        sheetExpanded = false
        camera.shiftUpForSheet()   // keep marker visible above sheet (P4-002)
    }

    private func handleSelectCluster(_ cluster: ClusterPoint) {
        camera.zoomIn(on: Coordinate(lat: cluster.lat, lng: cluster.lng))
    }

    private func handleSearchSelection(_ item: SearchItem) {
        withAnimation { overlayMode = .explore }
        switch item {
        case .event(let eventId, _, _, _, _, _, _):
            selection.select(eventId: eventId, source: .search)
            camera.flyTo(Coordinate(lat: item.coordinate.lat, lng: item.coordinate.lng))
        case .venue(_, _, _, let lat, let lng):
            camera.flyTo(Coordinate(lat: lat, lng: lng))
        }
    }

    private func toggleStarForSelected() {
        guard let id = selection.selectedEventId else { return }
        // Auth-on-action handled inside store; pending action resumes after auth.
        Task { await stars.toggleStar(id) }
    }

    private func beginRouteForSelected() {
        guard let detail = selection.detail ?? selection.cachedDetail(for: selection.selectedEventId ?? UUID()) else {
            selection.reload()
            return
        }
        Task {
            // R2-010 — Bike stays out of V1 GO: no cycling-capable provider is
            // wired yet, and we never silently convert it to driving.
            await routes.requestPreview(destination: detail.routeDestination,
                                        modes: [.drive, .walk, .transit],
                                        eventId: detail.id)
            withAnimation(.spring(response: 0.4)) { overlayMode = .routePreview }
        }
    }

    private func closeSelection() {
        selection.clearSelection()
        sheetExpanded = false
    }

    private func closeRoute() {
        routes.close()
        withAnimation { overlayMode = .explore }
    }

    private func recordTicketClick() {
        guard let d = selection.detail, let url = d.ticketUrl else { return }
        env.analytics.track(.ticketClicked, [
            "event_id": d.id.uuidString,
            "starred": stars.isStarred(d.id) ? "true" : "false",
        ])
        #if canImport(UIKit)
        UIApplication.shared.open(url)
        #endif
    }

    // MARK: Create mode --------------------------------------------------------

    private func beginCreate(source: String = "plus_button") {
        guard env.flags.native_event_creation_enabled else { return }
        selection.clearSelection()
        routes.close()
        create.begin(source: source)
        // Seed the pin from wherever the map is currently centered so "Next"
        // works even before the user drags.
        if create.pinCoordinate == nil {
            create.pinCoordinate = lastKnownCenter
        }
        withAnimation { overlayMode = .createLocation }
    }

    /// Last region center reported by the canvas (also used for recenter UX).
    @State private var lastKnownCenter: Coordinate?

    private func beginCreateFromEmptyState() { beginCreate(source: "empty_state") }

    /// R2-008 — wire the bar's Use-My-Location into existing store logic.
    private func useMyLocationForCreate() {
        guard let c = env.locationService.currentCoordinate else { return }
        create.useCurrentLocation(c)
        withAnimation { overlayMode = .explore }
    }

    private func proceedWithPin() {
        guard let pin = create.pinCoordinate ?? lastKnownCenter else { return }
        create.dropPin(at: pin)
        withAnimation { overlayMode = .explore }
    }

    private func cancelCreate() {
        create.cancel()
        withAnimation { overlayMode = .explore }
    }

    // MARK: Camera helpers -----------------------------------------------------

    private func centerOnDefaultCity() {
        camera.flyTo(env.city.center, spanDelta: nil, preserveFollow: false)
    }

    private func recenter() {
        env.locationService.refreshLocation()
        if let c = env.locationService.currentCoordinate {
            camera.flyTo(c, spanDelta: nil, preserveFollow: true)
        } else {
            camera.flyTo(env.city.center, spanDelta: nil, preserveFollow: false)
        }
    }

    private func expandSearchArea() {
        camera.zoomOut()
    }
}

// MARK: - Reachability (offline banner, P1-009)

final class Reachability: ObservableObject {
    @Published var isOnline = true
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "heat.reachability")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                self?.isOnline = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }

    deinit { monitor.cancel() }
}
