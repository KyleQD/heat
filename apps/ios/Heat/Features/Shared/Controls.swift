import SwiftUI
import HeatKit

// MARK: - Map chrome buttons

struct BrandButton: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "flame.fill")
                .foregroundStyle(.heatAccent)
            Text("HEAT")
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .tracking(1.5)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityLabel("HEAT home")
    }
}

struct SearchBarButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: "magnifyingglass")
                Text("Search")
                    .font(.subheadline)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 220)
    }
}

struct CircleIconButton: View {
    let systemImage: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(isActive ? .black : .primary)
                .frame(width: 44, height: 44)
                .background(isActive ? AnyShapeStyle(.heatAccent) : AnyShapeStyle(.ultraThinMaterial),
                            in: Circle())
        }
        .shadow(color: .black.opacity(0.25), radius: 6, y: 2)
    }
}

// MARK: - Time window + starred + filters

struct TimeWindowToggle: View {
    @Binding var selection: TimeWindow

    var body: some View {
        HStack(spacing: 2) {
            ForEach(TimeWindow.allCases, id: \.self) { w in
                Button {
                    withAnimation(.spring(response: 0.3)) { selection = w }
                } label: {
                    Text(w.displayText)
                        .font(.footnote.weight(.bold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(selection == w ? AnyShapeStyle(.heatAccent) : AnyShapeStyle(.clear),
                                    in: Capsule())
                        .foregroundColor(selection == w ? .black : .primary)
                }
                .accessibilityLabel("\(w == .now ? "Happening now" : "Tonight") filter")
                .accessibilityAddTraits(selection == w ? .isSelected : [])
            }
        }
        .padding(3)
        .background(.ultraThinMaterial, in: Capsule())
    }
}

struct StarredToggleButton: View {
    @Binding var isOn: Bool

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.3)) { isOn.toggle() }
        } label: {
            Image(systemName: isOn ? "star.fill" : "star")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(isOn ? .yellow : .primary)
                .padding(.horizontal, 13)
                .padding(.vertical, 9)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .accessibilityLabel("Starred events only")
        .accessibilityValue(isOn ? "on" : "off")
    }
}

struct FilterButton: View {
    @Binding var category: EventCategory?
    @State private var showMenu = false

    var body: some View {
        Menu {
            Button("All categories") { category = nil }
            ForEach(EventCategory.allCases, id: \.self) { c in
                Button(c.rawValue.capitalized) { category = c }
            }
        } label: {
            Image(systemName: category == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                .font(.system(size: 15))
                .padding(9)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .accessibilityLabel("Filter by category")
    }
}

// MARK: - Badges (event sheet)

struct HeatBadge: View {
    let score: Double

    var body: some View {
        let tier = HeatFormatters.heatTier(score: score)
        HStack(spacing: 5) {
            Text(tier.glyph)
                .font(.system(size: 12, weight: .black))
            Text(String(Int(score)))
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .monospacedDigit()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.heatColor(forTier: tier).opacity(0.22), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.heatColor(forTier: tier), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("HEAT \(Int(score)), \(tier.accessibilityPattern)")
    }
}

struct TrendBadge: View {
    let trend: TrendLabel

    var body: some View {
        Label(trend.displayText,
              systemImage: iconName)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.white.opacity(0.08), in: Capsule())
            .accessibilityLabel("Trend: \(trend.displayText)")
    }

    private var iconName: String {
        switch trend {
        case .surging, .heatingUp, .warmingUp: return "arrow.up.right"
        case .peaking, .hot: return "flame.fill"
        case .coolingDown, .ending: return "arrow.down.right"
        case .steady: return "equal"
        case .upcoming: return "clock"
        }
    }
}

struct ConfidenceBadge: View {
    let confidence: ConfidenceLabel

    var body: some View {
        Label(confidence.displayText, systemImage: symbol)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Evidence: \(confidence.displayText)")
    }

    private var symbol: String {
        switch confidence {
        case .estimated: return "circle.dotted"
        case .medium: return "circle.lefthalf.filled"
        case .high: return "checkmark.seal"
        case .verifiedLive: return "checkmark.seal.fill"
        }
    }
}

struct VerificationBadge: View {
    let level: VerificationLevel

    var body: some View {
        if level != .community {
            Label(level.displayText, systemImage: "checkmark.seal.fill")
                .font(.caption2)
                .foregroundStyle(.blue.opacity(0.9))
        }
    }
}

// MARK: - Status cards

struct EmptyStateCard: View {
    let onTonight: () -> Void
    let onExpand: () -> Void
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "thermometer.low")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("No HEAT detected here yet.")
                .font(.subheadline.weight(.medium))
            HStack(spacing: 8) {
                smallButton("Tonight", onTonight)
                smallButton("Expand area", onExpand)
                smallButton("Create event", onCreate, prominent: true)
            }
        }
        .padding(18)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 40)
        .transition(.opacity)
    }

    private func smallButton(_ title: String, _ action: @escaping () -> Void, prominent: Bool = false) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(prominent ? AnyShapeStyle(.heatAccent) : AnyShapeStyle(.white.opacity(0.1)),
                            in: Capsule())
                .foregroundColor(prominent ? .black : .primary)
        }
    }
}

struct InlineError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack {
            Image(systemName: "wifi.exclamationmark")
            Text(message).font(.footnote)
            Spacer()
            Button("Retry", action: retry)
                .font(.footnote.bold())
        }
        .padding(12)
        .background(.red.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
    }
}

struct OfflineBanner: View {
    var body: some View {
        Label("You're offline — showing last loaded HEAT", systemImage: "wifi.slash")
            .font(.footnote.weight(.medium))
            .frame(maxWidth: .infinity)
            .padding(10)
            .background(.orange.opacity(0.85), in: RoundedRectangle(cornerRadius: 12))
            .padding(.horizontal, 14)
    }
}

/// M10 — location denied keeps the map usable in the pilot city.
struct LocationDeniedCard: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "location.slash")
            Text("Showing Las Vegas · location off")
                .font(.footnote.weight(.medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: Capsule())
    }
}
