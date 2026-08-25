import Foundation
import MapKit
import HeatKit

/// P6-002 client enhancement: real road geometry + ETAs via MKDirections.
///
/// The backend contract stays authoritative (server estimate_v1 provides a
/// guaranteed baseline); this layer upgrades the selected mode's option when
/// Apple routing succeeds, and silently falls back otherwise. No API keys,
/// no extra backend cost — on-device routing for the preview only; turn-by-turn
/// still hands off to the external navigation app (P6 boundary).
@MainActor
final class OnDeviceRouteEnhancer: ObservableObject {

    enum State: Equatable {
        case idle
        case enhancing(mode: TravelMode)
        case done
    }

    @Published private(set) var state: State = .idle

    func enhance(
        mode: TravelMode,
        origin: Coordinate,
        destination: Coordinate,
        apply: @escaping (RouteOption) -> Void
    ) {
        state = .enhancing(mode: mode)
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lng)))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng)))
        request.transportType = mkTransport(mode)
        request.requestsAlternateRoutes = false

        let directions = MKDirections(request: request)
        directions.calculate { [weak self] response, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                defer { self.state = .done }
                if let error, (error as? NSError)?.code == MKError.placemarkFound.rawValue || error is MKError {
                    // fall through to silent fallback below
                }
                guard let route = response?.routes.first else {
                    return  // keep server estimate — GO never degrades to unusable
                }
                let coords = route.polyline.interpolatedCoordinates(maxPoints: 220)
                let option = RouteOption(
                    mode: mode,
                    durationSeconds: Int(route.expectedTravelTime),
                    distanceMeters: Int(route.distance),
                    polyline: PolylineDecoder.encode(coords),
                    provider: "apple_ondevice"
                )
                apply(option)
            }
        }
    }

    private func mkTransport(_ mode: TravelMode) -> MKDirectionsTransportType {
        switch mode {
        case .drive: return .automobile
        case .walk: return .walking
        case .transit: return .transit
        case .bike: return .any
        }
    }
}

extension MKPolyline {
    /// Extracts stored points; downsamples long polylines for re-encoding.
    func interpolatedCoordinates(maxPoints: Int) -> [Coordinate] {
        let total = pointCount
        guard total > 0 else { return [] }
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: total)
        getCoordinates(&coords, range: NSRange(location: 0, length: total))
        let all = coords.map { Coordinate(lat: $0.latitude, lng: $0.longitude) }
        guard total > maxPoints else { return all }
        let stride = Double(total) / Double(maxPoints)
        return (0..<maxPoints).map { all[Int(Double($0) * stride)] } + [all[total - 1]]
    }
}
