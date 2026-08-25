import SwiftUI
import HeatKit

/// Single root consumer route (doc 25 §2). Everything is an overlay on the map.
struct RootView: View {
    @EnvironmentObject private var env: AppEnvironment
    @EnvironmentObject private var discovery: DiscoveryStore

    var body: some View {
        HeatMapScreen()
            .preferredColorScheme(.dark)
            .tint(.heatAccent)
    }
}

extension Color {
    /// HEAT brand accent — ember orange.
    static let heatAccent = Color(red: 1.0, green: 0.48, blue: 0.22)
}

/// Enables `.background(.heatAccent)` / AnyShapeStyle(.heatAccent) usage.
extension ShapeStyle where Self == Color {
    static var heatAccent: Color { .heatAccent }
}

    static func heatColor(forTier tier: HeatFormatters.HeatTier) -> Color {
        switch tier {
        case .inactive: return Color(red: 0.45, green: 0.55, blue: 0.75)
        case .warm: return Color(red: 1.0, green: 0.72, blue: 0.25)
        case .hot: return Color(red: 1.0, green: 0.42, blue: 0.20)
        case .surging: return Color(red: 1.0, green: 0.22, blue: 0.38)
        }
    }

    static func heatColor(score: Double) -> Color {
        heatColor(forTier: HeatFormatters.heatTier(score: score))
    }
}
