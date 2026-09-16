import Testing
import Foundation
@testable import CortexKit

@Suite("Free slots")
struct SchedulingTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    var weekdaySettings: SchedulingSettings {
        SchedulingSettings(
            workingHours: (1...7).map { WorkingHours(weekday: $0, startMinute: 540, endMinute: 1020, enabled: $0 <= 5) },
            bufferMinutes: 0,
            minBlockMinutes: 30
        )
    }

    @Test("returns the gaps between meetings inside working hours")
    func gaps() {
        let slots = Scheduling.freeSlots(
            busy: [
                .init(start: date("2026-09-14T10:00:00Z"), end: date("2026-09-14T11:00:00Z")),
                .init(start: date("2026-09-14T13:00:00Z"), end: date("2026-09-14T14:00:00Z")),
            ],
            from: date("2026-09-14T00:00:00Z"),
            to: date("2026-09-14T23:00:00Z"),
            settings: weekdaySettings,
            calendar: calendar
        )

        #expect(slots.count == 3)
        #expect(slots[0].start == date("2026-09-14T09:00:00Z"))
        #expect(slots[0].end == date("2026-09-14T10:00:00Z"))
        #expect(slots[2].end == date("2026-09-14T17:00:00Z"))
    }

    @Test("skips days that are not working days")
    func weekends() {
        let slots = Scheduling.freeSlots(
            busy: [],
            from: date("2026-09-19T00:00:00Z"),
            to: date("2026-09-20T23:00:00Z"),
            settings: weekdaySettings,
            calendar: calendar
        )
        #expect(slots.isEmpty)
    }

    @Test("never proposes a slot in the past")
    func notBefore() {
        let slots = Scheduling.freeSlots(
            busy: [],
            from: date("2026-09-14T00:00:00Z"),
            to: date("2026-09-14T23:00:00Z"),
            settings: weekdaySettings,
            notBefore: date("2026-09-14T15:00:00Z"),
            calendar: calendar
        )
        #expect(slots.count == 1)
        #expect(slots[0].start == date("2026-09-14T15:00:00Z"))
    }

    @Test("applies the buffer around busy time")
    func buffer() {
        var settings = weekdaySettings
        settings.bufferMinutes = 15

        let slots = Scheduling.freeSlots(
            busy: [.init(start: date("2026-09-14T12:00:00Z"), end: date("2026-09-14T13:00:00Z"))],
            from: date("2026-09-14T00:00:00Z"),
            to: date("2026-09-14T23:00:00Z"),
            settings: settings,
            calendar: calendar
        )

        #expect(slots.first?.end == date("2026-09-14T11:45:00Z"))
        #expect(slots.last?.start == date("2026-09-14T13:15:00Z"))
    }

    @Test("merges overlapping busy intervals")
    func merging() {
        let merged = Scheduling.mergeBusy([
            .init(start: date("2026-09-14T10:00:00Z"), end: date("2026-09-14T11:00:00Z")),
            .init(start: date("2026-09-14T10:30:00Z"), end: date("2026-09-14T12:00:00Z")),
            .init(start: date("2026-09-14T14:00:00Z"), end: date("2026-09-14T15:00:00Z")),
        ])

        #expect(merged.count == 2)
        #expect(merged[0].end == date("2026-09-14T12:00:00Z"))
    }

    @Test("detects collisions with committed time")
    func collisions() {
        let busy = [Scheduling.BusyInterval(start: date("2026-09-14T10:00:00Z"), end: date("2026-09-14T11:00:00Z"))]
        #expect(Scheduling.collides(start: date("2026-09-14T10:30:00Z"), end: date("2026-09-14T11:30:00Z"), with: busy))
        #expect(!Scheduling.collides(start: date("2026-09-14T11:00:00Z"), end: date("2026-09-14T12:00:00Z"), with: busy))
    }
}

@Suite("Recurrence")
struct RecurrenceTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    func date(_ iso: String) -> Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)!
    }

    @Test("parses a weekday rule")
    func parsing() {
        let rule = try! #require(Recurrence.parse("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR"))
        #expect(rule.frequency == .weekly)
        #expect(rule.byDay == [1, 3, 5])
    }

    @Test("rejects an unsupported rule")
    func rejects() {
        #expect(Recurrence.parse("INTERVAL=2") == nil)
    }

    @Test("advances a weekly task to the next occurrence")
    func weeklyNext() {
        let next = Recurrence.nextOccurrence(
            rule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
            anchor: date("2026-09-14T09:00:00Z"),
            after: date("2026-09-14T10:00:00Z"),
            calendar: calendar
        )
        #expect(next == date("2026-09-21T09:00:00Z"))
    }

    @Test("stops once a COUNT series is exhausted")
    func countExhausted() {
        let next = Recurrence.nextOccurrence(
            rule: "FREQ=DAILY;COUNT=1",
            anchor: date("2026-09-14T09:00:00Z"),
            after: date("2026-09-15T09:00:00Z"),
            calendar: calendar
        )
        #expect(next == nil)
    }

    @Test("describes rules in words")
    func describing() {
        #expect(Recurrence.describe("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR") == "every weekday")
        #expect(Recurrence.describe("FREQ=DAILY;INTERVAL=2") == "every 2 days")
    }
}
