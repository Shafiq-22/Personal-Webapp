import WidgetKit
import SwiftUI
import AppIntents
import CortexKit

/// Home Screen and Lock Screen widgets.
///
/// The timeline is built from the cached local store rather than the network,
/// so a widget refresh never waits on a request and shows the same data the app
/// last synced. The AI ordering that produced it happened in the app, on device.
struct CortexEntry: TimelineEntry {
    let date: Date
    let tasks: [CortexTask]
    let topReason: String?
    let onDeviceAI: Bool
}

struct TodayProvider: TimelineProvider {
    private let store = LocalStore()

    func placeholder(in context: Context) -> CortexEntry {
        CortexEntry(
            date: .now,
            tasks: [CortexTask(title: "Draft the methods section", priority: .p1, dueAt: .now.addingTimeInterval(3600))],
            topReason: "Due today and already in progress",
            onDeviceAI: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (CortexEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CortexEntry>) -> Void) {
        // Refresh on the hour: task data changes rarely enough that anything
        // more frequent just spends the widget's budget.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now.addingTimeInterval(3600)
        completion(Timeline(entries: [entry()], policy: .after(next)))
    }

    private func entry() -> CortexEntry {
        let open = store.loadTasks()
            .filter(\.status.isOpen)
            .sorted { lhs, rhs in
                switch (lhs.dueAt, rhs.dueAt) {
                case let (l?, r?): return l < r
                case (nil, _?): return false
                case (_?, nil): return true
                default: return lhs.priority < rhs.priority
                }
            }
        return CortexEntry(date: .now, tasks: Array(open.prefix(4)), topReason: nil, onDeviceAI: true)
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CortexEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(entry.tasks.first?.title ?? "Nothing due")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(entry.tasks.count)").font(.title2.bold())
                    Text("open").font(.caption2)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.tasks.first?.title ?? "Nothing due").font(.headline).lineLimit(2)
                if let due = entry.tasks.first?.dueAt {
                    Text(due, style: .relative).font(.caption)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Today").font(.headline)
                    Spacer()
                    Button(intent: CaptureTaskIntent()) {
                        Image(systemName: "plus.circle.fill")
                    }
                    .buttonStyle(.plain)
                }

                if entry.tasks.isEmpty {
                    Text("Nothing open. Enjoy it.").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(entry.tasks.prefix(family == .systemSmall ? 2 : 4)) { task in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "circle")
                                .font(.caption2)
                                .foregroundStyle(task.priority == .p1 ? .red : .secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(task.title).font(.caption).lineLimit(1)
                                if let due = task.dueAt {
                                    Text(due, style: .relative)
                                        .font(.caption2)
                                        .foregroundStyle(task.isOverdue ? .red : .secondary)
                                }
                            }
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CortexToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("What is open, ordered the way Cortex planned your day.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

/// A Lock Screen button that opens capture directly - the fastest path from
/// "I must not forget this" to a structured task.
struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CortexCapture", provider: TodayProvider()) { _ in
            VStack(spacing: 2) {
                Image(systemName: "plus.circle.fill").font(.title2)
                Text("Capture").font(.caption2)
            }
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(URL(string: "cortex://capture"))
        }
        .configurationDisplayName("Quick capture")
        .description("Open Cortex ready to capture.")
        .supportedFamilies([.accessoryCircular, .systemSmall])
    }
}

@main
struct CortexWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        CaptureWidget()
    }
}
