import AppIntents
import CortexKit
import CortexAI

/// Capture a task from anywhere: Siri, Shortcuts, the Action button, a widget
/// tap or the Lock Screen.
///
/// The parse happens on device before the task is sent, so dictating
/// "remind me to email the reviewers on Friday" produces a structured task with
/// a due date even in Airplane Mode - the request is queued, the understanding
/// already happened.
struct CaptureTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture a task"
    static let description = IntentDescription(
        "Add a task to Cortex in plain language. The wording is understood on your device by Apple Foundation Models.",
        categoryName: "Tasks"
    )
    static let openAppWhenRun = false

    @Parameter(title: "Task", requestValueDialog: "What do you need to do?")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let session = AppSession()
        await session.start()

        guard let intelligence = session.intelligence, let sync = session.sync else {
            throw CaptureError.notSignedIn
        }

        let parsed = await intelligence.parseCapture(text)
        let task = await sync.addTask(
            .init(
                title: parsed.value.title,
                priority: parsed.value.priority,
                dueAt: parsed.value.dueAt,
                dueAllDay: parsed.value.dueAllDay,
                estimateMinutes: parsed.value.estimateMinutes,
                energy: parsed.value.energy,
                recurrenceRule: parsed.value.recurrenceRule,
                origin: parsed.engine == .afm ? .ios : .nlCapture,
                captureText: text
            ),
            parsed: parsed.value,
            engine: parsed.engine,
            rawText: text
        )

        let dialog: IntentDialog = if let due = task.dueAt {
            "Added \"\(task.title)\", due \(due.formatted(date: .abbreviated, time: task.dueAllDay ? .omitted : .shortened))."
        } else {
            "Added \"\(task.title)\"."
        }
        return .result(dialog: dialog)
    }

    enum CaptureError: Error, CustomLocalizedStringResourceConvertible {
        case notSignedIn

        var localizedStringResource: LocalizedStringResource {
            "Open Cortex and sign in first."
        }
    }
}

/// Read out what to do next, ordered on device.
struct PlanMyDayIntent: AppIntent {
    static let title: LocalizedStringResource = "Plan my day"
    static let description = IntentDescription(
        "Order today's work using Apple Foundation Models on your device.",
        categoryName: "Tasks"
    )

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let session = AppSession()
        await session.start()

        guard let intelligence = session.intelligence, let context = session.sync?.context else {
            return .result(dialog: "Cortex has nothing to plan yet.")
        }

        let result = try await intelligence.prioritize(context: context, limit: 3)
        guard let first = result.value.first,
              let task = context.tasks.first(where: { $0.id == first.taskId })
        else {
            return .result(dialog: "Nothing is open - your list is clear.")
        }

        let suffix = result.engine == .afm ? "" : " (ordered by priority and due date - on-device AI was unavailable)"
        return .result(dialog: "Start with \(task.title). \(first.reason)\(suffix)")
    }
}

struct CortexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureTaskIntent(),
            phrases: [
                "Add a task to \(.applicationName)",
                "Capture in \(.applicationName)",
                "Remind me with \(.applicationName)",
            ],
            shortTitle: "Capture",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: PlanMyDayIntent(),
            phrases: ["Plan my day with \(.applicationName)", "What should I do next in \(.applicationName)"],
            shortTitle: "Plan my day",
            systemImageName: "wand.and.stars"
        )
    }
}
