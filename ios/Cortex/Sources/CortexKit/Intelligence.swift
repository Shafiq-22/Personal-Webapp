import Foundation

// MARK: - The AI boundary
//
// `CortexKit` declares what intelligence the app needs; `CortexAI` implements
// it with Apple Foundation Models, and `HeuristicIntelligence` (below) implements
// the same protocol without any model at all.
//
// Nothing above this line knows whether a model is present. That is the whole
// point: the app is fully usable on a device that cannot run Foundation Models,
// and the UI can state precisely which engine answered.

/// Why on-device intelligence is or is not usable right now.
///
/// Mirrors `SystemLanguageModel.Availability` so the app can explain the exact
/// reason instead of hiding the feature.
public enum IntelligenceAvailability: String, Sendable, Codable, Equatable {
    case available
    case deviceNotEligible = "device_not_eligible"
    case modelNotReady = "model_not_ready"
    case appleIntelligenceDisabled = "apple_intelligence_disabled"
    case unsupportedOS = "unsupported_os"
    case unknown

    public var isAvailable: Bool { self == .available }

    /// User-facing explanation. Deliberately specific: "unavailable" on its own
    /// is not something a person can act on.
    public var explanation: String {
        switch self {
        case .available:
            "On-device intelligence is ready. Summaries and ranking run here, offline."
        case .deviceNotEligible:
            "This device does not support Apple Intelligence, so summaries and ranking use the built-in fallback."
        case .modelNotReady:
            "The on-device model is still downloading. AI features will switch on by themselves once it finishes."
        case .appleIntelligenceDisabled:
            "Apple Intelligence is switched off in Settings. Turn it on to enable on-device summaries and ranking."
        case .unsupportedOS:
            "This version of iOS does not include Foundation Models. Update to use on-device AI features."
        case .unknown:
            "The on-device model has not reported its status yet."
        }
    }

    public var actionTitle: String? {
        switch self {
        case .appleIntelligenceDisabled: "Open Settings"
        case .unsupportedOS: "Check for updates"
        default: nil
        }
    }
}

public enum IntelligenceError: Error, Sendable, Equatable {
    case unavailable(IntelligenceAvailability)
    case contextWindowExceeded
    case guardrailTriggered
    case decodingFailed(String)
    case cancelled
    case underlying(String)

    public var userMessage: String {
        switch self {
        case .unavailable(let availability): availability.explanation
        case .contextWindowExceeded: "That was too long for the on-device model to read in one go."
        case .guardrailTriggered: "The on-device model declined to process this content."
        case .decodingFailed: "The on-device model returned something unexpected."
        case .cancelled: "Cancelled."
        case .underlying(let message): message
        }
    }
}

// MARK: - Structured results
//
// These are the shapes the model is asked to produce. `CortexAI` mirrors each
// one as a `@Generable` type so Foundation Models emits it directly through
// guided generation rather than free text that has to be parsed.

public struct ParsedCapture: Sendable, Equatable, Codable {
    public var title: String
    public var dueAt: Date?
    public var dueAllDay: Bool
    public var estimateMinutes: Int?
    public var priority: Priority
    public var energy: EnergyLevel?
    public var recurrenceRule: String?
    public var projectName: String?
    public var tagNames: [String]
    public var confidence: Double

    public init(
        title: String,
        dueAt: Date? = nil,
        dueAllDay: Bool = false,
        estimateMinutes: Int? = nil,
        priority: Priority = .p3,
        energy: EnergyLevel? = nil,
        recurrenceRule: String? = nil,
        projectName: String? = nil,
        tagNames: [String] = [],
        confidence: Double = 0
    ) {
        self.title = title
        self.dueAt = dueAt
        self.dueAllDay = dueAllDay
        self.estimateMinutes = estimateMinutes
        self.priority = priority
        self.energy = energy
        self.recurrenceRule = recurrenceRule
        self.projectName = projectName
        self.tagNames = tagNames
        self.confidence = confidence
    }
}

public struct SubtaskSuggestion: Sendable, Equatable, Codable, Identifiable {
    public var id: String { title }
    public var title: String
    public var estimateMinutes: Int
    public var rationale: String?

    public init(title: String, estimateMinutes: Int, rationale: String? = nil) {
        self.title = title
        self.estimateMinutes = estimateMinutes
        self.rationale = rationale
    }
}

public struct PrioritizedTask: Sendable, Equatable, Codable, Identifiable {
    public var id: String { taskId }
    public var taskId: String
    /// 0-1. Higher means "do this sooner".
    public var score: Double
    /// One sentence, shown to the user verbatim.
    public var reason: String
    public var suggestedNextAction: String?

    public init(taskId: String, score: Double, reason: String, suggestedNextAction: String? = nil) {
        self.taskId = taskId
        self.score = score
        self.reason = reason
        self.suggestedNextAction = suggestedNextAction
    }
}

public struct RankedItem: Sendable, Equatable, Codable, Identifiable {
    public var id: String { itemId }
    public var itemId: String
    public var topicId: String?
    /// 0-1 relevance against the user's open work.
    public var score: Double
    public var reason: String

    public init(itemId: String, topicId: String? = nil, score: Double, reason: String) {
        self.itemId = itemId
        self.topicId = topicId
        self.score = score
        self.reason = reason
    }
}

public struct ProposedBlock: Sendable, Equatable, Codable {
    public var taskId: String
    public var startAt: Date
    public var endAt: Date
    public var rationale: String

    public init(taskId: String, startAt: Date, endAt: Date, rationale: String) {
        self.taskId = taskId
        self.startAt = startAt
        self.endAt = endAt
        self.rationale = rationale
    }
}

public enum WritingTask: String, Sendable, CaseIterable, Identifiable {
    case taskDescription
    case shortNote
    case keyParameters
    case rewriteConcise

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .taskDescription: "Rewrite as a task description"
        case .shortNote: "Draft a short note"
        case .keyParameters: "Extract key parameters"
        case .rewriteConcise: "Make it concise"
        }
    }
}

/// A single result plus the engine that produced it, so the UI never has to
/// guess whether it is showing model output or a deterministic fallback.
public struct IntelligenceResult<Value: Sendable>: Sendable {
    public var value: Value
    public var engine: AIEngine
    public var modelIdentifier: String?

    public init(value: Value, engine: AIEngine, modelIdentifier: String? = nil) {
        self.value = value
        self.engine = engine
        self.modelIdentifier = modelIdentifier
    }
}

// MARK: - The protocol

/// Everything the app asks an intelligence layer to do.
///
/// Implemented twice: once with Apple Foundation Models (`FoundationModelsIntelligence`)
/// and once without a model at all (`HeuristicIntelligence`). The app holds the
/// protocol, never a concrete type.
public protocol Intelligence: Sendable {
    var availability: IntelligenceAvailability { get async }

    /// Which summary styles this engine can honestly produce for this item.
    /// The fallback cannot write an ELI5, so it does not claim to.
    func supportedStyles(for item: InfoItem) async -> [SummaryStyle]

    func parseCapture(_ text: String, now: Date, timeZone: TimeZone) async throws -> IntelligenceResult<ParsedCapture>

    func summarize(_ item: InfoItem, style: SummaryStyle) async throws -> IntelligenceResult<String>

    func breakDown(task: CortexTask, context: WorkContext) async throws -> IntelligenceResult<[SubtaskSuggestion]>

    func prioritize(context: WorkContext, limit: Int) async throws -> IntelligenceResult<[PrioritizedTask]>

    func rank(items: [InfoItem], context: WorkContext) async throws -> IntelligenceResult<[RankedItem]>

    func proposeBlocks(tasks: [WorkContext.ContextTask], slots: [FreeSlot], settings: SchedulingSettings) async throws -> IntelligenceResult<[ProposedBlock]>

    func rewrite(_ text: String, as task: WritingTask) async throws -> IntelligenceResult<String>
}
