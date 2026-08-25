
import MapKit
import SwiftUI
import HeatKit

// MARK: - Client-side collision cluster (mid-zoom merge of nearby markers)

final class ClientClusterView: MKAnnotationView {
    private let label = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        label.font = .systemFont(ofSize: 12, weight: .black)
        label.textColor = .white
        label.textAlignment = .center
        addSubview(label)
        displayPriority = .defaultHigh
    }

    required init?(coder aDecoder: NSCoder) { fatalError("unsupported") }

    func configure(with cluster: MKClusterAnnotation) {
        let members = cluster.memberAnnotations.compactMap { $0 as? EventAnnotation }
        let maxHeat = members.map(\.event.heatScore).max() ?? 40
        backgroundColor = UIColor(Color.heatColor(score: maxHeat))
        layer.cornerRadius = 14
        bounds = CGRect(x: 0, y: 0, width: 28, height: 28)
        label.frame = bounds
        label.text = "\(max(2, members.count))"
        alpha = 0.9
        isAccessibilityElement = true
        accessibilityLabel = "\(members.count) events clustered. Zoom in to browse."
    }
}
