import SwiftUI
import CortexKit

struct RootView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        TabView {
            Tab("Today", systemImage: "sun.max") { TodayView() }
            Tab("Tasks", systemImage: "checklist") { TaskListView() }
            Tab("Feed", systemImage: "tray.full") { FeedView() }
            Tab("Settings", systemImage: "gear") { SettingsView() }
        }
        .overlay(alignment: .top) { SyncBanner() }
    }
}

/// One line at the top when something is not normal: offline with queued work,
/// or a sync error. Silent when everything is fine.
struct SyncBanner: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        Group {
            switch session.sync?.status {
            case .offline(let queued)? where queued > 0:
                banner("Offline - \(queued) change\(queued == 1 ? "" : "s") will sync when you reconnect", systemImage: "wifi.slash", tint: .orange)
            case .failed(let message)?:
                banner(message, systemImage: "exclamationmark.triangle", tint: .red)
            default:
                EmptyView()
            }
        }
        .animation(.default, value: session.sync?.status)
    }

    private func banner(_ text: String, systemImage: String, tint: Color) -> some View {
        Label(text, systemImage: systemImage)
            .font(.footnote)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(tint.opacity(0.15), in: .capsule)
            .foregroundStyle(tint)
            .padding(.top, 4)
    }
}

/// Explains, in one line, whether on-device AI is working - and if not, why.
///
/// This view exists because silently degrading is the thing the product must
/// not do: a user who sees a worse summary deserves to know a model did not
/// write it.
struct IntelligenceBadge: View {
    let availability: IntelligenceAvailability
    var compact = false

    var body: some View {
        Label {
            Text(compact ? shortLabel : availability.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: availability.isAvailable ? "cpu" : "cpu.fill")
                .foregroundStyle(availability.isAvailable ? .green : .secondary)
        }
        .accessibilityLabel(availability.explanation)
    }

    private var shortLabel: String {
        availability.isAvailable ? "On device" : "Fallback"
    }
}

#Preview {
    RootView().environment(AppSession())
}
