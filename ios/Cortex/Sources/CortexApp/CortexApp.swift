import SwiftUI
import CortexKit
import CortexAI

/// The companion app.
///
/// Its job is the part the web app cannot do: run Apple Foundation Models on
/// device, reach the Obsidian vault in iCloud Drive, deliver notifications,
/// and keep working with no connection at all.
@main
struct CortexApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .task { await session.start() }
        }
    }
}

/// Everything the views share: the API client, the sync engine, and the
/// intelligence coordinator that decides whether the model or the fallback
/// answers.
@Observable
@MainActor
final class AppSession {
    private(set) var sync: SyncEngine?
    private(set) var intelligence: IntelligenceCoordinator?
    private(set) var auth = AuthStore()
    var settings = AppSettings()

    var isReady: Bool { sync != nil }

    func start() async {
        let api = APIClient(
            configuration: .init(baseURL: settings.baseURL),
            tokenProvider: { [auth] in await auth.accessToken() }
        )

        let coordinator = IntelligenceCoordinator(primary: FoundationModelsIntelligence())
        await coordinator.refreshAvailability()

        let engine = SyncEngine(api: api)
        sync = engine
        intelligence = coordinator

        // Tell the account what this device can do, so the web app can explain
        // precisely which AI features are available and why.
        try? await api.registerDevice(
            name: await UIDevice.current.name,
            pushToken: NotificationManager.shared.currentToken,
            availability: coordinator.availability,
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        )

        await engine.refresh()
    }
}

/// Where the app points and what the user allowed.
@Observable
final class AppSettings {
    var baseURL: URL {
        get {
            URL(string: UserDefaults.standard.string(forKey: "cortex.baseURL") ?? "https://cortex.local") ?? URL(string: "https://cortex.local")!
        }
        set { UserDefaults.standard.set(newValue.absoluteString, forKey: "cortex.baseURL") }
    }

    /// Off by default: what the on-device model writes stays on the device
    /// unless the user says otherwise.
    var syncSummaries: Bool {
        get { UserDefaults.standard.bool(forKey: "cortex.syncSummaries") }
        set { UserDefaults.standard.set(newValue, forKey: "cortex.syncSummaries") }
    }

    var allowVaultScan: Bool {
        get { UserDefaults.standard.bool(forKey: "cortex.allowVaultScan") }
        set { UserDefaults.standard.set(newValue, forKey: "cortex.allowVaultScan") }
    }
}
