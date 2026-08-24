import SwiftUI
import MapKit
import HeatKit

/// Imperative camera commands handed from SwiftUI into the MKMapView wrapper.
@MainActor
final class MapCameraCommand: ObservableObject {
    var handler: ((CameraIntent) -> Void)?

    enum CameraIntent {
        case fly(Coordinate, follow: Bool)
        case zoomIn(Coordinate)
        case zoomOut
        /// Keep selected marker visible above the bottom sheet (P4 interaction).
        case shiftUpForSheet
    }

    func flyTo(_ coordinate: Coordinate, spanDelta: Double?, preserveFollow: Bool) {
        handler?(.fly(coordinate, follow: preserveFollow))
    }

    func fly(to coordinate: Coordinate) {
        handler?(.fly(coordinate, follow: false))
    }

    func zoomIn(on coordinate: Coordinate) { handler?(.zoomIn(coordinate)) }
    func zoomOut() { handler?(.zoomOut) }
    func shiftUpForSheet() { handler?(.shiftUpForSheet) }
}

struct ViewportRegion {
    let north: Double, south: Double, east: Double, west: Double
    let zoom: Double
    let center: Coordinate
}

/// P1-002 — map provider wrapper. The rest of the app never touches MKMapView;
/// swapping providers only changes this file (ADR-0002 reversibility).
struct MapCanvas: View {
    @EnvironmentObject private var env: AppEnvironment

    var events: [MapEvent]
    var clusters: [ClusterPoint]
    var heatPoints: [HeatPoint]
    var routePolyline: [Coordinate]
    var destination: Coordinate?
    var isCreateMode: Bool
    var pinCoordinate: Coordinate?
    var selectedEventId: UUID?
    var starredIds: Set<UUID>
    @ObservedObject var camera: MapCameraCommand

    var onViewportChange: (ViewportRegion) -> Void
    var onSelectEvent: (UUID) -> Void
    var onSelectCluster: (ClusterPoint) -> Void

    @State private var coordinatorBox = CoordinatorBox()

    var body: some View {
        MKMapViewRepresentable(
            events: events,
            clusters: clusters,
            heatPoints: heatPoints,
            routePolyline: routePolyline,
            destination: destination,
            isCreateMode: isCreateMode,
            pinCoordinate: pinCoordinate,
            selectedEventId: selectedEventId,
            starredIds: starredIds,
            box: coordinatorBox,
            camera: camera,
            onViewportChange: onViewportChange,
            onSelectEvent: onSelectEvent,
            onSelectCluster: onSelectCluster
        )
        .ignoresSafeArea()
    }
}

/// Bridge object holding a weak coordinator reference for command routing.
final class CoordinatorBox {
    weak var coordinator: CanvasCoordinator?
}

struct MKMapViewRepresentable: UIViewRepresentable {
    let events: [MapEvent]
    let clusters: [ClusterPoint]
    let heatPoints: [HeatPoint]
    let routePolyline: [Coordinate]
    let destination: Coordinate?
    let isCreateMode: Bool
    let pinCoordinate: Coordinate?
    let selectedEventId: UUID?
    let starredIds: Set<UUID>
    let box: CoordinatorBox
    let camera: MapCameraCommand
    let onViewportChange: (ViewportRegion) -> Void
    let onSelectEvent: (UUID) -> Void
    let onSelectCluster: (ClusterPoint) -> Void

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView(frame: .zero)
        context.coordinator.setMapView(map)
        map.delegate = context.coordinator
        map.showsUserLocation = true
        map.showsCompass = false
        map.pointOfInterestFilter = .excludingAll
        map.preferredConfiguration.elevationStyle = .flat

        if #available(iOS 16.0, *) {
            let config = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
            config.pointOfInterestFilter = .excludingAll
            map.preferredConfiguration = config
        }
        map.overrideUserInterfaceStyle = .dark
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        box.coordinator = context.coordinator
        if camera.handler == nil || context.coordinator.cameraBound == false {
            camera.handler = { [weak coordinator = context.coordinator] intent in
                coordinator?.apply(intent: intent)
            }
            context.coordinator.cameraBound = true
        }
        context.coordinator.sync(events: events,
                                 clusters: clusters,
                                 heatPoints: heatPoints,
                                 polyline: routePolyline,
                                 destination: destination,
                                 pin: pinCoordinate,
                                 selectedId: selectedEventId,
                                 starredIds: starredIds)
    }

    func makeCoordinator() -> CanvasCoordinator {
        CanvasCoordinator(parent: self)
    }
}

// MARK: - Coordinator

final class CanvasCoordinator: NSObject, MKMapViewDelegate {

    var parent: MKMapViewRepresentable
    var cameraBound = false
    private weak var mapView: MKMapView?

    func setMapView(_ map: MKMapView) {
        self.mapView = map
    }

    /// P1-008 gesture debounce; continuous region callbacks coalesce.
    private var regionWorkItem: DispatchWorkItem?

    init(parent: MKMapViewRepresentable) {
        self.parent = parent
    }

    // MARK: Syncing overlays/annotations (batched, diffed by id)

    func sync(events: [MapEvent], clusters: [ClusterPoint], heatPoints: [HeatPoint],
              polyline: [Coordinate], destination: Coordinate?, pin: Coordinate?,
              selectedId: UUID?, starredIds: Set<UUID>) {
        guard let map = mapView ?? lastMap else { return }

        // Heat overlay layer (L1): throttled updates per perf budget.
        syncHeat(heatPoints, on: map)

        // Event + cluster annotations (L2/L3).
        var next: [String: MKAnnotation] = [:]
        for e in events {
            next["event-\(e.id.uuidString)"] = EventAnnotation(event: e,
                                                               starred: starredIds.contains(e.id))
        }
        for c in clusters {
            next["cluster-\(c.hashValue)"] = ClusterAnnotation(cluster: c)
        }
        if let pin {
            next["create-pin"] = CreatePinAnnotation(coordinate: pin)
        }

        let current = map.annotations.filter { !($0 is MKUserLocation) }
        var toRemove: [MKAnnotation] = []
        for annotation in current {
            let key = key(for: annotation)
            if let n = next[key], !isDifferent(annotation, n) {
                next.removeValue(forKey: key)
            } else {
                toRemove.append(annotation)
            }
        }
        map.removeAnnotations(toRemove)
        for (_, annotation) in next {
            map.addAnnotation(annotation)
        }

        syncRoute(polyline: polyline, destination: destination, on: map)

        // Selected marker emphasis (P4-009).
        applySelection(selectedId, on: map)
    }

    private var lastMap: MKMapView? { mapView }

    private func key(for annotation: MKAnnotation) -> String {
        switch annotation {
        case let e as EventAnnotation: return "event-\(e.id.uuidString)"
        case let c as ClusterAnnotation: return "cluster-\(c.cluster.hashValue)"
        case _ as CreatePinAnnotation: return "create-pin"
        default: return "other-\(ObjectIdentifier(annotation).hashValue)"
        }
    }

    private func isDifferent(_ old: MKAnnotation, _ new: MKAnnotation) -> Bool {
        switch (old, new) {
        case (let a as EventAnnotation, let b as EventAnnotation):
            return a.event != b.event || a.starred != b.starred
        case (let a as ClusterAnnotation, let b as ClusterAnnotation):
            return a.cluster != b.cluster
        default: return true
        }
    }

    private var heatOverlays: [MKOverlay] = []
    private var lastHeatSync = Date.distantPast
    private var routeOverlays: [MKOverlay] = []

    /// Heat layer refreshes are throttled (perf budget §1.10).
    private func syncHeat(_ points: [HeatPoint], on map: MKMapView) {
        let now = Date()
        guard now.timeIntervalSince(lastHeatSync) > 0.8 else { return }
        lastHeatSync = now
        map.removeOverlays(heatOverlays)
        heatOverlays = points.map { point in
            HeatCircleOverlay(center: CLLocationCoordinate2D(latitude: point.lat, longitude: point.lng),
                              radius: 260 + 340 * point.weight,
                              weight: point.weight)
        }
        map.addOverlays(heatOverlays)
    }

    private func syncRoute(polyline coords: [Coordinate], destination: Coordinate?, on map: MKMapView) {
        map.removeOverlays(routeOverlays)
        routeOverlays.removeAll()
        if coords.count >= 2 {
            let line = MKPolyline(coordinates: coords.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) },
                                  count: coords.count)
            routeOverlays.append(line)
        }
        map.addOverlays(routeOverlays)
        if let d = destination {
            let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: d.lat, longitude: d.lng),
                                            latitudinalMeters: 1200, longitudinalMeters: 1200)
            map.setRegion(region, animated: true)
        }
    }

    private func applySelection(_ selectedId: UUID?, on map: MKMapView) {
        for case let ann as EventAnnotation in map.annotations where ann.view != nil {
            let isSelected = ann.id == selectedId
            ann.view?.isSelectedState = isSelected
        }
    }

    // MARK: Camera intents

    func apply(intent: MapCameraCommand.CameraIntent) {
        guard let map = mapView else { return }
        switch intent {
        case .fly(let coordinate, _):
            let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: coordinate.lat, longitude: coordinate.lng),
                                            latitudinalMeters: 2500, longitudinalMeters: 2500)
            map.setRegion(region, animated: true)
        case .zoomIn(let coordinate):
            var region = map.region
            region.center = CLLocationCoordinate2D(latitude: coordinate.lat, longitude: coordinate.lng)
            region.span.latitudeDelta /= 3
            region.span.longitudeDelta /= 3
            map.setRegion(region, animated: true)
        case .zoomOut:
            var region = map.region
            region.span.latitudeDelta *= 2.5
            region.span.longitudeDelta *= 2.5
            map.setRegion(region, animated: true)
        case .shiftUpForSheet:
            var region = map.region
            region.center.latitude += region.span.latitudeDelta * 0.16
            map.setRegion(region, animated: true)
        }
    }

    // MARK: MKMapViewDelegate

    func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        if let heat = overlay as? HeatCircleOverlay {
            return HeatCircleRenderer(overlay: heat)
        }
        if let line = overlay as? MKPolyline {
            let r = MKPolylineRenderer(polyline: line)
            r.strokeColor = UIColor(Color.heatAccent)
            r.lineWidth = 6
            r.lineCap = .round
            return r
        }
        return MKOverlayRenderer(overlay: overlay)
    }

    func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        if annotation is MKUserLocation { return nil }
        if let eventAnn = annotation as? EventAnnotation {
            let id = "event-marker"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? EventMarkerView)
                ?? EventMarkerView(annotation: eventAnn, reuseIdentifier: id)
            view.configure(event: eventAnn.event, starred: eventAnn.starred)
            view.annotation = eventAnn
            eventAnn.view = view
            view.collisionMode = .circle
            view.canShowCallout = false
            return view
        }
        if let clusterAnn = annotation as? ClusterAnnotation {
            let id = "heat-cluster"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? ClusterMarkerView)
                ?? ClusterMarkerView(annotation: clusterAnn, reuseIdentifier: id)
            view.configure(cluster: clusterAnn.cluster)
            view.annotation = clusterAnn
            view.collisionMode = .circle
            view.canShowCallout = false
            return view
        }
        if annotation is CreatePinAnnotation {
            let id = "create-pin"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? CreatePinView)
                ?? CreatePinView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            return view
        }
        return nil
    }

    func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        mapView.deselectAnnotation(view.annotation, animated: false)
        switch view.annotation {
        case let eventAnn as EventAnnotation:
            onSelectEvent(eventAnn.id)
        case let clusterAnn as ClusterAnnotation:
            onSelectCluster(clusterAnn.cluster)   // clusters zoom, never select (P12)
        default:
            break
        }
    }

    func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
        self.mapView = mapView
        regionWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.emitViewport(mapView)
        }
        regionWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work)
    }

    /// Continuous pan callback used to retain the live map reference.
    func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) {
        self.mapView = mapView
    }

    private func emitViewport(_ map: MKMapView) {
        let region = map.region
        let north = region.center.latitude + region.span.latitudeDelta / 2
        let south = region.center.latitude - region.span.latitudeDelta / 2
        let east = region.center.longitude + region.span.longitudeDelta / 2
        let west = region.center.longitude - region.span.longitudeDelta / 2
        let zoom = log2(360.0 / max(region.span.longitudeDelta, 0.0001))
        parent.onViewportChange(ViewportRegion(north: north, south: south, east: east, west: west,
                                               zoom: zoom,
                                               center: Coordinate(lat: region.center.latitude,
                                                                  lng: region.center.longitude)))
    }
}
