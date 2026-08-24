import SwiftUI
import HeatKit

/// M7 — search overlay. Results return the user to the map; never a separate
/// results page (UX spec §13). Also the accessibility fallback surface.
struct SearchOverlayView: View {
    @EnvironmentObject private var env: AppEnvironment

    let onClose: () -> Void
    let onSelect: (SearchItem) -> Void

    @State private var query = ""
    @State private var results: [SearchItem] = []
    @State private var searching = false
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Events, venues, neighborhoods", text: $query)
                    .focused($fieldFocused)
                    .submitLabel(.search)
                    .onSubmit { performSearch(immediate: true) }
                    .onChange(of: query) { _ in performSearch(immediate: false) }
                if !query.isEmpty {
                    Button {
                        query = ""
                        results = []
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                }
                Button("Done", action: onClose).font(.subheadline.bold())
            }
            .padding(14)
            .background(.regularMaterial)

            if searching {
                ProgressView().padding(.top, 30)
                Spacer()
            } else if results.isEmpty && query.count >= 2 {
                VStack(spacing: 8) {
                    Image(systemName: "questionmark.text.peace")
                        .font(.title2).foregroundStyle(.secondary)
                    Text("Nothing found — try an event or venue name.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.top, 40)
                Spacer()
            } else {
                List(results) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        row(item)
                    }
                    .tint(.primary)
                }
                .listStyle(.plain)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 0))
        .onAppear { fieldFocused = true }
    }

    private func row(_ item: SearchItem) -> some View {
        HStack(spacing: 12) {
            switch item {
            case .event(_, _, _, _, _, let heat, _):
                Image(systemName: "flame.fill")
                    .foregroundColor(Color.heatColor(score: heat))
            case .venue:
                Image(systemName: "building.2")
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.semibold))
                switch item {
                case .event(_, _, let subtitle, _, _, _, let startsAt):
                    Text(subtitle ?? subtitleFallback(startsAt))
                        .font(.caption).foregroundStyle(.secondary)
                case .venue(_, _, let locality, _, _):
                    Text(locality ?? "Venue")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func subtitleFallback(_ date: Date?) -> String {
        guard let d = date else { return "Event" }
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return "Starts \(f.localizedString(for: d, relativeTo: Date()))"
    }

    /// Debounced; cancels obsolete requests like the map viewport (P1-008 rule).
    private func performSearch(immediate: Bool) {
        searchTask?.cancel()
        guard query.trimmingCharacters(in: .whitespaces).count >= 2 else {
            results = []
            return
        }
        let delay: UInt64 = immediate ? 0 : 280_000_000
        let q = query
        searchTask = Task {
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            searching = true
            do {
                let found = try await env.api.search(q: q)
                guard !Task.isCancelled else { return }
                results = found
            } catch {}
            searching = false
        }
    }
}

// MARK: - Inline venue search for create flow (P3-003)

struct VenueSearchField: View {
    @EnvironmentObject private var env: AppEnvironment

    /// Selected venue callback — resolves canonical venue into the draft.
    let onVenue: (UUID, String, Coordinate) -> Void

    @State private var query = ""
    @State private var venues: [SearchItem] = []
    @State private var task: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "building.2")
                    .foregroundStyle(.secondary)
                TextField("Search venues", text: $query)
                    .onChange(of: query) { _ in runSearch() }
                if !query.isEmpty {
                    Button {
                        query = ""
                        venues = []
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12)
            .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))

            if !venues.isEmpty {
                VStack(spacing: 2) {
                    ForEach(venues.prefix(5)) { item in
                        Button {
                            if case .venue(let id, let name, _, let lat, let lng) = item {
                                onVenue(id, name, Coordinate(lat: lat, lng: lng))
                                query = ""
                                venues = []
                            }
                        } label: {
                            HStack {
                                Text(item.title).font(.footnote.weight(.semibold))
                                Spacer()
                                Image(systemName: "mappin")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                        }
                        .tint(.primary)
                    }
                }
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }

    private func runSearch() {
        task?.cancel()
        guard query.trimmingCharacters(in: .whitespaces).count >= 2 else {
            venues = []
            return
        }
        let q = query
        task = Task {
            try? await Task.sleep(nanoseconds: 260_000_000)
            guard !Task.isCancelled else { return }
            let found = (try? await env.api.search(q: q)) ?? []
            venues = found.filter {
                if case .venue = $0 { return true }
                return false
            }
        }
    }
}
