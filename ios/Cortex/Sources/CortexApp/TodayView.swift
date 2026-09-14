import SwiftUI
import CortexKit

/// "Plan my day", with the ordering the on-device model produced.
struct TodayView: View {
    @Environment(AppSession.self) private var session
    @State private var prioritized: [PrioritizedTask] = []
    @State private var engine: AIEngine = .none
    @State private var isThinking = false
    @State private var captureText = ""
    @State private var capturePreview: ParsedCapture?
    @State private var captureEngine: AIEngine = .heuristic

    private var tasks: [CortexTask] { session.sync?.tasks ?? [] }

    var body: some View {
        NavigationStack {
            List {
                captureSection
                if !prioritized.isEmpty { planSection } else { fallbackSection }
                blocksSection
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await plan() }
                    } label: {
                        Label("Plan my day", systemImage: "wand.and.stars")
                    }
                    .disabled(isThinking)
                }
            }
            .refreshable { await session.sync?.refresh() }
            .task { await plan() }
        }
    }

    // MARK: Capture

    private var captureSection: some View {
        Section {
            TextField("Draft grant section tomorrow at 9am #Grant !1", text: $captureText, axis: .vertical)
                .textInputAutocapitalization(.sentences)
                .onChange(of: captureText) { _, newValue in
                    Task { await updatePreview(for: newValue) }
                }
                .onSubmit { Task { await submitCapture() } }

            if let preview = capturePreview, !captureText.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(preview.title).font(.subheadline.weight(.medium))
                    HStack(spacing: 8) {
                        if let due = preview.dueAt {
                            Label(due.formatted(date: .abbreviated, time: preview.dueAllDay ? .omitted : .shortened), systemImage: "calendar")
                        }
                        if preview.priority != .p3 { Label(preview.priority.label, systemImage: "flag") }
                        if let minutes = preview.estimateMinutes { Label("\(minutes)m", systemImage: "clock") }
                        if let project = preview.projectName { Label(project, systemImage: "folder") }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    Text(captureEngine == .afm
                         ? "Understood on device by Apple Foundation Models."
                         : "Understood by the built-in grammar.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Button("Add task") { Task { await submitCapture() } }
                    .disabled(captureText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        } header: {
            Text("Capture")
        }
    }

    // MARK: Plan

    private var planSection: some View {
        Section {
            ForEach(prioritized) { ranked in
                if let task = tasks.first(where: { $0.id == ranked.taskId }) {
                    TaskRowView(task: task, reason: ranked.reason, nextAction: ranked.suggestedNextAction) {
                        Task { await session.sync?.setStatus($0 ? .done : .todo, for: task.id) }
                    }
                }
            }
        } header: {
            HStack {
                Text("In order")
                Spacer()
                if let availability = session.intelligence?.availability {
                    IntelligenceBadge(availability: availability, compact: true)
                }
            }
        } footer: {
            Text(engine == .afm
                 ? "Ordered on this device by Apple Foundation Models, using your open work and the next week of your calendar. Nothing was sent anywhere."
                 : "Ordered by priority and due date. Pair a device with Apple Intelligence for reasoning about what the work actually is.")
        }
    }

    private var fallbackSection: some View {
        Section("Open") {
            if tasks.isEmpty {
                ContentUnavailableView("Nothing open", systemImage: "checkmark.circle", description: Text("Capture something above."))
            } else {
                ForEach(tasks.filter(\.status.isOpen).prefix(10)) { task in
                    TaskRowView(task: task) {
                        Task { await session.sync?.setStatus($0 ? .done : .todo, for: task.id) }
                    }
                }
            }
        }
    }

    private var blocksSection: some View {
        Section("Schedule") {
            NavigationLink {
                ScheduleProposalView()
            } label: {
                Label("Propose time blocks", systemImage: "calendar.badge.clock")
            }
        }
    }

    // MARK: Actions

    private func updatePreview(for text: String) async {
        guard text.count > 2, let intelligence = session.intelligence else {
            capturePreview = nil
            return
        }
        // The live preview always uses the grammar: it has to keep up with
        // typing, and the model runs once on submit.
        capturePreview = CaptureGrammar.parse(text)
        captureEngine = intelligence.isOnDevice ? .afm : .heuristic
    }

    private func submitCapture() async {
        let text = captureText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let intelligence = session.intelligence, let sync = session.sync else { return }

        let result = await intelligence.parseCapture(text)
        let parsed = result.value

        await sync.addTask(
            .init(
                title: parsed.title,
                priority: parsed.priority,
                dueAt: parsed.dueAt,
                dueAllDay: parsed.dueAllDay,
                estimateMinutes: parsed.estimateMinutes,
                energy: parsed.energy,
                recurrenceRule: parsed.recurrenceRule,
                origin: result.engine == .afm ? .ios : .nlCapture,
                captureText: text
            ),
            parsed: parsed,
            engine: result.engine,
            rawText: text
        )

        captureText = ""
        capturePreview = nil
        await plan()
    }

    private func plan() async {
        guard let intelligence = session.intelligence, let context = session.sync?.context else { return }
        isThinking = true
        defer { isThinking = false }

        do {
            let result = try await intelligence.prioritize(context: context)
            prioritized = result.value
            engine = result.engine
        } catch {
            prioritized = []
            engine = .none
        }
    }
}

struct TaskRowView: View {
    let task: CortexTask
    var reason: String?
    var nextAction: String?
    var onToggle: (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                onToggle(task.status != .done)
            } label: {
                Image(systemName: task.status == .done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.status == .done ? .green : .secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.status == .done ? "Reopen \(task.title)" : "Complete \(task.title)")

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .strikethrough(task.status == .done)
                    .foregroundStyle(task.status == .done ? .secondary : .primary)

                HStack(spacing: 8) {
                    if task.priority != .p3 {
                        Text(task.priority.label)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(task.priority == .p1 ? Color.red.opacity(0.15) : Color.orange.opacity(0.15), in: .rect(cornerRadius: 4))
                    }
                    if let due = task.dueAt {
                        Label(due.formatted(date: .abbreviated, time: task.dueAllDay ? .omitted : .shortened), systemImage: task.isOverdue ? "exclamationmark.triangle" : "calendar")
                            .foregroundStyle(task.isOverdue ? .red : .secondary)
                    }
                    if let minutes = task.estimateMinutes {
                        Text("\(minutes)m")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if let reason {
                    Text(reason).font(.caption).italic().foregroundStyle(.secondary)
                }
                if let nextAction, !nextAction.isEmpty {
                    Label(nextAction, systemImage: "arrow.turn.down.right").font(.caption).foregroundStyle(.blue)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
