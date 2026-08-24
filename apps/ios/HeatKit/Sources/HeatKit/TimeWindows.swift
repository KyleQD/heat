import Foundation

/// P1-006/ADR-0012 — "Tonight" window resolver, DST-safe via IANA rules.
/// Default night window 16:00 → 06:00 following day, city-configurable.
public enum TimeWindowResolver {

    public struct Window: Equatable, Sendable {
        public let start: Date
        public let end: Date
    }

    /// NOW is a bounded near-term horizon (active + starting soon).
    public static func nowWindow(at date: Date = Date()) -> Window {
        Window(start: date.addingTimeInterval(-2 * 3600), end: date.addingTimeInterval(6 * 3600))
    }

    public static func tonight(city: CityConfig, at date: Date = Date()) -> Window {
        let calendar = Calendar(identifier: .gregorian)
        var localCalendar = calendar
        localCalendar.timeZone = TimeZone(identifier: city.timezone) ?? .current

        let components = localCalendar.dateComponents([.year, .month, .day, .hour], from: date)
        let localHour = components.hour ?? 12
        var anchor = localCalendar.date(from: DateComponents(
            year: components.year, month: components.month, day: components.day))!

        // Before the end hour we are still inside last evening's window.
        if localHour < city.tonightEndHourLocal {
            anchor = localCalendar.date(byAdding: .day, value: -1, to: anchor)!
        }
        var startComps = DateComponents(
            year: localCalendar.component(.year, from: anchor),
            month: localCalendar.component(.month, from: anchor),
            day: localCalendar.component(.day, from: anchor),
            hour: city.tonightStartHourLocal)
        let start = localCalendar.date(from: startComps)!
        let nextDay = localCalendar.date(byAdding: .day, value: 1, to: anchor)!
        startComps = DateComponents(
            year: localCalendar.component(.year, from: nextDay),
            month: localCalendar.component(.month, from: nextDay),
            day: localCalendar.component(.day, from: nextDay),
            hour: city.tonightEndHourLocal)
        let end = localCalendar.date(from: startComps)!
        return Window(start: start, end: end)
    }
}

// MARK: - Geo math + privacy-safe bucketing

public enum GeoMath {

    public static func haversineMeters(from a: Coordinate, to b: Coordinate) -> Double {
        let r = 6_371_000.0
        let dLat = (b.lat - a.lat) * Double.pi / 180
        let dLng = (b.lng - a.lng) * Double.pi / 180
        let la1 = a.lat * Double.pi / 180
        let la2 = b.lat * Double.pi / 180
        let s = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * asin(min(1, sqrt(s)))
    }

    /// Compact straight-line distance for cards: `1.8 mi away`.
    /// Never presented as driving distance (P4-008).
    public static func distanceText(meters: Double) -> String {
        let miles = meters / 1609.344
        if miles < 0.19 { return "\(Int((meters * 3.28084).rounded())) ft away" }
        if miles < 10 {
            return String(format: "%.1f mi away", miles)
        }
        return "\(Int(miles.rounded())) mi away"
    }

    public static func distanceText(from origin: Coordinate, to destination: Coordinate) -> String {
        distanceText(meters: haversineMeters(from: origin, to: destination))
    }

    /// Duration formatting: `5 min`, `1 h 20 min`.
    public static func durationText(seconds: Int) -> String {
        let minutes = Int((Double(seconds) / 60).rounded())
        if minutes < 60 { return "\(max(1, minutes)) min" }
        return "\(minutes / 60) h \(minutes % 60) min"
    }

    public static func etaText(seconds: Int, meters: Double) -> String {
        "\(durationText(seconds: seconds)) · \(distanceText(meters: meters))"
    }

    /// ~5 km grid label used in analytics/route telemetry instead of raw coords.
    public static func geoBucket(_ coordinate: Coordinate) -> String {
        "g\(Int(coordinate.lat * 20))_\(Int(coordinate.lng * 20))"
    }
}
