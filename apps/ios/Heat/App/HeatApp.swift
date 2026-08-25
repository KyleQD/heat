import SwiftUI
import HeatKit

private struct ScenePhaseFlush: ViewModifier {
    @EnvironmentObject private var env: AppEnvironment
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.onChange(of: scenePhase) { phase in
            if phase == .background {
                Task { await env.flushAnalytics() }
            }
        }
    }
}

@main
struct HeatApp: App {
    @StateObject private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(environment)
                .environmentObject(environment.session)
                .environmentObject(environment.discovery)
                .environmentObject(environment.selection)
                .environmentObject(environment.stars)
                .environmentObject(environment.routes)
                .environmentObject(environment.create)
                .task { await environment.bootstrap() }
                .modifier(ScenePhaseFlush())
                .onOpenURL { url in
                    // heat://event/<id> — open map, load, fly, open sheet (doc 25 §10).
                    if case .event(let id)? = DeepLink.parse(url) {
                        environment.openDeepLink(eventId: id)
                    }
                }
        }
    }
}

/// Composition root: builds the API client and all state stores (doc 25 §3
/// keeps domains separate rather than one giant boolean state object).
@MainActor
final class AppEnvironment: ObservableObject {

    let api: APIClient
    let analytics: AnalyticsClient
    let locationService: LocationService

    let session: SessionStore
    let discovery: DiscoveryStore
    let selection: SelectionStore
    let stars: StarStore
    let routes: RouteStore
    let create: CreateStore

    /// Shared camera command surface (UI + deep links).
    let camera = MapCameraCommand()

    @Published var city: CityConfig = .lasVegasFallback
    @Published var flags: FeatureFlags = .offlineDefaults
    @Published var isOffline = false
    @Published var pendingDeepLinkEventId: UUID?

    private let analyticsBatcher: AnalyticsBatcher

    init() {
        // B003 — no production placeholder fallback exists. Debug resolves
        // env → Info.plist → local stack; any non-Debug binary MUST carry an
        // injected HEAT_API_BASE_URL or it fails fast here.
        #if DEBUG
        let baseURL = ProcessInfo.processInfo.environment["HEAT_API_URL"]
            ?? Bundle.main.infoDictionary?["HEAT_API_BASE_URL"] as? String
            ?? "http://localhost:8787"
        #else
        guard let raw = Bundle.main.infoDictionary?["HEAT_API_BASE_URL"] as? String,
              !raw.isEmpty,
              let configured = URL(string: raw),
              configured.scheme == "https"
        else {
            fatalError("Missing https HEAT_API_BASE_URL in this non-Debug build.")
        }
        let baseURL = raw
        #endif
        // Phase B guard: a release/staging binary must never ship pointing at
        // a placeholder host — fail at boot instead of at first tap.
        #if !DEBUG
        if baseURL.contains(".invalid") || baseURL.contains("example")
            || baseURL.hasPrefix("http://localhost") || baseURL.contains("unset.") {
            fatalError("A real HEAT_API_BASE_URL was not injected into this build.")
        }
        #endif
        let tokens = KeychainTokenStore()
        api = APIClient(baseURL: URL(string: baseURL)!, tokens: tokens)

        // Telemetry batches flush to the API; failures are silent by design.
        let weakAPI = api
        analyticsBatcher = AnalyticsBatcher(send: { batch in
            try? await weakAPI.sendAnalyticsBatch(batch)
        })
        analytics = AnalyticsClient(sink: { [weak analyticsBatcher] event in
            analyticsBatcher?.enqueue(event)
        })
        locationService = LocationService(analytics: analytics)
        session = SessionStore(api: api)
        discovery = DiscoveryStore(api: api, analytics: analytics)
        selection = SelectionStore(api: api, analytics: analytics)
        stars = StarStore(api: api, analytics: analytics, discovery: discovery,
                          selection: selection, session: session)
        routes = RouteStore(api: api, location: locationService,
                            analytics: analytics, starStore: stars,
                            onDeviceRouting: MKDirectionsRouteProvider())
        create = CreateStore(api: api, analytics: analytics, session: session,
                             selection: selection, discovery: discovery)
    }

    /// Telemetry durability: flush queued analytics when leaving foreground.
    func flushAnalytics() async {
        await analyticsBatcher.flush()
    }

    /// Doc 25 §10: deep link opens map → loads event → flies → opens sheet.
    func openDeepLink(eventId: UUID) {
        pendingDeepLinkEventId = eventId
        selection.select(eventId: eventId, source: .search)
    }

    func bootstrap() async {
        analytics.track(.appOpened, ["platform": "ios"])
        // R2-007 — restore persisted star state before first map paint uses it.
        await stars.hydrateFromServer()
        // Config first so flags gate features before first paint completes.
        do {
            let config = try await api.config()
            flags = config.flags
            if let vegas = await Self.configuredCity(config: config) { city = vegas }
        } catch {
            // Offline defaults keep the map usable (P1-009).
            isOffline = true
        }
        _ = await locationService.requestPermissionIfNeeded()
    }

    private static func configuredCity(config: APIClient.ConfigResponse) async -> CityConfig? {
        _ = config
        return .lasVegasFallback
    }
}
