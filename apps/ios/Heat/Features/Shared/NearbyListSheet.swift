import SwiftUI
import HeatKit

/// Doc 02 §16 / P1-011: screen-reader and list-first users get a textual
/// surface onto the same canonical events; selecting one returns to the map
/// exactly like search. Sorted by straight-line distance (labeled as such).
struct NearbyListSheet: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var discovery: DiscoveryStore
    @EnvironmentObject private var selection: SelectionStore
    @EnvironmentObject private var stars: StarStore

    let onClose: () -> Void
    let onSelect: (UUID) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if discovery.events.isEmpty {
                    ContentUnavailableView(
                        "No HEAT detected here yet.",
                        systemImage: "thermometer.low",
                        description: Text("Pan the map, change the time window, or create the first event.")
                    )
                } else {
                    List(sortedEvents) { event in
                        Button {
                            onSelect(event.id)
                        } label: {
                            row(event)
                        }
                        .tint(.primary)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(a11yLabel(event))
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Nearby events")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var referencePoint: Coordinate {
        env.locationService.currentCoordinate ?? env.city.center
    }

    private var sortedEvents: [MapEvent] {
        discovery.events
            .filter { $0.status != .canceled || stars.isStarred($0.id) }
            .sorted { lhs, rhs in
                GeoMath.haversineMeters(from: referencePoint,
                                        to: Coordinate(lat: lhs.lat, lng: lhs.lng))
                < GeoMath.haversineMeters(from: referencePoint,
                                          to: Coordinate(lat: rhs.lat, lng: rhs.lng))
            }
    }

    private func row(_ e: MapEvent) -> some View {
        HStack(spacing: 12) {
            HeatBadge(score: e.heatScore)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.title).font(.body.weight(.semibold)).lineLimit(1)
                Text([e.venueName ?? "Location TBA",
                      distanceText(e),
                      e.status == .canceled ? "Canceled" : nil]
                    .compactMap { $0 }
                    .joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if stars.isStarred(e.id) {
                Image(systemName: "star.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow)
            }
        }
    }

    private func distanceText(_ e: MapEvent) -> String {
        GeoMath.distanceText(
            from: referencePoint,
            to: Coordinate(lat: e.lat, lng: e.lng))
    }

    /// Score and confidence announced separately (a11y requirement).
    private func a11yLabel(_ e: MapEvent) -> String {
        "\(e.title). \(distanceText(e)). HEAT \(Int(e.heatScore)), \(e.confidence.displayText). \(e.trend.displayText)\(stars.isStarred(e.id) ? ". Starred" : "")"
    }
}
