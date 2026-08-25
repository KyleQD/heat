import SwiftUI
import HeatKit

/// M4 — route preview. Destination, modes, ETA/distance, polyline on map,
/// Start Route handoff. Never a full navigation product (P6).
struct RoutePreviewPanel: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var routes: RouteStore
    @EnvironmentObject private var selection: SelectionStore

    let onClose: () -> Void

    /// R2-009 — enhancement ownership lives in RouteStore; the panel simply
    /// reads the same displayOption the map draws.
    private func kickEnhancement() {
        guard env.locationService.currentCoordinate != nil else { return }
        routes.enhanceSelectedMode(origin: env.locationService.currentCoordinate)
    }

    var body: some View {
        content
            .onAppear { kickEnhancement() }
            .onChange(of: routes.phase) { _ in kickEnhancement() }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 12) {
            switch routes.phase {
            case .idle:
                EmptyView()
            case .requesting:
                HStack {
                    ProgressView().tint(.heatAccent)
                    Text("Finding the fastest way there…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .panelStyle()
            case .preview(let response, let selectedMode):
                previewContent(response, selectedMode)
            case .failed(let error):
                failedContent(error)
            }
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 8)
    }

    // MARK: Preview -------------------------------------------------------------

    private func previewContent(_ response: RoutePreviewResponse, _ selectedMode: TravelMode) -> some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(selection.detail?.title ?? "Destination")
                        .font(.subheadline.weight(.bold))
                        .lineLimit(1)
                    if let option = routes.displayOption(for: selectedMode) {
                        Text(GeoMath.etaText(seconds: option.durationSeconds,
                                             meters: Double(option.distanceMeters)))
                            .font(.title3.weight(.heavy))
                            .foregroundStyle(.heatAccent)
                    }
                }
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.footnote.bold())
                        .padding(6)
                        .background(.white.opacity(0.1), in: Circle())
                }
                .accessibilityLabel("Close route preview")
            }

            // Mode chips — unavailable modes simply don't render (partial OK).
            HStack(spacing: 8) {
                ForEach(response.routes.map(\.mode), id: \.self) { mode in
                    modeChip(mode, isSelected: mode == selectedMode)
                }
                if response.partial {
                    Label("Some modes unavailable", systemImage: "info.circle")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            startRouteButton(selectedMode)
        }
        .panelStyle()
    }

    private func modeChip(_ mode: TravelMode, isSelected: Bool) -> some View {
        Button {
            routes.selectMode(mode)
        } label: {
            Label(mode.displayText, systemImage: icon(mode))
                .font(.caption.weight(.bold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(isSelected ? AnyShapeStyle(.heatAccent) : AnyShapeStyle(.white.opacity(0.08)),
                            in: Capsule())
                .foregroundColor(isSelected ? .black : .primary)
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func startRouteButton(_ mode: TravelMode) -> some View {
        Menu {
            ForEach(NavigationProvider.allCases, id: \.self) { provider in
                Button(provider == .appleMaps ? "Apple Maps" : "Google Maps") {
                    guard let mode = routes.selectedMode else { return }
                    Task {
                        await routes.startNavigation(provider: provider)
                        if let dest = routes.previewResponse?.destination {
                            NavigationHandoff.open(provider,
                                                   destination: dest,
                                                   mode: mode,
                                                   label: selection.detail?.title)
                        }
                    }
                }
                // R2-010 — never offer a provider/mode pair we can't honor.
                .disabled(!NavigationHandoffURLs.supports(provider, mode: routes.selectedMode ?? .drive))
            }
        } label: {
            Label("Start Route", systemImage: "location.north.circle.fill")
                .font(.subheadline.weight(.heavy))
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(Color.heatAccent, in: RoundedRectangle(cornerRadius: 14))
        }
        .accessibilityHint("Opens your chosen maps app")
    }

    // MARK: Failure (P6-011 fallback: GO never becomes unusable) ------------------

    private func failedContent(_ error: HEATError) -> some View {
        VStack(spacing: 10) {
            if error.code == .locationRequired {
                Label("Location unavailable — enable it or pick a start point.",
                      systemImage: "location.slash")
                    .font(.footnote)
            } else {
                Label("Route preview unavailable right now.", systemImage: "wifi.exclamationmark")
                    .font(.footnote)
            }
            HStack(spacing: 10) {
                Button {
                    if let d = selection.detail {
                        Task {
                            await routes.requestPreview(destination: d.routeDestination,
                                                        modes: TravelMode.allCases, eventId: d.id)
                        }
                    }
                } label: {
                    Text("Retry").font(.footnote.bold())
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.white.opacity(0.1), in: Capsule())
                }
                Button {
                    openExternalFallback()
                } label: {
                    Text("Open in Maps").font(.footnote.bold())
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Color.heatAccent, in: Capsule())
                }
            }
        }
        .frame(maxWidth: .infinity)
        .panelStyle()
    }

    /// Fallback: destination-only external launch with address copy option.
    private func openExternalFallback() {
        guard let d = selection.detail else { return }
        NavigationHandoff.open(.appleMaps,
                               destination: d.routeDestination,
                               mode: routes.selectedMode ?? .drive,
                               label: d.title)
    }

    private func icon(_ mode: TravelMode) -> String {
        switch mode {
        case .drive: return "car.fill"
        case .walk: return "figure.walk"
        case .transit: return "bus.fill"
        case .bike: return "bicycle"
        }
    }
}

extension View {
    func panelStyle() -> some View {
        background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
            .padding(.bottom, 2)
    }
}
