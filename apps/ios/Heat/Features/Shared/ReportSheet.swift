import SwiftUI
import HeatKit

/// Report flow (P13 V1 baseline): reason -> optional details -> confirmation.
/// Reporter never sees moderation decisions (moderation spec §13.4).
struct ReportSheet: View {
    let eventId: UUID
    @EnvironmentObject private var env: AppEnvironment
    @Environment(\.dismiss) private var dismiss

    enum SubmitState: Equatable {
        case editing, submitting, submitted, failed(String)
    }

    @State private var selected: ReportReason?
    @State private var details = ""
    @State private var state: SubmitState = .editing

    enum ReportReason: String, CaseIterable, Identifiable {
        var id: String { rawValue }
        case duplicate = "Duplicate"
        case fakeEvent = "Fake event"
        case canceled = "Already canceled"
        case postponed = "Postponed / rescheduled"
        case wrongLocation = "Wrong location"
        case wrongTime = "Wrong time"
        case wrongVenue = "Wrong venue"
        case scamTicketLink = "Scam ticket link"
        case unsafeLocation = "Unsafe"
        case inappropriateContent = "Inappropriate"
        case impersonation = "Impersonation"
        case other = "Something else"

        /// High-severity reports get elevated moderation priority (privacy §10).
        var isHighSeverity: Bool {
            self == .scamTicketLink || self == .unsafeLocation || self == .impersonation
        }

        var wireCode: String {
            switch self {
            case .duplicate: return "duplicate"
            case .fakeEvent: return "fake_event"
            case .canceled: return "canceled"
            case .postponed: return "postponed"
            case .wrongLocation: return "wrong_location"
            case .wrongTime: return "wrong_time"
            case .wrongVenue: return "wrong_venue"
            case .scamTicketLink: return "scam_ticket_link"
            case .unsafeLocation: return "unsafe_location"
            case .inappropriateContent: return "inappropriate_content"
            case .impersonation: return "impersonation"
            case .other: return "other"
            }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if state == .submitted {
                    Section {
                        Label("Thanks — our team will take a look.", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                } else {
                    Section("Why are you reporting this event?") {
                        ForEach(ReportReason.allCases) { reason in
                            Button {
                                selected = reason
                            } label: {
                                HStack {
                                    Text(reason.rawValue)
                                    if reason.isHighSeverity {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .font(.caption2)
                                            .foregroundStyle(.orange)
                                    }
                                    Spacer()
                                    if selected == reason {
                                        Image(systemName: "checkmark").foregroundStyle(.heatAccent)
                                    }
                                }
                            }
                            .tint(.primary)
                        }
                    }
                    Section("Details (optional)") {
                        TextField("Anything we should know?", text: $details, axis: .vertical)
                            .lineLimit(3...6)
                    }
                    if case .failed(let message) = state {
                        Section {
                            Label(message, systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
            .navigationTitle("Report event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        submit()
                    }
                    .disabled(selected == nil || state == .submitting || state == .submitted)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// Reporter receives confirmation only — never moderation decisions.
    private func submit() {
        guard let reason = selected else { return }
        state = .submitting
        Task {
            do {
                try await env.api.reportEvent(
                    eventId: eventId,
                    reasonCode: reason.wireCode,
                    details: details.isEmpty ? nil : details)
                state = .submitted
                try? await Task.sleep(nanoseconds: 900_000_000)
                dismiss()
            } catch let error as HEATError {
                state = .failed(error.message)
            } catch {
                state = .failed("Couldn't submit right now.")
            }
        }
    }
}
