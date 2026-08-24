import Foundation
import Combine

// MARK: - Location abstraction (foreground-only, P12/privacy §2)

/// Foreground-only location. V1 never requests background/always permission.
public protocol LocationProviding: AnyObject {
    var authorizationState: LocationAuthorizationState { get }
    func requestPermission() async -> LocationAuthorizationState
    var currentCoordinate: Coordinate? { get }
}

public enum LocationAuthorizationState: Equatable, Sendable {
    case unknown
    case granted
    case denied
    case restricted
    case error(String)
}

// MARK: - Create store (P3) — map-native creation state machine (§3.1)

@MainActor
public final class CreateStore: ObservableObject {

    public enum Step: Equatable, Sendable {
        case idle
        case selectingLocation          // M5: pin / venue search / current location
        case requiredDetails            // M6: title/category/start/end
        case optionalDetails            // image/desc/tickets/price
        case checkingDuplicates
        case reviewDuplicates([DuplicateCandidate])
        case publishing
        case published(EventDetail)
        case failed(HEATError)
    }

    @Published public private(set) var step: Step = .idle
    @Published public var draft: APIClient.CreateDraft
    @Published public var selectedVenueName: String?
    /// Center-pin coordinate while in location mode.
    @Published public var pinCoordinate: Coordinate?

    private let api: APIClient
    private let analytics: AnalyticsClient
    private let session: SessionStore
    private let selection: SelectionStore
    private let discovery: DiscoveryStore

    public init(api: APIClient, analytics: AnalyticsClient,
                session: SessionStore, selection: SelectionStore,
                discovery: DiscoveryStore) {
        self.api = api
        self.analytics = analytics
        self.session = session
        self.selection = selection
        self.discovery = discovery
        let start = Calendar.current.date(byAdding: .hour, value: 3, to: Date())!
        let end = Calendar.current.date(byAdding: .hour, value: 6, to: Date())!
        draft = APIClient.CreateDraft(title: "", category: .party,
                                      startsAt: start, endsAt: end,
                                      lat: 0, lng: 0)
    }

    public func begin(source: String) {
        step = .selectingLocation
        analytics.track(.eventCreationStarted, ["source": source])
    }

    public func cancel() {
        step = .idle
        pinCoordinate = nil
        selectedVenueName = nil
    }

    // -- Location modes (P3-004/005 + venue search) -------------------------

    public func useCurrentLocation(_ coordinate: Coordinate) {
        pinCoordinate = coordinate
        draft.lat = coordinate.lat
        draft.lng = coordinate.lng
        draft.venueId = nil
        selectedVenueName = nil
        analytics.track(.eventCreationLocationSelected, ["mode": "current"])
        step = .requiredDetails
    }

    public func dropPin(at coordinate: Coordinate) {
        pinCoordinate = coordinate
        draft.lat = coordinate.lat
        draft.lng = coordinate.lng
        draft.venueId = nil
        selectedVenueName = nil
        analytics.track(.eventCreationLocationSelected, ["mode": "dropPin"])
        step = .requiredDetails
    }

    public func selectVenue(id: UUID, name: String, coordinate: Coordinate) {
        pinCoordinate = coordinate
        draft.lat = coordinate.lat
        draft.lng = coordinate.lng
        draft.venueId = id
        selectedVenueName = name
        analytics.track(.eventCreationLocationSelected, ["mode": "venue"])
        step = .requiredDetails
    }

    // -- Validation (P3-003 rules) ------------------------------------------

    public enum ValidationError: Equatable, Sendable {
        case titleTooShort, endBeforeStart, durationTooLong, startTooFarInPast, missingLocation
    }

    public var validationErrors: [ValidationError] {
        var errors: [ValidationError] = []
        if draft.title.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 {
            errors.append(.titleTooShort)
        }
        if draft.endsAt < draft.startsAt { errors.append(.endBeforeStart) }
        if draft.endsAt.timeIntervalSince(draft.startsAt) > 14 * 24 * 3600 { errors.append(.durationTooLong) }
        if draft.startsAt.timeIntervalSinceNow < -7 * 24 * 3600 { errors.append(.startTooFarInPast) }
        if draft.lat == 0 && draft.lng == 0 { errors.append(.missingLocation) }
        return errors
    }

    public func proceedToOptionalDetails() {
        guard validationErrors.isEmpty else { return }
        step = .optionalDetails
    }

    // -- Duplicate check before publish (P3-008/009) ------------------------

    public func runDuplicateCheck() async {
        guard validationErrors.isEmpty else { return }
        step = .checkingDuplicates
        do {
            let candidates = try await api.duplicateCheck(draft: draft)
            analytics.track(.eventCreationDuplicateCheck, [
                "candidate_count": String(candidates.count),
                "max_confidence_bucket": candidates.map(\.matchConfidence).max().map { $0 >= 0.9 ? "high" : ($0 >= 0.75 ? "medium" : "low") } ?? "none",
            ])
            if candidates.isEmpty {
                await publish()
            } else {
                step = .reviewDuplicates(candidates)
            }
        } catch let error as HEATError {
            step = .failed(error)
        } catch {}
    }

    public func chooseExisting(candidate: DuplicateCandidate) {
        analytics.track(.eventCreationDuplicateCheck, ["existing_selected": candidate.eventId.uuidString])
        selection.select(eventId: candidate.eventId, source: .search)
        cancel()
    }

    /// "Create anyway" — permitted below the hard duplicate threshold; the
    /// server re-runs its own guard unless the user explicitly confirms.
    public func confirmCreateAnyway() async {
        await publish(allowDuplicate: true)
    }

    // -- Publish -------------------------------------------------------------

    public func publish(allowDuplicate: Bool = false) async {
        guard validationErrors.isEmpty else { return }
        // Auth-on-action: sign in deferred until publish; draft survives.
        do {
            _ = try await session.ensureSession()
            step = .publishing
        } catch let error as HEATError {
            session.pendingAction = .createEvent
            step = .failed(error)
            return
        } catch {
            step = .failed(HEATError(code: .networkOffline, message: "Sign-in failed"))
            return
        }
        do {
            let event = try await api.createEvent(draft: draft, allowDuplicate: allowDuplicate)
            step = .published(event)
            selection.ingest(detail: event)
            selection.select(eventId: event.id, source: .marker)
            discovery.refetchIfPossible()
            analytics.track(.eventCreationPublished, [
                "event_id": event.id.uuidString,
                "category": event.category.rawValue,
            ])
        } catch let error as HEATError {
            if error.code == .authRequired {
                session.pendingAction = .createEvent
            }
            analytics.track(.eventCreationFailed, [
                "stage": "publish",
                "error_code": error.code.rawValue,
            ])
            step = .failed(error)
        } catch {}
    }

    /// Resume after auth completes (CRT-AC-006): draft is preserved in-place.
    public func resumeAfterAuth() async {
        if case .failed = step { step = .optionalDetails }
        await publish()
    }
}
