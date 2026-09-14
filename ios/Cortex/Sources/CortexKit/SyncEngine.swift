import Foundation
import Observation

/// Keeps the device's copy of the data in step with the account.
///
/// Two properties matter more than speed here:
///
/// - **Offline is the normal case, not an error.** Every mutation is written to
///   the local store first and queued; the queue drains when the network comes
///   back. Nothing the user does is lost because they were on the Tube.
/// - **On-device inference never blocks sync.** Ranking and summarising are
///   separate passes that read the synced data and write their results back;
///   if the model is unavailable, sync is unaffected.
@Observable
@MainActor
public final class SyncEngine {
    public enum Status: Equatable, Sendable {
        case idle
        case syncing
        case offline(queued: Int)
        case failed(String)
    }

    public private(set) var status: Status = .idle
    public private(set) var tasks: [CortexTask] = []
    public private(set) var feed: [InfoItem] = []
    public private(set) var context: WorkContext?
    public private(set) var lastSyncedAt: Date?

    private let api: APIClient
    private let store: LocalStore
    private var pendingMutations: [PendingMutation] = []

    public init(api: APIClient, store: LocalStore = LocalStore()) {
        self.api = api
        self.store = store
        self.tasks = store.loadTasks()
        self.feed = store.loadFeed()
        self.pendingMutations = store.loadQueue()
        self.lastSyncedAt = store.lastSyncedAt
    }

    // MARK: Reading

    public func refresh() async {
        status = .syncing
        do {
            async let remoteTasks = api.tasks()
            async let remoteFeed = api.feed(limit: 60)
            async let remoteContext = api.workContext()

            let (loadedTasks, loadedFeed, loadedContext) = try await (remoteTasks, remoteFeed, remoteContext)

            tasks = loadedTasks
            feed = loadedFeed.map(\.item)
            context = loadedContext
            lastSyncedAt = .now

            store.saveTasks(tasks)
            store.saveFeed(feed)
            store.lastSyncedAt = lastSyncedAt

            await drainQueue()
            status = pendingMutations.isEmpty ? .idle : .offline(queued: pendingMutations.count)
        } catch let error as APIClient.APIError where error.isRetryable {
            // Keep showing the cached data; this is not a failure the user needs
            // to act on.
            status = .offline(queued: pendingMutations.count)
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    // MARK: Writing

    /// Add a task. Applied locally at once, sent when possible.
    @discardableResult
    public func addTask(_ draft: APIClient.TaskDraft, parsed: ParsedCapture? = nil, engine: AIEngine = .heuristic, rawText: String? = nil) async -> CortexTask {
        let optimistic = CortexTask(
            title: draft.title,
            notes: draft.notes,
            priority: draft.priority ?? .p3,
            energy: draft.energy,
            dueAt: draft.dueAt,
            dueAllDay: draft.dueAllDay ?? false,
            estimateMinutes: draft.estimateMinutes,
            recurrenceRule: draft.recurrenceRule,
            origin: engine == .afm ? .ios : .nlCapture,
            captureText: rawText
        )
        tasks.insert(optimistic, at: 0)
        store.saveTasks(tasks)

        do {
            let created: CortexTask
            if let rawText {
                created = try await api.capture(text: rawText, parsed: parsed, engine: engine).task
            } else {
                created = try await api.createTask(draft)
            }
            // Swap the placeholder for the row the server actually stored.
            if let index = tasks.firstIndex(where: { $0.id == optimistic.id }) { tasks[index] = created }
            store.saveTasks(tasks)
            return created
        } catch {
            enqueue(.createTask(draft: draft, rawText: rawText, parsed: parsed, engine: engine, placeholderId: optimistic.id))
            return optimistic
        }
    }

    public func setStatus(_ status: TaskStatus, for taskId: String) async {
        guard let index = tasks.firstIndex(where: { $0.id == taskId }) else { return }
        let previous = tasks[index]
        tasks[index].status = status
        tasks[index].completedAt = status == .done ? .now : nil
        store.saveTasks(tasks)

        do {
            let result = try await api.updateTask(id: taskId, patch: .init(status: status))
            if let refreshed = tasks.firstIndex(where: { $0.id == taskId }) { tasks[refreshed] = result.task }
            store.saveTasks(tasks)
        } catch let error as APIClient.APIError where error.isRetryable {
            enqueue(.updateStatus(taskId: taskId, status: status))
        } catch {
            // A rejection is not a connectivity problem, so the optimistic edit
            // is rolled back rather than queued.
            tasks[index] = previous
            store.saveTasks(tasks)
            self.status = .failed(error.localizedDescription)
        }
    }

    public func setItemState(_ state: String, for itemId: String, notes: String? = nil, tags: [String]? = nil) async {
        do {
            try await api.setItemState(itemId: itemId, state: state, notes: notes, tags: tags)
        } catch {
            enqueue(.itemState(itemId: itemId, state: state, notes: notes, tags: tags))
        }
    }

    /// Upload what the on-device model produced, honouring the user's choice
    /// about whether summaries may leave the device at all.
    public func uploadInference(scores: [RankedItem], summaries: [ItemSummary], syncSummaries: Bool) async {
        if !scores.isEmpty {
            do { _ = try await api.uploadScores(scores) } catch { enqueue(.scores(scores)) }
        }
        guard syncSummaries, !summaries.isEmpty else { return }
        do { try await api.uploadSummaries(summaries) } catch { enqueue(.summaries(summaries)) }
    }

    // MARK: Queue

    private func enqueue(_ mutation: PendingMutation) {
        pendingMutations.append(mutation)
        store.saveQueue(pendingMutations)
        status = .offline(queued: pendingMutations.count)
    }

    public func drainQueue() async {
        guard !pendingMutations.isEmpty else { return }
        var remaining: [PendingMutation] = []

        for mutation in pendingMutations {
            do {
                switch mutation {
                case let .createTask(draft, rawText, parsed, engine, placeholderId):
                    let created: CortexTask = if let rawText {
                        try await api.capture(text: rawText, parsed: parsed, engine: engine).task
                    } else {
                        try await api.createTask(draft)
                    }
                    if let index = tasks.firstIndex(where: { $0.id == placeholderId }) { tasks[index] = created }
                case let .updateStatus(taskId, status):
                    _ = try await api.updateTask(id: taskId, patch: .init(status: status))
                case let .itemState(itemId, state, notes, tags):
                    try await api.setItemState(itemId: itemId, state: state, notes: notes, tags: tags)
                case let .scores(scores):
                    _ = try await api.uploadScores(scores)
                case let .summaries(summaries):
                    try await api.uploadSummaries(summaries)
                }
            } catch let error as APIClient.APIError where error.isRetryable {
                remaining.append(mutation)
            } catch {
                // A permanent rejection (validation, 403 on summary sync) must
                // not wedge the queue forever.
                continue
            }
        }

        pendingMutations = remaining
        store.saveQueue(remaining)
        store.saveTasks(tasks)
        status = remaining.isEmpty ? .idle : .offline(queued: remaining.count)
    }

    public var queuedCount: Int { pendingMutations.count }
}

/// A mutation made while offline.
public enum PendingMutation: Codable, Sendable {
    case createTask(draft: APIClient.TaskDraft, rawText: String?, parsed: ParsedCapture?, engine: AIEngine, placeholderId: String)
    case updateStatus(taskId: String, status: TaskStatus)
    case itemState(itemId: String, state: String, notes: String?, tags: [String]?)
    case scores([RankedItem])
    case summaries([ItemSummary])
}

extension APIClient.TaskDraft: Decodable {}

/// On-disk cache. Plain JSON in Application Support: everything here is already
/// on the user's device, and encrypting it would only add a key to lose.
/// Content that must not sit in a backup goes in the Keychain instead.
public final class LocalStore: @unchecked Sendable {
    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let defaults = UserDefaults.standard

    public init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!.appending(path: "Cortex")
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        self.directory = base
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    public var lastSyncedAt: Date? {
        get { defaults.object(forKey: "cortex.lastSyncedAt") as? Date }
        set { defaults.set(newValue, forKey: "cortex.lastSyncedAt") }
    }

    private func url(_ name: String) -> URL { directory.appending(path: "\(name).json") }

    private func load<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? decoder.decode(T.self, from: data)
    }

    private func save<T: Encodable>(_ value: T, as name: String) {
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: url(name), options: .atomic)
    }

    public func loadTasks() -> [CortexTask] { load("tasks", as: [CortexTask].self) ?? [] }
    public func saveTasks(_ tasks: [CortexTask]) { save(tasks, as: "tasks") }

    public func loadFeed() -> [InfoItem] { load("feed", as: [InfoItem].self) ?? [] }
    public func saveFeed(_ items: [InfoItem]) { save(items, as: "feed") }

    public func loadQueue() -> [PendingMutation] { load("queue", as: [PendingMutation].self) ?? [] }
    public func saveQueue(_ queue: [PendingMutation]) { save(queue, as: "queue") }

    public func loadSummaries() -> [ItemSummary] { load("summaries", as: [ItemSummary].self) ?? [] }
    public func saveSummaries(_ summaries: [ItemSummary]) { save(summaries, as: "summaries") }
}
