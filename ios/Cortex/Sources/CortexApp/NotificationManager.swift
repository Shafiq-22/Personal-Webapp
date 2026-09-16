import CoreLocation
import Foundation
import UserNotifications
import CortexKit

/// Local and remote notifications.
///
/// Time and escalating reminders are scheduled as *local* notifications so they
/// fire with no network and no server round trip. Location reminders use a
/// region trigger, and dependency reminders are raised by the app when the
/// blocking task completes. Push is used only for realtime research alerts,
/// which by definition come from the server.
final class NotificationManager: NSObject, @unchecked Sendable {
    static let shared = NotificationManager()

    private(set) var currentToken: String?
    private let center = UNUserNotificationCenter.current()

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge, .timeSensitive])) ?? false
    }

    func registerToken(_ deviceToken: Data) {
        currentToken = deviceToken.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Scheduling

    /// Schedule the reminders for one task, replacing any it already had.
    func schedule(for task: CortexTask, reminders: [ReminderPlan]) async {
        await cancel(for: task.id)

        for reminder in reminders {
            let content = UNMutableNotificationContent()
            content.title = task.title
            content.body = reminder.body
            content.sound = reminder.isCritical ? .defaultCritical : .default
            content.interruptionLevel = reminder.isCritical ? .critical : .timeSensitive
            content.userInfo = ["taskId": task.id]
            content.categoryIdentifier = "TASK_REMINDER"

            guard let trigger = reminder.trigger else { continue }
            let request = UNNotificationRequest(identifier: "\(task.id)-\(reminder.id)", content: content, trigger: trigger)
            try? await center.add(request)
        }
    }

    func cancel(for taskId: String) async {
        let pending = await center.pendingNotificationRequests()
        let ids = pending.map(\.identifier).filter { $0.hasPrefix(taskId) }
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    /// Notify that a dependency cleared. Raised locally when the blocking task
    /// is completed, so it works offline.
    func dependencyUnblocked(task: CortexTask, blockedBy title: String) async {
        let content = UNMutableNotificationContent()
        content.title = "Ready to start"
        content.body = "\"\(title)\" is done, so \"\(task.title)\" is unblocked."
        content.sound = .default
        content.userInfo = ["taskId": task.id]

        let request = UNNotificationRequest(identifier: "\(task.id)-dependency", content: content, trigger: nil)
        try? await center.add(request)
    }

    func registerCategories() {
        let complete = UNNotificationAction(identifier: "COMPLETE", title: "Mark done", options: [.authenticationRequired])
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "Snooze an hour", options: [])
        let category = UNNotificationCategory(identifier: "TASK_REMINDER", actions: [complete, snooze], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
    }
}

/// One scheduled reminder, resolved to something UserNotifications understands.
struct ReminderPlan: Sendable {
    enum Kind: Sendable {
        case time(Date)
        case location(latitude: Double, longitude: Double, radius: Double, onEntry: Bool)
        /// A step of an escalating reminder, at an absolute instant.
        case escalation(Date, step: Int)
    }

    let id: String
    let kind: Kind
    let body: String
    let isCritical: Bool

    var trigger: UNNotificationTrigger? {
        switch kind {
        case .time(let date), .escalation(let date, _):
            guard date > .now else { return nil }
            let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            return UNCalendarNotificationTrigger(dateMatching: components, repeats: false)

        case let .location(latitude, longitude, radius, onEntry):
            let region = CLCircularRegion(
                center: .init(latitude: latitude, longitude: longitude),
                radius: radius,
                identifier: id
            )
            region.notifyOnEntry = onEntry
            region.notifyOnExit = !onEntry
            return UNLocationNotificationTrigger(region: region, repeats: false)
        }
    }
}
