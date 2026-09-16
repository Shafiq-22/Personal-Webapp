import Testing
import Foundation
@testable import CortexKit

/// The capture grammar has to agree with the TypeScript one in `@cortex/core`:
/// the same sentence must produce the same task whether it was typed on the
/// phone or in the browser. These cases mirror `packages/core/test/nl.test.ts`.
@Suite("Capture grammar")
struct CaptureGrammarTests {
    // Sunday 2026-09-13 09:00 UTC, matching the web test fixture.
    let reference = Date(timeIntervalSince1970: 1_789_635_600)
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }
    var utc: TimeZone { TimeZone(identifier: "UTC")! }

    @Test("pulls every structured field out and leaves a clean title")
    func fullCapture() {
        let parsed = CaptureGrammar.parse(
            "Draft grant section tomorrow at 9am for 90m #Grant-Renewal @writing !1",
            now: reference,
            timeZone: utc
        )

        #expect(parsed.title == "Draft grant section")
        #expect(parsed.priority == .p1)
        #expect(parsed.projectName == "Grant Renewal")
        #expect(parsed.tagNames == ["writing"])
        #expect(parsed.estimateMinutes == 90)
        #expect(parsed.confidence > 0.5)

        let due = try! #require(parsed.dueAt)
        let components = calendar.dateComponents([.year, .month, .day, .hour], from: due)
        #expect(components.day == 14)
        #expect(components.hour == 9)
    }

    @Test("treats a bare date as all day")
    func bareDate() {
        let parsed = CaptureGrammar.parse("renew the licence 2026-10-01", now: reference, timeZone: utc)
        #expect(parsed.dueAllDay)
        #expect(parsed.title == "renew the licence")
        let due = try! #require(parsed.dueAt)
        #expect(calendar.component(.month, from: due) == 10)
    }

    @Test("rolls a bare weekday forward, never backwards")
    func weekdayRollsForward() {
        let parsed = CaptureGrammar.parse("call the vendor on friday", now: reference, timeZone: utc)
        let due = try! #require(parsed.dueAt)
        #expect(calendar.component(.day, from: due) == 18)
        #expect(parsed.title == "call the vendor")
    }

    @Test("rolls a past time of day to tomorrow")
    func pastTimeRolls() {
        let parsed = CaptureGrammar.parse("gym at 7am", now: reference, timeZone: utc)
        let due = try! #require(parsed.dueAt)
        #expect(due > reference)
        #expect(calendar.component(.day, from: due) == 14)
    }

    @Test("extracts recurrence and anchors on its first weekday")
    func recurrence() {
        let parsed = CaptureGrammar.parse("lab meeting every monday for 90 minutes", now: reference, timeZone: utc)
        #expect(parsed.recurrenceRule == "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO")
        #expect(parsed.estimateMinutes == 90)
        #expect(parsed.title == "lab meeting")
    }

    @Test("never produces an empty title")
    func neverEmpty() {
        #expect(!CaptureGrammar.parse("tomorrow", now: reference, timeZone: utc).title.isEmpty)
    }

    @Test("leaves plain text alone")
    func plainText() {
        let parsed = CaptureGrammar.parse("think about the polymer problem", now: reference, timeZone: utc)
        #expect(parsed.title == "think about the polymer problem")
        #expect(parsed.dueAt == nil)
        #expect(parsed.confidence == 0)
    }

    @Test("respects the user's time zone")
    func timeZones() {
        let tokyo = TimeZone(identifier: "Asia/Tokyo")!
        let parsed = CaptureGrammar.parse("standup tomorrow at 9am", now: reference, timeZone: tokyo)
        let due = try! #require(parsed.dueAt)

        var tokyoCalendar = Calendar(identifier: .gregorian)
        tokyoCalendar.timeZone = tokyo
        #expect(tokyoCalendar.component(.hour, from: due) == 9)
    }
}
