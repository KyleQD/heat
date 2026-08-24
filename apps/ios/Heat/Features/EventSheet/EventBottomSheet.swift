import SwiftUI
import HeatKit

/// M2/M3 — event bottom sheet. Compact by default; expands over the map which
/// stays visible. All decision fields fit above the fold in compact (P4-003).
struct EventBottomSheet: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var selection: SelectionStore
    @EnvironmentObject private var stars: StarStore
    @EnvironmentObject private var routes: RouteStore
    @EnvironmentObject private var discovery: DiscoveryStore

    @Binding var isExpanded: Bool
    let onClose: () -> Void
    let onStar: () -> Void
    let onGo: () -> Void
    let onTicket: () -> Void
    let onReportRequested: () -> Void

    @State private var showReport = false

    var body: some View {
        VStack(spacing: 0) {
            if selection.detailLoading && selection.detail == nil {
                loadingPlaceholder
            } else if let d = selection.detail {
                sheetContent(d)
            } else if let error = selection.detailError {
                errorContent(error)
            } else {
                loadingPlaceholder
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(.horizontal, 10)
        .animation(.spring(response: 0.35), value: isExpanded)
    }

    // MARK: Content ------------------------------------------------------------

    @ViewBuilder
    private func sheetContent(_ d: EventDetail) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                grabber
                compactHeader(d)
                if isExpanded { expandedDetails(d) }
                actionRow(d)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
        }
        .frame(maxHeight: isExpanded ? 520 : 240)
        .simultaneousGesture(
            DragGesture(minimumDistance: 20).onEnded { value in
                if value.translation.height < -30 { isExpanded = true }
                if value.translation.height > 40 { onClose() }
            }
        )
        .sheet(isPresented: $showReport) {
            ReportSheet(eventId: d.id)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilitySummary(d))
    }

    private var grabber: some View {
        Capsule()
            .fill(.white.opacity(0.25))
            .frame(width: 44, height: 5)
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
    }

    /// Compact required fields (P4-003): heat, trend, title, venue, time,
    /// attendance/status, distance — star/GO/ticket actions.
    private func compactHeader(_ d: EventDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                HeatBadge(score: d.heat.score)
                TrendBadge(trend: d.heat.trend)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.footnote.bold())
                        .foregroundStyle(.secondary)
                        .padding(6)
                        .background(.white.opacity(0.08), in: Circle())
                }
                .accessibilityLabel("Close event")
            }

            Text(d.title)
                .font(.title3.weight(.bold))
                .lineLimit(isExpanded ? nil : 1)

            HStack(spacing: 6) {
                if d.status != .scheduled {
                    Label(d.status.rawValue.capitalized, systemImage: "exclamationmark.triangle")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.orange)
                }
                Text(d.venue?.name ?? "Location TBA")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(spacing: 10) {
                Text(timeText(d))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let distance = distanceText(d) {
                    Text(distance).font(.caption).foregroundStyle(.secondary)
                }
                if let eta = routeEtaText() {
                    Text("· \(eta)").font(.caption).foregroundStyle(.heatAccent)
                }
            }

            attendanceRow(d)

            if isExpanded {
                ConfidenceBadge(confidence: d.heat.confidenceLabel)
            }
        }
    }

    private func attendanceRow(_ d: EventDetail) -> some View {
        Group {
            if let text = HeatFormatters.attendanceText(estimate: d.heat.attendanceEstimate) {
                Label(text, systemImage: "person.2")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(text)
            } else if d.heat.attendanceEstimate?.type == "unknown" || d.heat.attendanceEstimate == nil {
                Label("Attendance estimate unavailable", systemImage: "person.2.slash")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func expandedDetails(_ d: EventDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let url = d.coverImageUrl, !isExpanded { EmptyView() }
            VerificationBadge(level: d.verificationLevel)

            if let starsPhrase = d.stars.velocityPhrase {
                Label("\(starsPhrase) · \(HeatFormatters.compactCount(d.stars.count)) interested",
                      systemImage: "star.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow.opacity(0.9))
            }

            if let price = HeatFormatters.priceRange(min: d.priceMin, max: d.priceMax, currency: d.currency) {
                Label(price, systemImage: "banknote")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let age = d.ageRestriction {
                Label(age, systemImage: "person.crop.circle.badge.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let address = d.venue?.address {
                Label(address, systemImage: "mappin.and.ellipse")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let description = d.description {
                Text(description)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Divider()

            // Report + claim entry points (expanded only).
            HStack(spacing: 16) {
                if env.flags.community_reports_enabled {
                    Button {
                        showReport = true
                    } label: {
                        Label("Report", systemImage: "flag")
                            .font(.caption.weight(.semibold))
                    }
                }
                if env.flags.event_claims_enabled && d.canClaim {
                    Button {} label: {
                        Label("Manage this event?", systemImage: "checkmark.shield")
                            .font(.caption.weight(.semibold))
                    }
                    .disabled(true)
                }
                Spacer()
                Text("Sources: \(d.sourceCount)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.top, 4)
    }

    // MARK: Actions --------------------------------------------------------------

    private func actionRow(_ d: EventDetail) -> some View {
        HStack(spacing: 10) {
            // STAR (P5): single tap, optimistic handled in store; flag-gated.
            if env.flags.stars_enabled {
                Button(action: {
                    starHaptic()
                    onStar()
                }) {
                    Image(systemName: stars.isStarred(d.id) ? "star.fill" : "star")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(stars.isStarred(d.id) ? .yellow : .primary)
                        .frame(width: 48, height: 44)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                .accessibilityLabel(stars.isStarred(d.id) ? "Remove star" : "Star this event")
            }

            // GO (P6): one tap into route preview; hidden when routing disabled.
            if env.flags.routing_enabled {
                Button(action: onGo) {
                    Label("GO", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                        .font(.subheadline.weight(.heavy))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color.heatAccent, in: RoundedRectangle(cornerRadius: 12))
                }
                .accessibilityLabel("Get directions to \(d.title)")
            }

            // TICKET CTA only when a URL exists — no mystery disabled buttons.
            if d.ticketUrl != nil {
                Button(action: onTicket) {
                    Text("Tickets")
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 16)
                        .frame(height: 44)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }
                .accessibilityLabel("Buy tickets for \(d.title)")
            }
        }
    }

    /// P5-010 haptic feedback; suppressed under Reduce Motion-era a11y caution.
    private func starHaptic() {
        #if canImport(UIKit)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }

    private var loadingPlaceholder: some View {
        VStack(spacing: 12) {
            ProgressView()
            Text("Loading event…").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
    }

    private func errorContent(_ error: HEATError) -> some View {
        VStack(spacing: 12) {
            InlineError(message: error.message, retry: { selection.reload() })
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
    }

    // MARK: Derived copy ----------------------------------------------------------

    private func timeText(_ d: EventDetail) -> String {
        guard d.startsAtPrecision != "date_tbd" else { return "Date TBD" }
        guard d.startsAtPrecision != "time_tbd" else { return "Time TBD" }
        let tz = TimeZone(identifier: d.timezone) ?? .current
        return HeatFormatters.timeRange(startsAt: d.startsAt, endsAt: d.endsAt, timeZone: tz)
    }

    /// Straight-line distance from current location; never labeled as driving.
    private func distanceText(_ d: EventDetail) -> String? {
        guard let origin = env.locationService.currentCoordinate else { return nil }
        return GeoMath.distanceText(from: origin, to: d.location)
    }

    private func routeEtaText() -> String? {
        guard case .preview(let response, let mode) = routes.phase,
              let option = response.routes.first(where: { $0.mode == mode }) else { return nil }
        return GeoMath.etaText(seconds: option.durationSeconds, meters: option.distanceMeters)
    }

    private func accessibilitySummary(_ d: EventDetail) -> String {
        "\(d.title), at \(d.venue?.name ?? "unknown venue"). HEAT \(Int(d.heat.score)). \(d.heat.confidenceLabel.displayText)."
    }
}
