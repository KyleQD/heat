import Foundation
import HeatKit

/// P6-009/P6-010 — external navigation handoff. HEAT never does turn-by-turn;
/// we deep-link out and record the handoff.
enum NavigationHandoff {

    static func open(_ provider: NavigationProvider,
                     destination: Coordinate,
                     label: String?) {
        switch provider {
        case .appleMaps:
            var comps = URLComponents(string: "https://maps.apple.com/")!
            comps.queryItems = [
                URLQueryItem(name: "daddr", value: "\(destination.lat),\(destination.lng)"),
                URLQueryItem(name: "dirflg", value: "d"),
                URLQueryItem(name: "q", value: label ?? "Destination"),
            ]
            if let url = comps.url { UIApplicationOpen(url) }
        case .googleMaps:
            var comps = URLComponents(string: "comgooglemaps://")!
            comps.queryItems = [
                URLQueryItem(name: "daddr", value: "\(destination.lat),\(destination.lng)"),
                URLQueryItem(name: "directionsmode", value: "driving"),
            ]
            if let url = comps.url, canOpen(url) {
                UIApplicationOpen(url)
            } else {
                // Fallback to web when app not installed (P6-013).
                var web = URLComponents(string: "https://www.google.com/maps/dir/?api=1")!
                web.queryItems = [
                    URLQueryItem(name: "destination", value: "\(destination.lat),\(destination.lng)"),
                ]
                if let url = web.url { UIApplicationOpen(url) }
            }
        }
    }

    private static func canOpen(_ url: URL) -> Bool {
        UIApplicationCanOpen(url)
    }
}

#if canImport(UIKit)
import UIKit
private func UIApplicationOpen(_ url: URL) { UIApplication.shared.open(url) }
private func UIApplicationCanOpen(_ url: URL) -> Bool { UIApplication.shared.canOpenURL(url) }
#else
private func UIApplicationOpen(_ url: URL) {}
private func UIApplicationCanOpen(_ url: URL) -> Bool { false }
#endif
