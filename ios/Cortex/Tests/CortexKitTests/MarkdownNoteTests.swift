import Testing
import Foundation
@testable import CortexKit

/// The Markdown these tests pin down is the sync contract with the web app:
/// a note written here must be readable by `@cortex/core` and vice versa, or
/// every sync looks like a conflict.
@Suite("Markdown notes")
struct MarkdownNoteTests {
    func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    @Test("emits Obsidian Tasks syntax")
    func taskLine() {
        let task = CortexTask(
            title: "Draft methods",
            priority: .p1,
            dueAt: date("2026-09-20T09:00:00Z"),
            startAt: date("2026-09-18T09:00:00Z"),
            recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"
        )
        let line = MarkdownNote.taskLine(task, tags: ["writing"])

        #expect(line.hasPrefix("- [ ] Draft methods"))
        #expect(line.contains("⏫"))
        #expect(line.contains("#writing"))
        #expect(line.contains("📅 2026-09-20"))
        #expect(line.contains("🛫 2026-09-18"))
        #expect(line.contains("🔁 every week on Monday"))
    }

    @Test("marks done and cancelled tasks")
    func statusMarkers() {
        #expect(MarkdownNote.taskLine(CortexTask(title: "x", status: .done)).contains("- [x]"))
        #expect(MarkdownNote.taskLine(CortexTask(title: "x", status: .cancelled)).contains("- [-]"))
        #expect(MarkdownNote.taskLine(CortexTask(title: "x", status: .inProgress)).contains("- [/]"))
    }

    @Test("reads a task line back")
    func parsingTaskLine() {
        let parsed = try! #require(MarkdownNote.parseTaskLine("- [x] Draft methods ⏫ #writing 📅 2026-09-20 ✅ 2026-09-19"))
        #expect(parsed.title == "Draft methods")
        #expect(parsed.status == .done)
        #expect(parsed.priority == .p1)
        #expect(parsed.due == "2026-09-20")
        #expect(parsed.completed == "2026-09-19")
        #expect(parsed.tags == ["writing"])
    }

    @Test("ignores lines that are not tasks")
    func nonTaskLine() {
        #expect(MarkdownNote.parseTaskLine("just a paragraph") == nil)
    }

    @Test("frontmatter round-trips")
    func frontmatterRoundTrip() {
        let task = CortexTask(title: "Draft methods", notes: "Focus on the ablation.", priority: .p2, dueAt: date("2026-09-20T09:00:00Z"))
        let note = MarkdownNote.taskNote(task, projectName: "Grant renewal", tags: ["writing"])
        let parsed = MarkdownNote.parseFrontmatter(note)

        #expect(parsed.fields["cortex_type"] == "task")
        #expect(parsed.fields["cortex_id"] == task.id)
        #expect(parsed.fields["project"] == "Grant renewal")
        #expect(parsed.lists["tags"] == ["writing"])
        #expect(parsed.body.contains("- [ ] Draft methods"))
    }

    @Test("quotes only values that would otherwise break YAML")
    func quoting() {
        #expect(MarkdownNote.quote("Solid state batteries") == "Solid state batteries")
        #expect(MarkdownNote.quote("10.1000/xyz123") == "10.1000/xyz123")
        #expect(MarkdownNote.quote("2026-09-14") == "2026-09-14")
        #expect(MarkdownNote.quote("a: b") == "\"a: b\"")
        #expect(MarkdownNote.quote("true") == "\"true\"")
        #expect(MarkdownNote.quote("- item") == "\"- item\"")
    }

    @Test("labels which engine wrote a summary")
    func summaryProvenance() {
        let item = InfoItem(id: "i1", url: "https://example.com/a", title: "Sulfide electrolytes")

        let afmNote = MarkdownNote.itemNote(item, summaries: [
            ItemSummary(itemId: "i1", style: .tldr, text: "A new electrolyte.", engine: .afm)
        ])
        #expect(afmNote.contains("Apple Foundation Models"))
        #expect(afmNote.contains("ai_engine: afm"))

        let fallbackNote = MarkdownNote.itemNote(item, summaries: [
            ItemSummary(itemId: "i1", style: .tldr, text: "Extract.", engine: .heuristic)
        ])
        #expect(fallbackNote.contains("Sentences extracted"))
        #expect(!fallbackNote.contains("Apple Foundation Models"))
    }

    @Test("replaces only the Cortex block in a daily note")
    func dailySectionMerge() {
        let section = MarkdownNote.dailySection(day: date("2026-09-14T00:00:00Z"), tasks: [CortexTask(title: "Draft methods")], events: [])
        let existing = """
        # 2026-09-14

        My own journal entry.

        <!-- cortex:start -->
        old content
        <!-- cortex:end -->

        More of my notes.
        """

        let merged = MarkdownNote.upsertDailySection(in: existing, section: section)
        #expect(merged.contains("My own journal entry."))
        #expect(merged.contains("More of my notes."))
        #expect(!merged.contains("old content"))
        #expect(merged.contains("Draft methods"))
    }

    @Test("appends the section when the note has none")
    func dailySectionAppend() {
        let merged = MarkdownNote.upsertDailySection(
            in: "# 2026-09-14\n\nJournal.",
            section: MarkdownNote.dailySection(day: date("2026-09-14T00:00:00Z"), tasks: [], events: [])
        )
        #expect(merged.contains("Journal."))
        #expect(merged.contains("## Cortex"))
        #expect(merged.contains("_No tasks due._"))
    }

    @Test("slugifies safely")
    func slugs() {
        #expect(MarkdownNote.slug("Étude of the \"Solid-State\" Battery!") == "etude-of-the-solid-state-battery")
        #expect(MarkdownNote.slug("") == "untitled")
        #expect(MarkdownNote.slug(String(repeating: "a", count: 200)).count <= 60)
    }
}

@Suite("Heuristic intelligence")
struct HeuristicIntelligenceTests {
    let engine = HeuristicIntelligence(reason: .deviceNotEligible)

    let abstract = """
    Solid-state batteries promise higher energy density. We present a sulfide electrolyte synthesised by ball milling. \
    The method uses a two-step anneal and we evaluate 1200 cycles at 1C. Results show a coulombic efficiency of 99.9 percent. \
    This implies that dendrite suppression should enable automotive packs within three years.
    """

    var item: InfoItem {
        InfoItem(id: "i1", kind: "paper", url: "https://example.com/a", title: "Sulfide electrolytes", summaryRaw: abstract, doi: "10.1000/x")
    }

    @Test("reports why it is standing in for the model")
    func availability() async {
        #expect(await engine.availability == .deviceNotEligible)
        #expect(await engine.availability.explanation.contains("does not support"))
    }

    @Test("refuses to fake the styles it cannot produce")
    func honestStyles() async {
        let styles = await engine.supportedStyles(for: item)
        #expect(!styles.contains(.eli5))
        #expect(styles.contains(.tldr))
        #expect(styles.contains(.methodology))

        await #expect(throws: IntelligenceError.self) {
            _ = try await engine.summarize(item, style: .eli5)
        }
    }

    @Test("extracts real sentences and labels them as such")
    func extraction() async throws {
        let result = try await engine.summarize(item, style: .tldr)
        #expect(result.engine == .heuristic)
        #expect(!result.value.isEmpty)
        #expect(abstract.contains(result.value.prefix(30)))
    }

    @Test("finds methodology sentences when they exist")
    func methodology() async throws {
        let result = try await engine.summarize(item, style: .methodology)
        #expect(result.value.lowercased().contains("method"))
    }

    @Test("ranks by keyword overlap and recency")
    func ranking() async throws {
        let context = WorkContext(
            topics: [Topic(id: "t1", label: "Solid state batteries", keywords: ["electrolyte", "dendrite"])]
        )
        let related = InfoItem(id: "a", url: "https://example.com/a", title: "Sulfide electrolyte suppresses dendrite growth", publishedAt: .now)
        let unrelated = InfoItem(id: "b", url: "https://example.com/b", title: "Municipal bond yields tick up", publishedAt: .now)

        let result = try await engine.rank(items: [related, unrelated], context: context)
        #expect(result.value.count == 1)
        #expect(result.value.first?.itemId == "a")
        #expect(result.value.first?.reason.contains("Solid state batteries") == true)
    }

    @Test("places blocks without overlapping them")
    func scheduling() async throws {
        let slots = [FreeSlot(start: .now, end: .now.addingTimeInterval(4 * 3600))]
        let tasks = [
            WorkContext.ContextTask(id: "1", title: "A", estimateMinutes: 60, heuristicScore: 0.9),
            WorkContext.ContextTask(id: "2", title: "B", estimateMinutes: 60, heuristicScore: 0.8),
        ]

        let result = try await engine.proposeBlocks(tasks: tasks, slots: slots, settings: SchedulingSettings())
        #expect(result.value.count == 2)
        let first = result.value[0]
        let second = result.value[1]
        #expect(second.startAt >= first.endAt)
        #expect(!first.rationale.isEmpty)
    }

    @Test("refuses generative writing rather than echoing the input back")
    func writingRefusal() async {
        await #expect(throws: IntelligenceError.self) {
            _ = try await engine.rewrite("some text", as: .shortNote)
        }
    }

    @Test("still extracts parameters, which needs no model")
    func parameters() async throws {
        let result = try await engine.rewrite("The cell ran 1200 cycles at 3.7 V and 250 mAh capacity.", as: .keyParameters)
        #expect(result.value.contains("3.7 V"))
        #expect(result.value.contains("250 mAh"))
    }
}
