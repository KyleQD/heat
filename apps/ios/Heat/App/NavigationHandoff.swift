import Foundation
import HeatKit

/// P6-009/P6-010 — external navigation handoff honoring the selected mode.
enum NavigationHandoff {

    static func open(_ provider: NavigationProvider,
                     destination: Coordinate,
                     mode: TravelMode,
                     label: String?) {
        guard NavigationHandoffURLs.supports(provider, mode: mode) else { return }
        switch provider {
        case .appleMaps:
            if let url = NavigationHandoffURLs.appleMaps(destination: destination,
                                                         mode: mode, label: label) {
                UIApplicationOpen(url)
            }
        case .googleMaps:
            if let appURL = NavigationHandoffURLs.googleMapsApp(destination: destination, mode: mode),
               canOpen(appURL) {
                UIApplicationOpen(appURL)
            } else if let webURL = NavigationHandoffURLs.googleMapsWeb(destination: destination, mode: mode) {
                UIApplicationOpen(webURL)   // P6-013 fallback
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
