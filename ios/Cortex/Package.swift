// swift-tools-version: 6.0
import PackageDescription

/// Cortex iOS companion.
///
/// The app is split into two libraries plus the app target so that the AI
/// layer can be compiled, tested and reasoned about on its own:
///
/// - `CortexKit` - models, API client, keychain, sync engine, Obsidian vault
///   I/O and the deterministic fallbacks. No Foundation Models dependency, so
///   it builds and runs on any supported device.
/// - `CortexAI`  - every use of Apple Foundation Models, behind protocols that
///   `CortexKit` declares. On a device without on-device inference the app
///   swaps in the fallback implementation and nothing else changes.
let package = Package(
    name: "Cortex",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "CortexKit", targets: ["CortexKit"]),
        .library(name: "CortexAI", targets: ["CortexAI"]),
    ],
    targets: [
        .target(
            name: "CortexKit",
            path: "Sources/CortexKit",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .target(
            name: "CortexAI",
            dependencies: ["CortexKit"],
            path: "Sources/CortexAI",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "CortexKitTests",
            dependencies: ["CortexKit"],
            path: "Tests/CortexKitTests",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "CortexAITests",
            dependencies: ["CortexAI", "CortexKit"],
            path: "Tests/CortexAITests",
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
