import XCTest
@testable import HeatKit

// MARK: - Fixtures


/// Thread-safe capture box for handler closures (@Sendable).
final class CaptureBox: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String] = []
    func append(_ s: String) { lock.lock(); items.append(s); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return items }
}

enum Fixtures {
    static func mapEvent(
        id: UUID = UUID(), title: String = "Test Event",
        heat: Double = 70, starred: Bool? = false, count: Int = 10,
        status: EventStatus = .scheduled
    ) -> MapEvent {
        MapEvent(id: id, title: title, lat: 36.11, lng: -115.17,
                 startsAt: Date(timeIntervalSince1970: 1_787_700_000),
                 endsAt: Date(timeIntervalSince1970: 1_787_844_000),
                 status: status, category: .music, venueName: "Venue",
                 heatScore: heat, confidence: .medium, trend: .heatingUp,
                 starCount: count, starred: starred, markerPriority: 60,
                 verificationLevel: .sourceVerified)
    }

    static let apiJSONDateString = "2026-08-24T19:00:00Z"
}

final class APIClientTests: XCTestCase {

    private func clientWith(response: @escaping @Sendable (URLRequest) -> (Int, Data)) -> APIClient {
        let c = APIClient(baseURL: URL(string: "https://api.test")!)
        c.handler = { req in
            let (status, data) = response(req)
            return (data, HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        return c
    }

    func testMapEventsDecoding() async throws {
        let json = """
        {"generatedAt":"\(Fixtures.apiJSONDateString)","window":{"label":"now","start":"\(Fixtures.apiJSONDateString)","end":"\(Fixtures.apiJSONDateString)"},
         "viewport":{"north":36.3,"south":36.0,"east":-115.0,"west":-115.3,"zoom":14},
         "events":[{"id":"11111111-1111-3111-8111-111111111111","title":"Neon Skyline World Tour","lat":36.1255,"lng":-115.1688,
           "startsAt":"2026-08-24T17:33:39Z","endsAt":null,"status":"scheduled","category":"music","venueName":"Sphere",
           "heatScore":91,"confidence":"high","trend":"hot","starCount":9,"starred":null,"markerPriority":73.9,
           "verificationLevel":"multi_source_verified"}],
         "clusters":[{"lat":36.12,"lng":-115.16,"count":4,"maxHeatScore":88}],
         "heatPoints":[{"lat":36.1255,"lng":-115.1688,"weight":0.82}]}
        """.data(using: .utf8)!
        let client = clientWith { _ in (200, json) }
        let res = try await client.mapEvents(.init(north: 36.3, south: 36.0, east: -115.0, west: -115.3, zoom: 14))
        XCTAssertEqual(res.events.count, 1)
        XCTAssertEqual(res.events[0].trend, .hot)
        XCTAssertEqual(res.events[0].confidence, .high)
        XCTAssertNil(res.events[0].starred)
        XCTAssertEqual(res.heatPoints[0].weight, 0.82)
    }

    func testStableErrorCodeParsing() async {
        let body = #"{"error":{"code":"EVENT_NOT_FOUND","message":"Event not found","requestId":"abc"}}"#.data(using: .utf8)!
        let client = clientWith { _ in (404, body) }
        do {
            _ = try await client.eventDetail(id: UUID())
            XCTFail("expected throw")
        } catch let e as HEATError {
            XCTAssertEqual(e.code, .eventNotFound)
            XCTAssertEqual(e.requestId, "abc")
        } catch {
            XCTFail("wrong error type \(error)")
        }
    }

    func testDuplicateGuardParsesCandidates() async {
        let body = """
        {"error":{"code":"DUPLICATE_EVENT_LIKELY","message":"Duplicate event likely","requestId":"r1"},
         "candidates":[{"eventId":"22222222-2222-3222-8222-222222222222","title":"Red Rocks Revue","venueName":"Sand Dollar",
                        "startsAt":"2026-08-25T03:00:00Z","distanceMeters":0,"matchConfidence":0.94,"reasons":["similar_title"]}]}
        """.data(using: .utf8)!
        let client = clientWith { req in
            XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
            return (409, body)
        }
        do {
            var draft = APIClient.CreateDraft(title: "Red Rocks Revue", category: .music,
                                              startsAt: Date(), endsAt: Date().addingTimeInterval(3600),
                                              lat: 36.15, lng: -115.2)
            draft.descriptionText = nil
            _ = try await client.createEvent(draft: draft, idempotencyKey: "dup-guard-key")
            XCTFail("expected duplicate guard error")
        } catch let e as HEATError {
            XCTAssertEqual(e.code, .duplicateEventLikely)
            XCTAssertEqual(e.candidates.count, 1)
            XCTAssertEqual(e.candidates[0].matchConfidence, 0.94)
        } catch {
            XCTFail("wrong error type \(error)")
        }
    }

    func testSessionMintedOnFirstWriteAndReused() async throws {
        let sessionCalls = CaptureBox()
        let starCalls = CaptureBox()
        let client = APIClient(baseURL: URL(string: "https://api.test")!)
        client.handler = { req in
            switch (req.httpMethod ?? "", req.url!.path) {
            case ("POST", "/v1/auth/session"):
                sessionCalls.append("s")
                return (#"{"token":"tok-1"}"#.data(using: .utf8)!,
                        HTTPURLResponse(url: req.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!)
            case ("PUT", _):
                starCalls.append("★")
                XCTAssertTrue((req.value(forHTTPHeaderField: "Authorization") ?? "").contains("tok-1"))
                return (#"{"eventId":"33333333-3333-3333-8333-333333333333","starred":true,"starCount":5}"#.data(using: .utf8)!,
                        HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            default:
                XCTFail("unexpected call \(req.url!)")
                return (Data("{}".utf8), HTTPURLResponse(url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!)
            }
        }
        _ = try await client.star(eventId: UUID())
        _ = try await client.star(eventId: UUID())
        XCTAssertEqual(sessionCalls.all.count, 1, "session minted once")
        XCTAssertEqual(starCalls.all.count, 2)
    }

    func testCreateCarriesCallerSuppliedIdempotencyKey() async throws {
        // R2-003 — the caller owns the attempt key; identical drafts from
        // different attempts use different keys by construction.
        let captured = CaptureBox()
        let client = APIClient(baseURL: URL(string: "https://api.test")!)
        client.handler = { req in
            if let key = req.value(forHTTPHeaderField: "Idempotency-Key") {
                captured.append(key)
            }
            let detail = """
            {"id":"44444444-4444-4444-8444-444444444444","title":"T","description":null,"category":"party","status":"scheduled",
             "verificationLevel":"community","venue":null,"location":{"lat":36,"lng":-115},"timezone":"America/Los_Angeles",
             "startsAt":"2026-08-25T02:00:00Z","endsAt":"2026-08-25T05:00:00Z","startsAtPrecision":"exact",
             "priceMin":null,"priceMax":null,"currency":null,"ticketUrl":null,"coverImageUrl":null,"ageRestriction":null,
             "heat":{"score":10,"confidenceLabel":"estimated","trend":"upcoming","attendanceEstimate":null},
             "stars":{"count":0,"starredByViewer":false,"velocityPhrase":null},
             "routeDestination":{"lat":36,"lng":-115},"canEdit":true,"canReport":true,"canClaim":true,"sourceCount":1}
            """
            return (#"{"event":\#(detail),"trustLevel":"community"}"#.replacingOccurrences(of: "\\#", with: "").data(using: .utf8)!,
                    HTTPURLResponse(url: req.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!)
        }
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let draft = APIClient.CreateDraft(title: "Same Draft", category: .party,
                                          startsAt: start, endsAt: start.addingTimeInterval(3600),
                                          lat: 36.1, lng: -115.1)
        let attemptKey = "ios-test-attempt-1"
        _ = try await client.createEvent(draft: draft, idempotencyKey: attemptKey)
        _ = try await client.createEvent(draft: draft, idempotencyKey: attemptKey)
        XCTAssertEqual(captured.all.count, 2, "both sends carried the header")
        XCTAssertEqual(captured.all.first, attemptKey)
        XCTAssertEqual(captured.all.last, attemptKey, "retry of the SAME attempt reuses the key verbatim")
        XCTAssertNotEqual(attemptKey, "ios-test-attempt-2")
    }
}
