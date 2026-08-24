// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "HeatKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HeatKit", targets: ["HeatKit"]),
        .executable(name: "heatkit-check", targets: ["HeatKitCheck"]),
    ],
    targets: [
        .target(name: "HeatKit"),
        // Verification harness usable without Xcode (Command Line Tools).
        .executableTarget(name: "HeatKitCheck", dependencies: ["HeatKit"]),
        .testTarget(name: "HeatKitTests", dependencies: ["HeatKit"]),
    ]
)
