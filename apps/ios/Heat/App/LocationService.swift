import Foundation
import CoreLocation
import HeatKit

/// Foreground-only location service (P1-003). V1 never requests background
/// authorization; exact coordinates are used transiently for centering and
/// routing and are never persisted (privacy spec §2-3).
final class LocationService: NSObject, ObservableObject, LocationProviding {

    enum Phase: Equatable {
        case unknown
        case denied
        case granted
        case fallbackRegion
    }

    @Published private(set) var phase: Phase = .unknown
    private(set) var currentCoordinate: Coordinate?
    private let analytics: AnalyticsClient
    private let manager = CLLocationManager()
    /// Last known coordinate kept transiently for recenter/GO.
    private var latestFix: CLLocation?

    override init() {
        self.analytics = AnalyticsClient()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    init(analytics: AnalyticsClient) {
        self.analytics = LocationService.wrap(analytics)
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    private static func wrap(_ a: AnalyticsClient) -> AnalyticsClient { a }

    var authorizationState: LocationAuthorizationState {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        default: return .unknown
        }
    }

    @discardableResult
    func requestPermissionIfNeeded() async -> LocationAuthorizationState {
        let state = authorizationState
        if state == .unknown {
            analytics.track(.locationPermissionPrompted)
            manager.requestWhenInUseAuthorization()
            // The delegate callback resolves the result asynchronously.
            return state
        }
        record(state)
        return state
    }

    private func record(_ state: LocationAuthorizationState) {
        let result: String
        switch state {
        case .granted: result = "granted"
        case .denied: result = "denied"
        case .restricted: result = "restricted"
        default: result = "error"
        }
        analytics.track(.locationPermissionResult, ["result": result])
    }

    func refreshLocation() {
        guard authorizationState == .granted else { return }
        manager.requestLocation()
    }

    // MARK: LocationProviding (used by RouteStore — origin stays transient)

    /// Protocol entry point; delegates to the richer UI-facing flow.
    func requestPermission() async -> LocationAuthorizationState {
        await requestPermissionIfNeeded()
    }
}

extension LocationService: CLLocationManagerDelegate {

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            phase = .granted
            record(.granted)
            refreshLocation()
        case .denied:
            phase = .denied
            record(.denied)
        case .restricted:
            phase = .denied
            record(.restricted)
        default:
            phase = .unknown
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last else { return }
        latestFix = fix
        currentCoordinate = Coordinate(lat: fix.coordinate.latitude,
                                       lng: fix.coordinate.longitude)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        phase = latestFix == nil ? .fallbackRegion : phase
    }
}
