import Testing
import Foundation
@testable import CortexAI
@testable import CortexKit

/// These tests cover the boundary between the model's output and the app's
/// domain - the place where a plausible-but-wrong generation must not become a
/// bad task or a calendar event at the wrong time.
///
/// The `Intelligence` conformance itself is exercised through
/// `MockIntelligence` rather than by invoking Foundation Models, because the
/// on-device model needs real hardware and is not deterministic; what is worth
/// pinning down is the decoding, the clamping and the fallback behaviour.
@Suite("Generated type decoding")
struct GeneratedTypesTests {
    let now = Date(timeIntervalSince1970: 1_789_635_600)
    let utc = TimeZone(identifier: "UTC")!

    func generated(
        title: String = "Draft methods",
        dueAt: String = "",
        dueAllDay: Bool = false,
        estimateMinutes: Int = 0,
        priority: String = "p3",
        energy: String = "",
        recurrenceRule: String = "",
        projectName: String = "",
        tagNames: [String] = [],
        confidence: Double = 0.8
    ) -> GeneratedCapture {
        GeneratedCapture(
            title: title,
            dueAt: dueAt,
            dueAllDay: dueAllDay,
            estimateMinutes: estimateMinutes,
            priority: priority,
            energy: energy,
            recurrenceRule: recurrenceRule,
            projectName: projectName,
            tagNames: tagNames,
            confidence: confidence
        )
    }

    @Test("decodes a well-formed generation")
    func wellFormed() {
        let parsed = generated(
            dueAt: "2026-09-14T09:00:00Z",
            estimateMinutes: 90,
            priority: "p1",
            energy: "high",
            recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
            projectName: "Grant",
            tagNames: ["Writing"]
        ).toDomain(now: now, timeZone: utc)

        #expect(parsed.title == "Draft methods")
        #expect(parsed.priority == .p1)
        #expect(parsed.energy == .high)
        #expect(parsed.estimateMinutes == 90)
        #expect(parsed.projectName == "Grant")
        #expect(parsed.tagNames == ["writing"])
        #expect(parsed.dueAt != nil)
    }

    @Test("an unparseable date degrades to no due date instead of throwing")
    func badDate() {
        let parsed = generated(dueAt: "next tuesday-ish").toDomain(now: now, timeZone: utc)
        #expect(parsed.dueAt == nil)
        #expect(parsed.title == "Draft methods")
    }

    @Test("empty optional fields become nil rather than empty strings")
    func emptyFields() {
        let parsed = generated().toDomain(now: now, timeZone: utc)
        #expect(parsed.dueAt == nil)
        #expect(parsed.projectName == nil)
        #expect(parsed.recurrenceRule == nil)
        #expect(parsed.energy == nil)
        #expect(parsed.estimateMinutes == nil)
    }

    @Test("an out-of-range priority falls back to normal")
    func badPriority() {
        #expect(generated(priority: "urgent!!").toDomain(now: now, timeZone: utc).priority == .p3)
    }

    @Test("a too-short estimate is dropped rather than stored")
    func tinyEstimate() {
        #expect(generated(estimateMinutes: 2).toDomain(now: now, timeZone: utc).estimateMinutes == nil)
    }

    @Test("confidence is clamped")
    func clampedConfidence() {
        #expect(generated(confidence: 3.2).toDomain(now: now, timeZone: utc).confidence == 1)
        #expect(generated(confidence: -1).toDomain(now: now, timeZone: utc).confidence == 0)
    }

    @Test("long documents are trimmed on a sentence boundary")
    func fitting() {
        let text = String(repeating: "This is a sentence about batteries. ", count: 500)
        let (trimmed, wasTruncated) = FoundationModelsIntelligence.fit(text, characters: 1_000)
        #expect(wasTruncated)
        #expect(trimmed.count <= 1_000)
        #expect(trimmed.hasSuffix("."))

        let short = "Short enough."
        #expect(FoundationModelsIntelligence.fit(short, characters: 1_000) == (short, false))
    }

    @Test("batches long feeds so a context window cannot overflow")
    func chunking() {
        let items = Array(1...20)
        let batches = items.chunked(into: 8)
        #expect(batches.count == 3)
        #expect(batches[0].count == 8)
        #expect(batches[2].count == 4)
    }
}

/// A stand-in for the model, used to test the coordinator's fallback logic
/// without needing a device that can run Foundation Models.
struct MockIntelligence: Intelligence {
    var availabilityValue: IntelligenceAvailability = .available
    var shouldFail = false

    var availability: IntelligenceAvailability { get async { availabilityValue } }

    func supportedStyles(for item: InfoItem) async -> [SummaryStyle] { SummaryStyle.allCases }

    private func check() throws {
        if shouldFail { throw IntelligenceError.guardrailTriggered }
    }

    func parseCapture(_ text: String, now: Date, timeZone: TimeZone) async throws -> IntelligenceResult<ParsedCapture> {
        try check()
        return IntelligenceResult(value: ParsedCapture(title: "model: \(text)", confidence: 1), engine: .afm, modelIdentifier: "mock")
    }

    func summarize(_ item: InfoItem, style: SummaryStyle) async throws -> IntelligenceResult<String> {
        try check()
        return IntelligenceResult(value: "model summary", engine: .afm, modelIdentifier: "mock")
    }

    func breakDown(task: CortexTask, context: WorkContext) async throws -> IntelligenceResult<[SubtaskSuggestion]> {
        try check()
        return IntelligenceResult(value: [SubtaskSuggestion(title: "step", estimateMinutes: 30)], engine: .afm)
    }

    func prioritize(context: WorkContext, limit: Int) async throws -> IntelligenceResult<[PrioritizedTask]> {
        try check()
        return IntelligenceResult(value: [PrioritizedTask(taskId: "1", score: 1, reason: "model reason")], engine: .afm)
    }

    func rank(items: [InfoItem], context: WorkContext) async throws -> IntelligenceResult<[RankedItem]> {
        try check()
        return IntelligenceResult(value: items.map { RankedItem(itemId: $0.id, score: 0.9, reason: "model reason") }, engine: .afm)
    }

    func proposeBlocks(tasks: [WorkContext.ContextTask], slots: [FreeSlot], settings: SchedulingSettings) async throws -> IntelligenceResult<[ProposedBlock]> {
        try check()
        return IntelligenceResult(value: [], engine: .afm)
    }

    func rewrite(_ text: String, as task: WritingTask) async throws -> IntelligenceResult<String> {
        try check()
        return IntelligenceResult(value: "model text", engine: .afm)
    }
}

@Suite("Intelligence coordinator")
@MainActor
struct IntelligenceCoordinatorTests {
    @Test("uses the model when it is available")
    func usesModel() async {
        let coordinator = IntelligenceCoordinator(primary: MockIntelligence())
        await coordinator.refreshAvailability()
        #expect(coordinator.isOnDevice)

        let result = await coordinator.parseCapture("email the reviewers")
        #expect(result.engine == .afm)
        #expect(result.value.title.hasPrefix("model:"))
    }

    @Test("falls back when the model is unavailable, and says why")
    func fallsBackWhenUnavailable() async {
        let coordinator = IntelligenceCoordinator(
            primary: MockIntelligence(availabilityValue: .appleIntelligenceDisabled),
            fallback: HeuristicIntelligence(reason: .appleIntelligenceDisabled)
        )
        await coordinator.refreshAvailability()
        #expect(!coordinator.isOnDevice)

        let result = await coordinator.parseCapture("email the reviewers tomorrow")
        #expect(result.engine == .heuristic)
        #expect(result.value.title == "email the reviewers")
        #expect(coordinator.lastFallbackReason?.contains("switched off") == true)
    }

    @Test("falls back when the model errors mid-request")
    func fallsBackOnError() async throws {
        let coordinator = IntelligenceCoordinator(primary: MockIntelligence(shouldFail: true))
        await coordinator.refreshAvailability()

        let item = InfoItem(id: "i1", url: "https://example.com", title: "A paper", summaryRaw: String(repeating: "A sentence about batteries and electrolytes. ", count: 6))
        let result = try await coordinator.summarize(item, style: .tldr)

        #expect(result.engine == .heuristic)
        #expect(coordinator.lastFallbackReason?.contains("declined") == true)
    }

    @Test("capture never throws, whatever happens")
    func captureNeverThrows() async {
        let coordinator = IntelligenceCoordinator(
            primary: MockIntelligence(shouldFail: true),
            fallback: MockIntelligence(shouldFail: true)
        )
        await coordinator.refreshAvailability()

        let result = await coordinator.parseCapture("buy milk tomorrow")
        #expect(result.engine == .heuristic)
        #expect(result.value.title == "buy milk")
    }
}
