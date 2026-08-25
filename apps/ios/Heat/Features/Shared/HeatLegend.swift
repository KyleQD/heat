
// MARK: - Heat legend (color must not be the only signal — a11y §16)

struct HeatLegend: View {
    @EnvironmentObject private var env: AppEnvironment
    @AppStorage("heat.legend.collapsed") private var collapsed = true

    var body: some View {
        Button {
            withAnimation(.spring(response: 0.3)) { collapsed.toggle() }
        } label: {
            if collapsed {
                Image(systemName: "circle.hexagongrid.circle")
                    .font(.system(size: 15))
                    .padding(9)
                    .background(.ultraThinMaterial, in: Capsule())
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(tiers, id: \.0) { tier, label in
                        HStack(spacing: 6) {
                            Circle().fill(Color.heatColor(forTier: tier)).frame(width: 8, height: 8)
                            Text(label).font(.caption2)
                        }
                    }
                }
                .padding(10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .accessibilityLabel("HEAT intensity legend")
        .accessibilityHint(collapsed ? "Shows what marker colors mean" : "Hides legend")
    }

    private var tiers: [(HeatFormatters.HeatTier, String)] {
        [(.surging, "Surging"), (.hot, "Hot"), (.warm, "Warming"), (.inactive, "Quiet")]
    }
}
