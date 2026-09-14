import Foundation

// MARK: - Core domain
//
// These mirror `packages/core/src/domain` field for field, because the same
// JSON crosses the wire in both directions. The API speaks camelCase, so no key
// conversion strategy is needed anywhere.

public enum TaskStatus: String, Codable, Sendable, CaseIterable {
    case todo
    case inProgress = "in_progress"
    case done
    case cancelled

    public var isOpen: Bool { self == .todo || self == .inProgress }
}

public enum Priority: String, Codable, Sendable, CaseIterable, Comparable {
    case p1, p2, p3, p4

    /// p1 is the most urgent, so it sorts first.
    public static func < (lhs: Priority, rhs: Priority) -> Bool { lhs.rank < rhs.rank }

    var rank: Int {
        switch self {
        case .p1: 0
        case .p2: 1
        case .p3: 2
        case .p4: 3
        }
    }

    public var weight: Double {
        switch self {
        case .p1: 1.0
        case .p2: 0.75
        case .p3: 0.5
        case .p4: 0.25
        }
    }

    public var label: String { rawValue.uppercased() }
}

public enum EnergyLevel: String, Codable, Sendable, CaseIterable {
    case low, medium, high
}

public enum RecordOrigin: String, Codable, Sendable {
    case manual
    case nlCapture = "nl_capture"
    case calendar, obsidian, feed, clipper, ios, system
}

/// Which engine produced an AI artefact. `afm` means Apple Foundation Models
/// ran on this device; `heuristic` means the deterministic fallback did.
/// There is no third possibility - Cortex never calls a cloud model.
public enum AIEngine: String, Codable, Sendable {
    case afm, heuristic, none
}

public struct CortexTask: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var userId: String
    public var projectId: String?
    public var parentTaskId: String?
    public var title: String
    public var notes: String?
    public var status: TaskStatus
    public var priority: Priority
    public var energy: EnergyLevel?
    public var dueAt: Date?
    public var dueAllDay: Bool
    public var startAt: Date?
    public var estimateMinutes: Int?
    public var recurrenceRule: String?
    public var recurrenceAnchor: Date?
    public var completedAt: Date?
    public var sortOrder: Int
    public var origin: RecordOrigin
    public var captureText: String?
    public var sourceItemId: String?
    public var tagIds: [String]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: String = UUID().uuidString,
        userId: String = "",
        projectId: String? = nil,
        parentTaskId: String? = nil,
        title: String,
        notes: String? = nil,
        status: TaskStatus = .todo,
        priority: Priority = .p3,
        energy: EnergyLevel? = nil,
        dueAt: Date? = nil,
        dueAllDay: Bool = false,
        startAt: Date? = nil,
        estimateMinutes: Int? = nil,
        recurrenceRule: String? = nil,
        recurrenceAnchor: Date? = nil,
        completedAt: Date? = nil,
        sortOrder: Int = 0,
        origin: RecordOrigin = .manual,
        captureText: String? = nil,
        sourceItemId: String? = nil,
        tagIds: [String] = [],
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.userId = userId
        self.projectId = projectId
        self.parentTaskId = parentTaskId
        self.title = title
        self.notes = notes
        self.status = status
        self.priority = priority
        self.energy = energy
        self.dueAt = dueAt
        self.dueAllDay = dueAllDay
        self.startAt = startAt
        self.estimateMinutes = estimateMinutes
        self.recurrenceRule = recurrenceRule
        self.recurrenceAnchor = recurrenceAnchor
        self.completedAt = completedAt
        self.sortOrder = sortOrder
        self.origin = origin
        self.captureText = captureText
        self.sourceItemId = sourceItemId
        self.tagIds = tagIds
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isOverdue: Bool {
        guard status.isOpen, let dueAt else { return false }
        return dueAt < .now
    }
}

public struct Project: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var userId: String
    public var parentId: String?
    public var name: String
    public var color: String?
    public var archived: Bool

    public init(id: String, userId: String = "", parentId: String? = nil, name: String, color: String? = nil, archived: Bool = false) {
        self.id = id
        self.userId = userId
        self.parentId = parentId
        self.name = name
        self.color = color
        self.archived = archived
    }
}

public struct CalendarEvent: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var title: String
    public var startAt: Date
    public var endAt: Date
    public var allDay: Bool
    public var location: String?
    public var attendeeCount: Int
    public var transparency: String

    public init(id: String, title: String, startAt: Date, endAt: Date, allDay: Bool = false, location: String? = nil, attendeeCount: Int = 0, transparency: String = "opaque") {
        self.id = id
        self.title = title
        self.startAt = startAt
        self.endAt = endAt
        self.allDay = allDay
        self.location = location
        self.attendeeCount = attendeeCount
        self.transparency = transparency
    }

    /// Transparent events do not block free-slot detection.
    public var blocksTime: Bool { transparency != "transparent" }
}

public struct Topic: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var label: String
    public var keywords: [String]
    public var weight: Double

    public init(id: String, label: String, keywords: [String] = [], weight: Double = 1) {
        self.id = id
        self.label = label
        self.keywords = keywords
        self.weight = weight
    }
}

public struct InfoItem: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var kind: String
    public var url: String
    public var canonicalUrl: String?
    public var title: String
    public var authors: [String]
    public var summaryRaw: String?
    public var contentText: String?
    public var publishedAt: Date?
    public var fetchedAt: Date
    public var doi: String?
    public var arxivId: String?
    public var venue: String?

    public init(
        id: String,
        kind: String = "article",
        url: String,
        canonicalUrl: String? = nil,
        title: String,
        authors: [String] = [],
        summaryRaw: String? = nil,
        contentText: String? = nil,
        publishedAt: Date? = nil,
        fetchedAt: Date = .now,
        doi: String? = nil,
        arxivId: String? = nil,
        venue: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.url = url
        self.canonicalUrl = canonicalUrl
        self.title = title
        self.authors = authors
        self.summaryRaw = summaryRaw
        self.contentText = contentText
        self.publishedAt = publishedAt
        self.fetchedAt = fetchedAt
        self.doi = doi
        self.arxivId = arxivId
        self.venue = venue
    }

    /// The text a summariser should actually read.
    public var readableText: String {
        [title, summaryRaw, contentText].compactMap { $0 }.joined(separator: "\n\n")
    }

    public var isScholarly: Bool { kind == "paper" || kind == "preprint" || doi != nil || arxivId != nil }
}

public enum SummaryStyle: String, Codable, Sendable, CaseIterable, Identifiable {
    case tldr
    case keyPoints = "key_points"
    case implications
    case eli5
    case methodology
    case actions

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .tldr: "TL;DR"
        case .keyPoints: "Key points"
        case .implications: "Practical implications"
        case .eli5: "In plain language"
        case .methodology: "Methodology"
        case .actions: "Actionable takeaways"
        }
    }

    /// Methodology only makes sense for something with a method section.
    public var requiresScholarlySource: Bool { self == .methodology }
}

public struct ItemSummary: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var itemId: String
    public var style: SummaryStyle
    public var text: String
    public var engine: AIEngine
    public var modelIdentifier: String?
    public var createdAt: Date

    public init(id: String = UUID().uuidString, itemId: String, style: SummaryStyle, text: String, engine: AIEngine, modelIdentifier: String? = nil, createdAt: Date = .now) {
        self.id = id
        self.itemId = itemId
        self.style = style
        self.text = text
        self.engine = engine
        self.modelIdentifier = modelIdentifier
        self.createdAt = createdAt
    }
}

public struct WorkingHours: Codable, Sendable, Hashable {
    public var weekday: Int
    public var startMinute: Int
    public var endMinute: Int
    public var enabled: Bool

    public init(weekday: Int, startMinute: Int = 540, endMinute: Int = 1080, enabled: Bool = true) {
        self.weekday = weekday
        self.startMinute = startMinute
        self.endMinute = endMinute
        self.enabled = enabled
    }
}

public struct SchedulingSettings: Codable, Sendable, Hashable {
    public var workingHours: [WorkingHours]
    public var bufferMinutes: Int
    public var minBlockMinutes: Int
    public var maxBlockMinutes: Int
    public var protectHabits: Bool
    public var autoReplanOnCalendarChange: Bool

    public init(
        workingHours: [WorkingHours] = (1...7).map { WorkingHours(weekday: $0, enabled: $0 <= 5) },
        bufferMinutes: Int = 10,
        minBlockMinutes: Int = 25,
        maxBlockMinutes: Int = 90,
        protectHabits: Bool = true,
        autoReplanOnCalendarChange: Bool = true
    ) {
        self.workingHours = workingHours
        self.bufferMinutes = bufferMinutes
        self.minBlockMinutes = minBlockMinutes
        self.maxBlockMinutes = maxBlockMinutes
        self.protectHabits = protectHabits
        self.autoReplanOnCalendarChange = autoReplanOnCalendarChange
    }
}

/// The compact slice of the account `/api/context` returns, sized to fit inside
/// a Foundation Models context window.
public struct WorkContext: Codable, Sendable {
    public struct ContextTask: Codable, Sendable, Identifiable {
        public var id: String
        public var title: String
        public var notes: String?
        public var priority: Priority
        public var status: TaskStatus
        public var dueAt: Date?
        public var estimateMinutes: Int?
        public var energy: EnergyLevel?
        public var heuristicScore: Double
        public var heuristicReasons: [String]

        public init(id: String, title: String, notes: String? = nil, priority: Priority = .p3, status: TaskStatus = .todo, dueAt: Date? = nil, estimateMinutes: Int? = nil, energy: EnergyLevel? = nil, heuristicScore: Double = 0, heuristicReasons: [String] = []) {
            self.id = id
            self.title = title
            self.notes = notes
            self.priority = priority
            self.status = status
            self.dueAt = dueAt
            self.estimateMinutes = estimateMinutes
            self.energy = energy
            self.heuristicScore = heuristicScore
            self.heuristicReasons = heuristicReasons
        }
    }

    public var generatedAt: Date
    public var timeZone: String
    public var displayName: String?
    public var tasks: [ContextTask]
    public var events: [CalendarEvent]
    public var topics: [Topic]
    public var scheduling: SchedulingSettings

    public init(generatedAt: Date = .now, timeZone: String = "UTC", displayName: String? = nil, tasks: [ContextTask] = [], events: [CalendarEvent] = [], topics: [Topic] = [], scheduling: SchedulingSettings = .init()) {
        self.generatedAt = generatedAt
        self.timeZone = timeZone
        self.displayName = displayName
        self.tasks = tasks
        self.events = events
        self.topics = topics
        self.scheduling = scheduling
    }
}

public struct TimeBlock: Codable, Sendable, Identifiable, Hashable {
    public var id: String
    public var taskId: String?
    public var title: String
    public var kind: String
    public var status: String
    public var startAt: Date
    public var endAt: Date
    /// Shown verbatim in the UI - this is how an AI decision explains itself.
    public var rationale: String?
    public var engine: AIEngine

    public init(id: String = UUID().uuidString, taskId: String? = nil, title: String, kind: String = "task", status: String = "proposed", startAt: Date, endAt: Date, rationale: String? = nil, engine: AIEngine = .heuristic) {
        self.id = id
        self.taskId = taskId
        self.title = title
        self.kind = kind
        self.status = status
        self.startAt = startAt
        self.endAt = endAt
        self.rationale = rationale
        self.engine = engine
    }

    public var durationMinutes: Int { Int(endAt.timeIntervalSince(startAt) / 60) }
}

/// A free window in the user's calendar, inside working hours.
public struct FreeSlot: Sendable, Hashable, Identifiable {
    public var start: Date
    public var end: Date

    public var id: String { "\(start.timeIntervalSince1970)-\(end.timeIntervalSince1970)" }
    public var minutes: Int { Int(end.timeIntervalSince(start) / 60) }

    public init(start: Date, end: Date) {
        self.start = start
        self.end = end
    }
}
