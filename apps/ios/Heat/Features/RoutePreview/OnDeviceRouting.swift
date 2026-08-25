import Foundation
import MapKit
import HeatKit

/// R2-009 — MKDirections-backed implementation of the HeatKit routing seam.
/// Real road geometry + ETA for the PREVIEW only; turn-by-turn still hands off
/// externally (P6 boundary). Failures return nil so the server estimate stays.
final class MKDirectionsRouteProvider: OnDeviceRoutingProviding {

    func bestRoute(mode: TravelMode,
                   origin: Coordinate,
                   destination: Coordinate) async -> RouteOption? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(
            coordinate: CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lng)))
        request.destination = MKMapItem(placemark: MKPlacemark(
            coordinate: CLLocationCoordinate2D(latitude: destination.lat, longitude: destination.lng)))
        request.transportType = Self.transport(for: mode)
        request.requestsAlternateRoutes = false

        let directions = MKDirections(request: request)
        return await withCheckedContinuation { continuation in
            directions.calculate { response, _ in
                guard let route = response?.routes.first else {
                    continuation.resume(returning: nil)
                    return
                }
                let coords = route.polyline.interpolatedCoordinates(maxPoints: 220)
                continuation.resume(returning: RouteOption(
                    mode: mode,
                    durationSeconds: Int(route.expectedTravelTime),
                    distanceMeters: Int(route.distance),
                    polyline: PolylineDecoder.encode(coords),
                    provider: "apple_ondevice"))
            }
        }
    }

    private static func transport(for mode: TravelMode) -> MKDirectionsTransportType {
        switch mode {
        case .drive: return .automobile
        case .walk: return .walking
        case .transit: return .transit
        case .bike: return .any
        }
    }
}

extension MKPolyline {
    /// Extracts stored points; downsamples long polylines before re-encoding.
    func interpolatedCoordinates(maxPoints: Int) -> [Coordinate] {
        let total = pointCount
        guard total > 0 else { return [] }
        var coords = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: total)
        getCoordinates(&coords, range: NSRange(location: 0, length: total))
        let all = coords.map { Coordinate(lat: $0.latitude, lng: $0.longitude) }
        guard total > maxPoints else { return all }
        let stride = Double(total - 1) / Double(maxPoints - 1)
        return (0..<maxPoints).map { all[Int((Double($0) * stride).rounded())] }
    }
}
