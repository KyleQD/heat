import MapKit
import UIKit
import SwiftUI
import HeatKit

// MARK: - Annotation models

final class EventAnnotation: NSObject, MKAnnotation {
    let id: UUID
    let event: MapEvent
    var starred: Bool
    weak var view: EventMarkerView?

    init(event: MapEvent, starred: Bool) {
        self.id = event.id
        self.event = event
        self.starred = starred
        super.init()
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: event.lat, longitude: event.lng)
    }

    /// VoiceOver text — score and confidence announced separately (a11y §16).
    var accessibilityText: String {
        "\(event.title). HEAT \(Int(event.heatScore)), \(event.confidence.displayText). \(event.trend.displayText)"
    }
}

final class ClusterAnnotation: NSObject, MKAnnotation {
    let cluster: ClusterPoint

    init(cluster: ClusterPoint) { self.cluster = cluster }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng)
    }
}

final class CreatePinAnnotation: NSObject, MKAnnotation {
    private let coord: CLLocationCoordinate2D
    init(coordinate: Coordinate) {
        coord = CLLocationCoordinate2D(latitude: coordinate.lat, longitude: coordinate.lng)
    }
    var coordinate: CLLocationCoordinate2D { coord }
}

// MARK: - Event marker view (heat identity, star badge, selection ring)

final class EventMarkerView: MKAnnotationView {

    private let container = UIView()
    private let dotLayer = CALayer()
    private let ringLayer = CAShapeLayer()
    private let pulseLayer = CAShapeLayer()
    private let badgeLabel = UILabel()

    private(set) var isSelectedState = false {
        didSet { guard oldValue != isSelectedState else { return }; applySelectionLook() }
    }

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        commonInit()
    }

    required init?(coder aDecoder: NSCoder) {
        super.init(coder: aDecoder)
        commonInit()
    }

    private func commonInit() {
        frame = CGRect(x: 0, y: 0, width: 36, height: 36)
        // MapKit merges colliding markers between the server's cluster bands,
        // so dense blocks never render as overlapping dots (UX §5 Z1/Z2).
        clusteringIdentifier = "heatEvent"
        layer.addSublayer(pulseLayer)
        layer.addSublayer(ringLayer)
        layer.addSublayer(dotLayer)
        badgeLabel.font = .systemFont(ofSize: 10, weight: .heavy)
        badgeLabel.textAlignment = .center
        addSubview(badgeLabel)
        collisionMode = .circle
        displayPriority = .defaultHigh
    }

    func configure(event: MapEvent, starred: Bool) {
        let tier = HeatFormatters.heatTier(score: event.heatScore)
        let color = UIColor(Color.heatColor(forTier: tier))

        dotLayer.backgroundColor = color.cgColor
        ringLayer.fillColor = nil
        ringLayer.strokeColor = starred ? UIColor.systemYellow.cgColor : color.withAlphaComponent(0.85).cgColor
        ringLayer.lineWidth = starred ? 3 : 1.5
        badgeLabel.text = starred ? "★" : nil
        badgeLabel.textColor = .systemYellow

        // Canceled events are dimmed but visible with status glyph (GEO-AC-004).
        alpha = event.status == .canceled ? 0.45 : 1

        // Surging pulse — gentle, respects Reduce Motion.
        pulseLayer.strokeColor = color.cgColor
        pulseLayer.fillColor = nil
        removePulse()
        if tier == .surging && event.status != .canceled && !UIAccessibility.isReduceMotionEnabled {
            addPulse(color: color)
        }
        setNeedsLayout()
    }

    private func addPulse(color: UIColor) {
        pulseLayer.isHidden = false
        let anim = CABasicAnimation(keyPath: "transform.scale")
        anim.fromValue = 0.7
        anim.toValue = 1.5
        anim.duration = 1.4
        anim.repeatCount = .infinity
        anim.autoreverses = true
        pulseLayer.add(anim, forKey: "pulse")
    }

    private func removePulse() {
        pulseLayer.removeAnimation(forKey: "pulse")
        pulseLayer.isHidden = true
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let size = bounds.width
        dotLayer.frame = CGRect(x: 8, y: 8, width: size - 16, height: size - 16)
        dotLayer.cornerRadius = dotLayer.bounds.width / 2
        ringLayer.frame = CGRect(x: 4, y: 4, width: size - 8, height: size - 8)
        ringLayer.path = UIBezierPath(ovalIn: ringLayer.bounds).cgPath
        pulseLayer.frame = CGRect(x: 0, y: 0, width: size, height: size)
        pulseLayer.path = UIBezierPath(ovalIn: pulseLayer.bounds).cgPath
        badgeLabel.frame = CGRect(x: 20, y: -6, width: 22, height: 18)
    }

    private func applySelectionLook() {
        // The selected marker must never be absorbed into a cluster (P12 L4).
        clusteringIdentifier = isSelectedState ? nil : "heatEvent"
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.18) {
            self.transform = self.isSelectedState ? CGAffineTransform(scaleX: 1.35, y: 1.35) : .identity
            self.layer.zPosition = self.isSelectedState ? 1000 : 0
            self.ringLayer.lineWidth = self.isSelectedState ? 3 : 1.5
            self.ringLayer.strokeColor = (self.isSelectedState ? UIColor.white : UIColor(Color.heatAccent)).cgColor
        }
    }

    override var accessibilityLabel: String? {
        get { (annotation as? EventAnnotation)?.accessibilityText }
        set {}
    }
}

// MARK: - Cluster marker (count + aggregate intensity; tap zooms only)

final class ClusterMarkerView: MKAnnotationView {

    private let label = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        label.font = .systemFont(ofSize: 13, weight: .black)
        label.textColor = .white
        label.textAlignment = .center
        addSubview(label)
        displayPriority = .defaultLow
    }

    required init?(coder aDecoder: NSCoder) { fatalError("unsupported") }

    func configure(cluster: ClusterPoint) {
        let color = UIColor(Color.heatColor(score: cluster.maxHeatScore))
        if #available(iOS 16.0, *) {
            backgroundConfiguration = UIBackgroundConfiguration.clear()
        }
        backgroundColor = color
        layer.cornerRadius = 17
        bounds = CGRect(x: 0, y: 0, width: 34, height: 34)
        label.frame = bounds
        label.text = "\(cluster.count)"
        alpha = 0.92
    }
}

// MARK: - Create pin

final class CreatePinView: MKAnnotationView {
    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        let pin = UIImageView(image: UIImage(systemName: "mappin.circle.fill",
                                             withConfiguration: UIImage.SymbolConfiguration(pointSize: 40, weight: .bold)))
        pin.tintColor = UIColor(Color.heatAccent)
        addSubview(pin)
        frame = CGRect(x: 0, y: 0, width: 40, height: 40)
        isAccessibilityElement = true
        accessibilityLabel = "Chosen event location"
    }
    required init?(coder aDecoder: NSCoder) { fatalError("unsupported") }
}

// MARK: - Heat overlay + renderer (L1, non-interactive activity field)

final class HeatCircleOverlay: NSObject, MKOverlay {
    let coordinate: CLLocationCoordinate2D
    let radius: CLLocationDistance
    let weight: Double

    init(center: CLLocationCoordinate2D, radius: CLLocationDistance, weight: Double) {
        self.coordinate = center
        self.radius = radius
        self.weight = weight
    }

    var boundingMapRect: MKMapRect {
        let metersPerDegLat = 111_320.0
        let metersPerDegLng = max(15_000.0, 111_320.0 * cos(coordinate.latitude * .pi / 180))
        let span = MKCoordinateSpan(latitudeDelta: radius * 2 / metersPerDegLat,
                                    longitudeDelta: radius * 2 / metersPerDegLng)
        let topLeft = MKMapPoint(CLLocationCoordinate2D(latitude: coordinate.latitude + span.latitudeDelta / 2,
                                                        longitude: coordinate.longitude - span.longitudeDelta / 2))
        let bottomRight = MKMapPoint(CLLocationCoordinate2D(latitude: coordinate.latitude - span.latitudeDelta / 2,
                                                            longitude: coordinate.longitude + span.longitudeDelta / 2))
        return MKMapRect(x: min(topLeft.x, bottomRight.x),
                         y: min(topLeft.y, bottomRight.y),
                         width: abs(bottomRight.x - topLeft.x),
                         height: abs(bottomRight.y - topLeft.y))
    }
}

/// Radial gradient renderer so heat reads as an ambient field, not a boundary.
final class HeatCircleRenderer: MKOverlayRenderer {

    private let overlay_: HeatCircleOverlay

    init(overlay: HeatCircleOverlay) {
        self.overlay_ = overlay
        super.init(overlay: overlay)
    }

    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        let rect = self.rect(for: overlay_.boundingMapRect)
        guard rect.width.isFinite, rect.height.isFinite, rect.width > 2 else { return }
        context.saveGState()
        defer { context.restoreGState() }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let base = UIColor(Color.heatColor(score: overlay_.weight * 100))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        base.getRed(&r, green: &g, blue: &b, alpha: &a)

        let alphaTop = 0.16 + 0.30 * overlay_.weight   // low confidence already damped server-side
        let colors = [
            base.withAlphaComponent(CGFloat(alphaTop)).cgColor,
            base.withAlphaComponent(CGFloat(alphaTop * 0.45)).cgColor,
            base.withAlphaComponent(0).cgColor,
        ] as CFArray
        guard let gradient = CGGradient(colorsSpace: colorSpace,
                                        colors: colors,
                                        locations: [0, 0.55, 1]) else { return }
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = max(rect.width, rect.height) / 2
        context.drawRadialGradient(gradient,
                                   startCenter: center, startRadius: 0,
                                   endCenter: center, endRadius: radius,
                                   options: [.drawsBeforeStartLocation])
    }
}
