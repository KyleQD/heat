import Foundation

/// R2-010 — pure URL construction for external navigation handoffs, honoring
/// the SELECTED travel mode. Bike has no V1 mapping by design: callers must
/// disable it rather than let it silently become a driving route.
public enum NavigationHandoffURLs {

    public static func supports(_ provider: NavigationProvider, mode: TravelMode) -> Bool {
        switch mode {
        case .drive, .walk: return true
        case .transit: return true
        case .bike: return provider == .googleMaps   // Apple dirflg lacks bike
        }
    }

    public static func appleMaps(destination: Coordinate,
                                 mode: TravelMode,
                                 label: String?) -> URL? {
        var comps = URLComponents(string: "https://maps.apple.com/")
        comps?.queryItems = [
            URLQueryItem(name: "daddr", value: "\(destination.lat),\(destination.lng)"),
            URLQueryItem(name: "dirflg", value: appleFlag(mode)),
            URLQueryItem(name: "q", value: label ?? "Destination"),
        ]
        return comps?.url
    }

    public static func googleMapsApp(destination: Coordinate,
                                     mode: TravelMode) -> URL? {
        var comps = URLComponents(string: "comgooglemaps://")
        comps?.queryItems = [
            URLQueryItem(name: "daddr", value: "\(destination.lat),\(destination.lng)"),
            URLQueryItem(name: "directionsmode", value: googleMode(mode)),
        ]
        return comps?.url
    }

    public static func googleMapsWeb(destination: Coordinate,
                                     mode: TravelMode) -> URL? {
        var comps = URLComponents(string: "https://www.google.com/maps/dir/?api=1")
        comps?.queryItems = [
            URLQueryItem(name: "destination", value: "\(destination.lat),\(destination.lng)"),
            URLQueryItem(name: "travelmode", value: googleMode(mode)),
        ]
        return comps?.url
    }

    /// d=drive, w=walk, r=transit. Bike intentionally unsupported on Apple.
    private static func appleFlag(_ mode: TravelMode) -> String {
        switch mode {
        case .drive: return "d"
        case .walk: return "w"
        case .transit: return "r"
        case .bike: return "d" // unreachable when supports() gates the UI
        }
    }

    private static func googleMode(_ mode: TravelMode) -> String {
        switch mode {
        case .drive: return "driving"
        case .walk: return "walking"
        case .transit: return "transit"
        case .bike: return "bicycling"
        }
    }
}
