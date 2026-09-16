import Foundation
import FoundationModels
import CortexKit

// MARK: - Guided generation schemas
//
// Foundation Models emits these structures directly through guided generation:
// the `@Generable` macro turns each type into a schema the decoder constrains
// the model to, so there is no free-text parsing anywhere in Cortex and a
// malformed response is impossible rather than merely unlikely.
//
// `@Guide` descriptions are part of the contract the model sees. They are
// written as instructions to the model about the *field*, and they are the
// right place for constraints that would otherwise have to be re-checked in
// code.

@Generable
struct GeneratedCapture {
    @Guide(description: "The task itself, in the person's own words, with any date, time, duration, #project, @tag and priority marker removed.")
    var title: String

    @Guide(description: "Due date and time as ISO-8601 with an offset, e.g. 2026-09-14T09:00:00+01:00. Empty string when the text gives no date.")
    var dueAt: String

    @Guide(description: "True when a day was given with no time of day.")
    var dueAllDay: Bool

    @Guide(description: "How long the person said the work takes, in minutes. Zero when unstated.", .range(0...600))
    var estimateMinutes: Int

    @Guide(description: "p1 is urgent, p2 important, p3 normal, p4 someday. Use p3 unless the text signals otherwise.", .anyOf(["p1", "p2", "p3", "p4"]))
    var priority: String

    @Guide(description: "low, medium or high when the text says how demanding the work is, otherwise an empty string.", .anyOf(["", "low", "medium", "high"]))
    var energy: String

    @Guide(description: "An RFC 5545 RRULE body such as FREQ=WEEKLY;INTERVAL=1;BYDAY=MO when the work repeats. Empty string when it does not.")
    var recurrenceRule: String

    @Guide(description: "The #project name without the hash, or an empty string.")
    var projectName: String

    @Guide(description: "Each @tag without the at sign, lower case.", .maximumCount(6))
    var tagNames: [String]

    @Guide(description: "How confident you are that this is what the person meant, 0 to 1.")
    var confidence: Double

    /// Convert to the domain type, validating everything the model produced.
    ///
    /// The model is asked for an ISO-8601 string rather than a `Date` because a
    /// date is not representable in a generation schema; parsing it here means
    /// an unparseable value degrades to "no due date" instead of throwing.
    func toDomain(now: Date, timeZone: TimeZone) -> ParsedCapture {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        var parsedDate = formatter.date(from: dueAt)
        if parsedDate == nil, !dueAt.isEmpty {
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            parsedDate = formatter.date(from: dueAt)
        }

        return ParsedCapture(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            dueAt: parsedDate,
            dueAllDay: dueAllDay,
            estimateMinutes: estimateMinutes >= 5 ? estimateMinutes : nil,
            priority: Priority(rawValue: priority) ?? .p3,
            energy: EnergyLevel(rawValue: energy),
            recurrenceRule: recurrenceRule.isEmpty ? nil : recurrenceRule,
            projectName: projectName.isEmpty ? nil : projectName,
            tagNames: tagNames.map { $0.lowercased() },
            confidence: min(1, max(0, confidence))
        )
    }
}

@Generable
struct GeneratedSummary {
    @Guide(description: "The summary itself. No preamble, no restating the title.")
    var text: String
}

@Generable
struct GeneratedText {
    @Guide(description: "The rewritten text, and nothing else.")
    var text: String
}

@Generable
struct GeneratedSubtasks {
    @Generable
    struct Step {
        @Guide(description: "One concrete action, phrased so the person could start it without deciding anything first.")
        var title: String

        @Guide(description: "Realistic minutes for this step, rounded to five.", .range(5...480))
        var estimateMinutes: Int

        @Guide(description: "Why this step exists, when it is not obvious. Empty string otherwise.")
        var rationale: String
    }

    @Guide(description: "Three to six steps, in the order they should be done.", .maximumCount(6))
    var steps: [Step]
}

@Generable
struct GeneratedPriorities {
    @Generable
    struct Ranked {
        @Guide(description: "The task id exactly as it appeared in the input.")
        var taskId: String

        @Guide(description: "How much this deserves attention today, 0 to 1.")
        var score: Double

        @Guide(description: "One sentence the person would accept as the reason. Name the actual driver, not 'it is high priority'.")
        var reason: String

        @Guide(description: "The very next physical action, when the task makes one obvious. Empty string otherwise.")
        var nextAction: String
    }

    @Guide(description: "Every task from the input, reordered by what deserves attention now.", .maximumCount(40))
    var tasks: [Ranked]
}

@Generable
struct GeneratedRanking {
    @Generable
    struct Judged {
        @Guide(description: "The item id exactly as it appeared in the input.")
        var itemId: String

        @Guide(description: "The topic label this most relates to, exactly as given. Empty string when it relates to their open work rather than a named topic.")
        var topicLabel: String

        @Guide(description: "How much this would inform or change their current work, 0 to 1.")
        var score: Double

        @Guide(description: "One sentence naming what in their work this connects to.")
        var reason: String
    }

    @Guide(description: "Every item from the input, scored.", .maximumCount(20))
    var items: [Judged]
}

@Generable
struct GeneratedSchedule {
    @Generable
    struct Placement {
        @Guide(description: "The task id exactly as it appeared in the input.")
        var taskId: String

        @Guide(description: "Which free slot to use, by its index in the input list.")
        var slotIndex: Int

        @Guide(description: "Minutes after the start of that slot to begin, so several blocks can share one long slot.", .range(0...600))
        var offsetMinutes: Int

        @Guide(description: "How long the block should be, in minutes.", .range(10...480))
        var minutes: Int

        @Guide(description: "One sentence naming the task and why this slot suits it.")
        var rationale: String
    }

    @Guide(description: "One entry per task you could place. Leave a task out rather than forcing it into a bad slot.", .maximumCount(12))
    var blocks: [Placement]
}

@Generable
struct GeneratedDigestHeadline {
    @Guide(description: "One line summing up what is new and worth their attention. Under 90 characters, no clickbait, name the actual subject.")
    var headline: String
}

@Generable
struct GeneratedTopicProposal {
    @Generable
    struct Proposal {
        @Guide(description: "A short label for the subject, in title case.")
        var label: String

        @Guide(description: "Search terms that would find new work on this subject.", .maximumCount(8))
        var keywords: [String]

        @Guide(description: "What in their notes or tasks this came from.")
        var evidence: String
    }

    @Guide(description: "Subjects this person is actually working on, most central first.", .maximumCount(10))
    var topics: [Proposal]
}
