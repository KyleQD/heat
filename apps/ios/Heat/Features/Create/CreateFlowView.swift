import SwiftUI
import HeatKit

/// M5 — create location bar shown while pinning the event position.
struct CreateLocationBar: View {
    @EnvironmentObject private var env: AppEnvironment
    let onSelectVenue: (UUID, String, Coordinate) -> Void
    let onUseMyLocation: () -> Void
    let onNext: () -> Void
    let onCancel: () -> Void

    enum LocationHint: Equatable {
        case none
        case locating
        case denied
    }
    @State private var hint: LocationHint = .none

    var body: some View {
        VStack(spacing: 10) {
            VenueSearchField(onVenue: onSelectVenue)

            // R2-008 — visible current-location path; venue/pin stay usable
            // regardless of permission outcome.
            Button(action: useMyLocationTapped) {
                Label(hint == .locating ? "Finding you…" : "Use My Location",
                      systemImage: "location.circle.fill")
                    .font(.footnote.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.heatAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(.heatAccent)
            }
            .disabled(hint == .locating)
            .accessibilityLabel("Use my current location for the event")

            if hint == .denied {
                Label("Location is off — drop a pin or search a venue instead.",
                      systemImage: "location.slash")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            pinRow
        }
        .panelStyle()
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }

    private func useMyLocationTapped() {
        switch env.locationService.authorizationState {
        case .granted:
            beginLocating()
        case .denied, .restricted:
            hint = .denied
        default:
            Task {
                let state = await env.locationService.requestPermissionIfNeeded()
                if state == .granted || env.locationService.currentCoordinate != nil {
                    beginLocating()
                } else {
                    hint = .denied
                }
            }
        }
    }

    private func beginLocating() {
        hint = .locating
        env.locationService.refreshLocation()
        Task {
            // Brief bounded wait for the first fix.
            for _ in 0..<12 {
                if let c = env.locationService.currentCoordinate {
                    onUseMyLocation()
                    _ = c
                    hint = .none
                    return
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
            hint = .denied   // no fix available — steer to pin/venue paths
        }
    }

    private var pinRow: some View {
        HStack(spacing: 12) {
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.footnote.bold())
                    .padding(10)
                    .background(.white.opacity(0.1), in: Circle())
            }
            .accessibilityLabel("Cancel creating")

            VStack(alignment: .leading, spacing: 2) {
                Text("Where is your event?")
                    .font(.subheadline.weight(.bold))
                Text("Drag the map to place the pin")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(action: onNext) {
                Text("Next").font(.subheadline.weight(.heavy))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.heatAccent, in: Capsule())
                    .foregroundColor(.black)
            }
            .accessibilityLabel("Confirm location")
        }
    }
}

/// M6 — required + optional details over the map (bottom sheet, not a page).
struct CreateEventSheet: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var create: CreateStore

    let onClose: () -> Void
    @State private var showOptional = false

    var body: some View {
        NavigationStack {
            Form {
                Section("The basics") {
                    TextField("Event name", text: $create.draft.title)
                        .accessibilityLabel("Event name")

                    Picker("Category", selection: $create.draft.category) {
                        ForEach(EventCategory.allCases, id: \.self) { c in
                            Text(c.rawValue.capitalized).tag(c)
                        }
                    }

                    if let venue = create.selectedVenueName {
                        Label(venue, systemImage: "mappin.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.heatAccent)
                    } else {
                        Label(String(format: "%.4f, %.4f", create.draft.lat, create.draft.lng),
                              systemImage: "mappin.and.ellipse")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    DatePicker("Starts", selection: $create.draft.startsAt)
                    DatePicker("Ends", selection: $create.draft.endsAt,
                               in: create.draft.startsAt...)

                    for error in create.validationErrors {
                        Label(validationCopy(error), systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                if showOptional {
                    optionalSection
                }

                Section {
                    switch create.step {
                    case .reviewDuplicates(let candidates):
                        duplicateList(candidates)
                    case .publishing:
                        HStack { Spacer(); ProgressView(); Spacer() }
                    case .failed(let error):
                        Label(error.message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    default:
                        publishButton
                    }
                } footer: {
                    Text("Community events appear immediately with a community trust badge.")
                }
            }
            .navigationTitle("Create event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onClose)
                }
            }
        }
        .presentationDetents([.large])
    }

    private var optionalSection: some View {
        Group {
            Section("Optional") {
                TextField("Description", text: Binding(
                    get: { create.draft.descriptionText ?? "" },
                    set: { create.draft.descriptionText = $0.isEmpty ? nil : $0 }))
                TextField("Ticket link (https://…)", text: Binding(
                    get: { create.draft.ticketUrl ?? "" },
                    set: { create.draft.ticketUrl = $0.isEmpty ? nil : $0 }))
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        }
    }

    private func duplicateList(_ candidates: [DuplicateCandidate]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("This may already be on HEAT.", systemImage: "sparkles")
                .font(.subheadline.weight(.bold))
            ForEach(candidates) { candidate in
                Button {
                    create.chooseExisting(candidate: candidate)
                    onClose()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(candidate.title).font(.footnote.weight(.semibold))
                        Text("\(candidate.venueName ?? "") · \(Int(candidate.matchConfidence * 100))% match")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.bordered)
            }
            Button("It's different — create anyway", action: {
                Task {
                    await create.confirmCreateAnyway()
                }
            })
            .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var publishButton: some View {
        if create.step == .optionalDetails || showOptional {
            Button {
                Task { await create.runDuplicateCheck() }
            } label: {
                Text(showOptional ? "Check & Publish" : "Next")
                    .frame(maxWidth: .infinity).bold()
            }
            .disabled(!create.validationErrors.isEmpty)
        } else {
            Button {
                if create.validationErrors.isEmpty {
                    Task { await create.runDuplicateCheck() }
                }
            } label: {
                Text("Publish to the map")
                    .frame(maxWidth: .infinity).bold()
            }
            .disabled(!create.validationErrors.isEmpty)
            Button("Add optional details") { showOptional = true }
        }
    }

    private func validationCopy(_ error: CreateStore.ValidationError) -> String {
        switch error {
        case .titleTooShort: return "Give it a longer name (3+ characters)"
        case .endBeforeStart: return "End time must be after start"
        case .durationTooLong: return "Events can't run longer than 14 days"
        case .startTooFarInPast: return "Start time is too far in the past"
        case .missingLocation: return "Pick a location first"
        }
    }
}
