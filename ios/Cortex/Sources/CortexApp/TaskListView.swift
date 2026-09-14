import SwiftUI
import CortexKit

struct TaskListView: View {
    @Environment(AppSession.self) private var session
    @State private var showCompleted = false
    @State private var search = ""

    private var tasks: [CortexTask] {
        let all = session.sync?.tasks ?? []
        let filtered = showCompleted ? all : all.filter(\.status.isOpen)
        guard !search.isEmpty else { return filtered }
        return filtered.filter { $0.title.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(tasks) { task in
                    NavigationLink {
                        TaskDetailView(task: task)
                    } label: {
                        TaskRowView(task: task) { done in
                            Task { await session.sync?.setStatus(done ? .done : .todo, for: task.id) }
                        }
                    }
                }
            }
            .navigationTitle("Tasks")
            .searchable(text: $search, prompt: "Search tasks")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Toggle(isOn: $showCompleted) {
                        Label("Show completed", systemImage: showCompleted ? "eye" : "eye.slash")
                    }
                    .toggleStyle(.button)
                }
            }
            .refreshable { await session.sync?.refresh() }
            .overlay {
                if tasks.isEmpty {
                    ContentUnavailableView("No tasks", systemImage: "checklist", description: Text("Capture one from the Today tab."))
                }
            }
        }
    }
}

/// One task, with the on-device breakdown as its main affordance.
struct TaskDetailView: View {
    let task: CortexTask

    @Environment(AppSession.self) private var session
    @State private var subtasks: [SubtaskSuggestion] = []
    @State private var engine: AIEngine = .none
    @State private var isThinking = false
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Text(task.title).font(.headline)
                if let notes = task.notes, !notes.isEmpty { Text(notes).font(.callout) }

                LabeledContent("Priority", value: task.priority.label)
                if let due = task.dueAt {
                    LabeledContent("Due", value: due.formatted(date: .abbreviated, time: task.dueAllDay ? .omitted : .shortened))
                }
                if let estimate = task.estimateMinutes {
                    LabeledContent("Estimate", value: "\(estimate) min")
                }
                if let rule = task.recurrenceRule {
                    LabeledContent("Repeats", value: Recurrence.describe(rule))
                }
                if let captured = task.captureText {
                    LabeledContent("Captured as", value: captured).font(.caption)
                }
            }

            Section {
                if subtasks.isEmpty {
                    Button {
                        Task { await breakDown() }
                    } label: {
                        Label(isThinking ? "Thinking..." : "Break this down", systemImage: "list.bullet.indent")
                    }
                    .disabled(isThinking)
                } else {
                    ForEach(subtasks) { suggestion in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(suggestion.title)
                                Spacer()
                                Text("\(suggestion.estimateMinutes)m").font(.caption).foregroundStyle(.secondary)
                            }
                            if let rationale = suggestion.rationale, !rationale.isEmpty {
                                Text(rationale).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }

                    Button {
                        Task { await acceptSubtasks() }
                    } label: {
                        Label("Add these as subtasks", systemImage: "plus.circle")
                    }
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.secondary)
                }
            } header: {
                Text("Steps")
            } footer: {
                if !subtasks.isEmpty {
                    Text(engine == .afm
                         ? "Broken down on this device by Apple Foundation Models, using your other open work for context."
                         : "A generic structure - no on-device model was available to break this down properly.")
                }
            }

            Section {
                Button(task.status == .done ? "Reopen" : "Mark done") {
                    Task { await session.sync?.setStatus(task.status == .done ? .todo : .done, for: task.id) }
                }
                Button("Write to Obsidian") {
                    Task {
                        let vault = ObsidianVault()
                        try? await vault.write(MarkdownNote.taskNote(task), to: await vault.path(forTask: task))
                    }
                }
            }
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func breakDown() async {
        guard let intelligence = session.intelligence, let context = session.sync?.context else { return }
        isThinking = true
        errorMessage = nil
        defer { isThinking = false }

        do {
            let result = try await intelligence.breakDown(task: task, context: context)
            subtasks = result.value
            engine = result.engine
        } catch let error as IntelligenceError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func acceptSubtasks() async {
        guard let sync = session.sync else { return }
        for suggestion in subtasks {
            await sync.addTask(
                .init(
                    title: suggestion.title,
                    estimateMinutes: suggestion.estimateMinutes,
                    parentTaskId: task.id,
                    origin: engine == .afm ? .ios : .manual
                )
            )
        }
        subtasks = []
    }
}
