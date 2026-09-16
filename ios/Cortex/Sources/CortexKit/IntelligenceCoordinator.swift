import Foundation
import Observation

/// Chooses which intelligence answers, and remembers which one did.
///
/// The app never talks to `FoundationModelsIntelligence` or
/// `HeuristicIntelligence` directly. It asks the coordinator, which tries the
/// on-device model and falls back when it is unavailable - and then tells the
/// UI which engine produced the answer, so an extract is never displayed as if
/// a model had written it.
@Observable
@MainActor
public final class IntelligenceCoordinator {
    public private(set) var availability: IntelligenceAvailability = .unknown
    /// Set when the model was tried and could not answer, so the UI can say why.
    public private(set) var lastFallbackReason: String?

    private let primary: any Intelligence
    private let fallback: any Intelligence

    public init(primary: any Intelligence, fallback: any Intelligence = HeuristicIntelligence()) {
        self.primary = primary
        self.fallback = fallback
    }

    public func refreshAvailability() async {
        availability = await primary.availability
    }

    public var isOnDevice: Bool { availability.isAvailable }

    /// Run a request against the model, falling back on any failure that is not
    /// the user cancelling.
    private func attempt<T: Sendable>(
        _ label: String,
        primaryCall: (any Intelligence) async throws -> IntelligenceResult<T>,
        fallbackCall: (any Intelligence) async throws -> IntelligenceResult<T>
    ) async throws -> IntelligenceResult<T> {
        if availability.isAvailable {
            do {
                let result = try await primaryCall(primary)
                lastFallbackReason = nil
                return result
            } catch IntelligenceError.cancelled {
                throw IntelligenceError.cancelled
            } catch let error as IntelligenceError {
                lastFallbackReason = "\(label): \(error.userMessage)"
            } catch {
                lastFallbackReason = "\(label): \(error.localizedDescription)"
            }
        } else {
            lastFallbackReason = availability.explanation
        }
        return try await fallbackCall(fallback)
    }

    public func supportedStyles(for item: InfoItem) async -> [SummaryStyle] {
        availability.isAvailable ? await primary.supportedStyles(for: item) : await fallback.supportedStyles(for: item)
    }

    public func parseCapture(_ text: String, now: Date = .now, timeZone: TimeZone = .current) async -> IntelligenceResult<ParsedCapture> {
        // Capture must never fail, so a throw here degrades to the grammar.
        (try? await attempt(
            "Capture",
            primaryCall: { try await $0.parseCapture(text, now: now, timeZone: timeZone) },
            fallbackCall: { try await $0.parseCapture(text, now: now, timeZone: timeZone) }
        )) ?? IntelligenceResult(value: CaptureGrammar.parse(text, now: now, timeZone: timeZone), engine: .heuristic)
    }

    public func summarize(_ item: InfoItem, style: SummaryStyle) async throws -> IntelligenceResult<String> {
        try await attempt(
            "Summary",
            primaryCall: { try await $0.summarize(item, style: style) },
            fallbackCall: { try await $0.summarize(item, style: style) }
        )
    }

    public func breakDown(task: CortexTask, context: WorkContext) async throws -> IntelligenceResult<[SubtaskSuggestion]> {
        try await attempt(
            "Breakdown",
            primaryCall: { try await $0.breakDown(task: task, context: context) },
            fallbackCall: { try await $0.breakDown(task: task, context: context) }
        )
    }

    public func prioritize(context: WorkContext, limit: Int = 12) async throws -> IntelligenceResult<[PrioritizedTask]> {
        try await attempt(
            "Prioritisation",
            primaryCall: { try await $0.prioritize(context: context, limit: limit) },
            fallbackCall: { try await $0.prioritize(context: context, limit: limit) }
        )
    }

    public func rank(items: [InfoItem], context: WorkContext) async throws -> IntelligenceResult<[RankedItem]> {
        try await attempt(
            "Ranking",
            primaryCall: { try await $0.rank(items: items, context: context) },
            fallbackCall: { try await $0.rank(items: items, context: context) }
        )
    }

    public func proposeBlocks(tasks: [WorkContext.ContextTask], slots: [FreeSlot], settings: SchedulingSettings) async throws -> IntelligenceResult<[ProposedBlock]> {
        try await attempt(
            "Scheduling",
            primaryCall: { try await $0.proposeBlocks(tasks: tasks, slots: slots, settings: settings) },
            fallbackCall: { try await $0.proposeBlocks(tasks: tasks, slots: slots, settings: settings) }
        )
    }

    public func rewrite(_ text: String, as task: WritingTask) async throws -> IntelligenceResult<String> {
        try await attempt(
            "Writing",
            primaryCall: { try await $0.rewrite(text, as: task) },
            fallbackCall: { try await $0.rewrite(text, as: task) }
        )
    }
}
