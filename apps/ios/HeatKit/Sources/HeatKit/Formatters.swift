import Foundation

// MARK: - Display formatting (client-side fallbacks; server copy wins)

public enum HeatFormatters {

    /// Compact counts: 842, 1.2K.
    public static func compactCount(_ n: Int) -> String {
        if n >= 1_000_000 {
            let v = Double(n) / 1_000_000
            return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))M" : String(format: "%.1fM", v)
        }
        if n >= 1_000 {
            let v = Double(n) / 1_000
            return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))K" : String(format: "%.1fK", v)
        }
        return String(n)
    }

    /// Attendance copy rules (P4-007). Server displayText is authoritative;
    /// this fallback preserves the same language if the server omitted it.
    public static func attendanceText(estimate: AttendanceEstimate?) -> String? {
        guard let e = estimate else { return nil }
        if let t = e.displayText { return t }
        switch e.type {
        case "verified_count", "live_estimate":
            return "~\(compactCount(e.low))–\(compactCount(e.high)) here now"
        case "pre_event_forecast", "intent_adjusted_forecast":
            return "~\(compactCount(e.low))–\(compactCount(e.high)) expected"
        case "organizer_reported":
            return "\(compactCount(e.low))–\(compactCount(e.high)) expected (organizer)"
        default:
            return nil // unknown → omit row; never invent numbers
        }
    }

    /// `10 PM – 2 AM` in the event's venue timezone (P4 compact sheet).
    public static func timeRange(startsAt: Date, endsAt: Date?, timeZone: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = timeZone
        f.dateFormat = "h a"
        var text = f.string(from: startsAt)
        if let end = endsAt {
            text += " – \(f.string(from: end).lowercased())"
        }
        return text
    }

    /// Day + time for detail sheet, venue-local.
    public static func dayTimeText(date: Date, timeZone: TimeZone) -> String {
        let f = DateFormatter()
        f.timeZone = timeZone
        f.dateFormat = "EEE, MMM d · h:mm a"
        return f.string(from: date)
    }

    public static func priceRange(min: Double?, max: Double?, currency: String?) -> String? {
        guard min != nil || max != nil else { return nil }
        let symbol = currencySymbol(currency)
        switch (min, max) {
        case let (lo?, hi?) where lo != hi: return "\(symbol)\(Int(lo))–\(symbol)\(Int(hi))"
        case let (lo?, _): return "\(symbol)\(Int(lo))+"
        case let (_, hi?): return "Up to \(symbol)\(Int(hi))"
        default: return nil
        }
    }

    private static func currencySymbol(_ code: String?) -> String {
        switch code?.uppercased() {
        case "USD", nil, "": return "$"
        case "EUR": return "€"
        case "GBP": return "£"
        default: return "\(code ?? "") "
        }
    }

    // MARK: HEAT visual identity — color must not be the only indicator.

    public static func heatTier(score: Double) -> HeatTier {
        if score >= 85 { return .surging }
        if score >= 70 { return .hot }
        if score >= 50 { return .warm }
        return .inactive
    }

    public enum HeatTier: String, Sendable {
        case inactive, warm, hot, surging
        public var glyph: String {
            switch self {
            case .inactive: return "○"
            case .warm: return "◔"
            case .hot: return "◉"
            case .surging: return "◎"
            }
        }
        /// Accessible pattern hint appended to labels so state is not color-only.
        public var accessibilityPattern: String {
            switch self {
            case .inactive: return "cool"
            case .warm: return "moderate"
            case .hot: return "high"
            case .surging: return "pulsing"
            }
        }
    }
}
