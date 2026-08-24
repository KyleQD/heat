import XCTest
@testable import HeatKit

final class TimeWindowTests: XCTestCase {

    let city = CityConfig.lasVegasFallback

    private func date(_ iso: String) -> Date {
        ISO8601Decoder.parse(iso)!
    }

    func testTonightEveningAnchor() {
        // 20:00 local (PDT) on Aug 24 → window 16:00 PDT → 06:00 next day.
        let at = date("2026-08-25T03:00:00Z")
        let w = TimeWindowResolver.tonight(city: city, at: at)
        XCTAssertEqual(w.start, date("2026-08-24T23:00:00Z"))
        XCTAssertEqual(w.end, date("2026-08-25T13:00:00Z"))
    }

    func testAfterMidnightBelongsToPreviousNight() {
        let at = date("2026-08-25T09:00:00Z") // 02:00 PDT
        let w = TimeWindowResolver.tonight(city: city, at: at)
        XCTAssertEqual(w.start, date("2026-08-24T23:00:00Z"))
        XCTAssertEqual(w.end, date("2026-08-25T13:00:00Z"))
    }

    func testDSTSafeWinterWindow() {
        let at = date("2026-01-16T05:00:00Z") // 21:00 PST Jan 15
        let w = TimeWindowResolver.tonight(city: city, at: at)
        XCTAssertEqual(w.start, date("2026-01-16T00:00:00Z"))  // 16:00 PST
        XCTAssertEqual(w.end, date("2026-01-16T14:00:00Z"))    // 06:00 PST
    }

    func testNowWindowBounded() {
        let at = date("2026-08-25T03:00:00Z")
        let w = TimeWindowResolver.nowWindow(at: at)
        XCTAssertEqual(w.start.timeIntervalSince1970, at.timeIntervalSince1970 - 7200)
        XCTAssertEqual(w.end.timeIntervalSince1970, at.timeIntervalSince1970 + 21600)
    }
}

final class GeoMathTests: XCTestCase {

    func testHaversineStripToSphere() {
        let a = Coordinate(lat: 36.1147, lng: -115.1728)   // center Strip
        let b = Coordinate(lat: 36.1255, lng: -115.1688)   // Sphere
        let d = GeoMath.haversineMeters(from: a, to: b)
        XCTAssertEqual(d, 1300, accuracy: 300)
    }

    func testDistanceCopyNeverImpliesDriving() {
        XCTAssertEqual(GeoMath.distanceText(meters: 2_900), "1.8 mi away")
        XCTAssertEqual(GeoMath.distanceText(meters: 40), "131 ft away")
        XCTAssertTrue(GeoMath.distanceText(meters: 24_000).hasSuffix("mi away"))
    }

    func testDurationAndEta() {
        XCTAssertEqual(GeoMath.durationText(seconds: 540), "9 min")
        XCTAssertEqual(GeoMath.durationText(seconds: 4_800), "1 h 20 min")
        XCTAssertFalse(GeoMath.etaText(seconds: 540, meters: 4_100).isEmpty)
    }

    func testGeoBucketIsBroadNotExact() {
        let bucket = GeoMath.geoBucket(Coordinate(lat: 36.11471, lng: -115.17281))
        XCTAssertEqual(bucket, GeoMath.geoBucket(Coordinate(lat: 36.11000, lng: -115.17000)))
        XCTAssertNotEqual(bucket, GeoMath.geoBucket(Coordinate(lat: 36.2, lng: -115.3)))
    }
}

final class FormatterTests: XCTestCase {

    func testAttendanceCopyRulesNoFalsePrecision() {
        let forecast = AttendanceEstimate(low: 1200, high: 1600, type: "pre_event_forecast", displayText: nil)
        XCTAssertEqual(HeatFormatters.attendanceText(estimate: forecast), "~1.2K–1.6K expected")

        let live = AttendanceEstimate(low: 1100, high: 1400, type: "verified_count", displayText: nil)
        XCTAssertEqual(HeatFormatters.attendanceText(estimate: live), "~1.1K–1.4K here now")

        let unknown = AttendanceEstimate(low: 100, high: 200, type: "unknown", displayText: nil)
        XCTAssertNil(HeatFormatters.attendanceText(estimate: unknown), "unknown → omit row, never invent")

        // Server copy always wins.
        let serverOwned = AttendanceEstimate(low: 1, high: 2, type: "unknown",
                                             displayText: "~1–2 expected")
        XCTAssertEqual(HeatFormatters.attendanceText(estimate: serverOwned), "~1–2 expected")
    }

    func testCompactCounts() {
        XCTAssertEqual(HeatFormatters.compactCount(842), "842")
        XCTAssertEqual(HeatFormatters.compactCount(1200), "1.2K")
        XCTAssertEqual(HeatFormatters.compactCount(15_800), "15.8K")
    }

    func testHeatTierGlyphsGiveNonColorSignal() {
        XCTAssertEqual(HeatFormatters.heatTier(score: 91).glyph, "◎")
        XCTAssertEqual(HeatFormatters.heatTier(score: 72).glyph, "◉")
        XCTAssertEqual(HeatFormatters.heatTier(score: 55).glyph, "◔")
        XCTAssertEqual(HeatFormatters.heatTier(score: 10).glyph, "○")
        XCTAssertNotEqual(HeatFormatters.HeatTier.surging.accessibilityPattern,
                          HeatFormatters.HeatTier.hot.accessibilityPattern)
    }

    func testPriceRange() {
        XCTAssertEqual(HeatFormatters.priceRange(min: 89, max: 340, currency: "USD"), "$89–$340")
        XCTAssertEqual(HeatFormatters.priceRange(min: 30, max: 30, currency: "USD"), "$30+")
        XCTAssertNil(HeatFormatters.priceRange(min: nil, max: nil, currency: nil))
    }
}
