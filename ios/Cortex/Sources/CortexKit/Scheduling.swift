import Foundation

/// Free-slot detection, ported from `@cortex/core`.
///
/// The model never reasons about raw calendar overlap: this computes the
/// windows the user is actually free, and Foundation Models only chooses which
/// work goes in which window. That split is deliberate - arithmetic is
/// something code should get exactly right, and judgement is what the model is
/// for.
public enum Scheduling {
    public struct BusyInterval: Sendable, Hashable {
        public var start: Date
        public var end: Date

        public init(start: Date, end: Date) {
            self.start = start
            self.end = end
        }
    }

    /// Merge overlapping intervals after padding each with a buffer.
    public static func mergeBusy(_ intervals: [BusyInterval], bufferMinutes: Int = 0) -> [BusyInterval] {
        let buffer = Double(bufferMinutes) * 60
        let padded = intervals
            .filter { $0.end > $0.start }
            .map { BusyInterval(start: $0.start.addingTimeInterval(-buffer), end: $0.end.addingTimeInterval(buffer)) }
            .sorted { $0.start < $1.start }

        var merged: [BusyInterval] = []
        for interval in padded {
            if var last = merged.last, interval.start <= last.end {
                if interval.end > last.end {
                    last.end = interval.end
                    merged[merged.count - 1] = last
                }
            } else {
                merged.append(interval)
            }
        }
        return merged
    }

    /// Every window inside working hours, clipped to `[from, to]`.
    public static func workingWindows(
        from: Date,
        to: Date,
        workingHours: [WorkingHours],
        calendar: Calendar = .current
    ) -> [FreeSlot] {
        var windows: [FreeSlot] = []
        let byWeekday = Dictionary(uniqueKeysWithValues: workingHours.map { ($0.weekday, $0) })

        var cursor = calendar.startOfDay(for: from)
        var guardCounter = 0

        while cursor <= to, guardCounter < 400 {
            guardCounter += 1
            defer { cursor = calendar.date(byAdding: .day, value: 1, to: cursor) ?? to.addingTimeInterval(1) }

            let iso = CaptureGrammar.isoWeekday(of: cursor, calendar: calendar)
            guard let hours = byWeekday[iso], hours.enabled, hours.endMinute > hours.startMinute else { continue }

            let dayStart = cursor.addingTimeInterval(Double(hours.startMinute) * 60)
            let dayEnd = cursor.addingTimeInterval(Double(hours.endMinute) * 60)
            let start = max(dayStart, from)
            let end = min(dayEnd, to)
            if end > start { windows.append(FreeSlot(start: start, end: end)) }
        }

        return windows
    }

    /// Subtract busy time from the working windows.
    public static func freeSlots(
        busy: [BusyInterval],
        from: Date,
        to: Date,
        settings: SchedulingSettings,
        notBefore: Date? = nil,
        calendar: Calendar = .current
    ) -> [FreeSlot] {
        let blocked = mergeBusy(busy, bufferMinutes: settings.bufferMinutes)
        var slots: [FreeSlot] = []

        for window in workingWindows(from: from, to: to, workingHours: settings.workingHours, calendar: calendar) {
            var cursor = max(window.start, notBefore ?? window.start)

            for interval in blocked {
                if interval.end <= cursor { continue }
                if interval.start >= window.end { break }
                if interval.start > cursor {
                    append(&slots, start: cursor, end: min(interval.start, window.end), minimum: settings.minBlockMinutes)
                }
                if interval.end > cursor { cursor = interval.end }
                if cursor >= window.end { break }
            }

            if cursor < window.end {
                append(&slots, start: cursor, end: window.end, minimum: settings.minBlockMinutes)
            }
        }

        return slots
    }

    private static func append(_ slots: inout [FreeSlot], start: Date, end: Date, minimum: Int) {
        let slot = FreeSlot(start: start, end: end)
        if slot.minutes >= minimum { slots.append(slot) }
    }

    public static func totalMinutes(_ slots: [FreeSlot]) -> Int {
        slots.reduce(0) { $0 + $1.minutes }
    }

    /// Does a proposed block collide with anything already committed?
    public static func collides(start: Date, end: Date, with busy: [BusyInterval]) -> Bool {
        busy.contains { $0.start < end && $0.end > start }
    }
}

/// The RFC 5545 subset Cortex understands, ported so the phone can roll a
/// recurring task forward while offline.
public enum Recurrence {
    public struct Rule: Sendable, Equatable {
        public enum Frequency: String, Sendable { case daily = "DAILY", weekly = "WEEKLY", monthly = "MONTHLY", yearly = "YEARLY" }

        public var frequency: Frequency
        public var interval: Int
        /// ISO weekdays, Monday = 1.
        public var byDay: [Int]
        public var count: Int?
        public var until: Date?
    }

    private static let dayCodes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

    public static func parse(_ text: String) -> Rule? {
        let body = text.hasPrefix("RRULE:") ? String(text.dropFirst(6)) : text
        var frequency: Rule.Frequency?
        var interval = 1
        var byDay: [Int] = []
        var count: Int?
        var until: Date?

        for part in body.split(separator: ";") {
            let pair = part.split(separator: "=", maxSplits: 1)
            guard pair.count == 2 else { continue }
            let key = pair[0].uppercased()
            let value = String(pair[1])

            switch key {
            case "FREQ": frequency = Rule.Frequency(rawValue: value.uppercased())
            case "INTERVAL": interval = max(1, Int(value) ?? 1)
            case "BYDAY":
                byDay = value.uppercased().split(separator: ",").compactMap { code in
                    dayCodes.firstIndex(of: String(code)).map { $0 + 1 }
                }
            case "COUNT": count = Int(value)
            case "UNTIL":
                let formatter = DateFormatter()
                formatter.dateFormat = value.contains("T") ? "yyyyMMdd'T'HHmmss'Z'" : "yyyyMMdd"
                formatter.timeZone = TimeZone(identifier: "UTC")
                formatter.locale = Locale(identifier: "en_US_POSIX")
                until = formatter.date(from: value)
            default: break
            }
        }

        guard let frequency else { return nil }
        return Rule(frequency: frequency, interval: interval, byDay: byDay.sorted(), count: count, until: until)
    }

    /// The next occurrence strictly after `after`, or nil when the series ended.
    public static func nextOccurrence(rule text: String, anchor: Date, after: Date, calendar: Calendar = .current) -> Date? {
        guard let rule = parse(text) else { return nil }

        let time = calendar.dateComponents([.hour, .minute], from: anchor)
        var cursor = anchor
        var emitted = 0
        var guardCounter = 0

        while guardCounter < 800 {
            guardCounter += 1

            let candidate: Date?
            switch rule.frequency {
            case .daily:
                candidate = calendar.date(byAdding: .day, value: emitted == 0 ? 0 : rule.interval, to: cursor)
            case .weekly:
                if rule.byDay.isEmpty {
                    candidate = calendar.date(byAdding: .day, value: emitted == 0 ? 0 : 7 * rule.interval, to: cursor)
                } else {
                    candidate = nextWeeklyOccurrence(after: cursor, rule: rule, calendar: calendar, isFirst: emitted == 0)
                }
            case .monthly:
                candidate = calendar.date(byAdding: .month, value: emitted == 0 ? 0 : rule.interval, to: cursor)
            case .yearly:
                candidate = calendar.date(byAdding: .year, value: emitted == 0 ? 0 : rule.interval, to: cursor)
            }

            guard var next = candidate else { return nil }
            next = calendar.date(bySettingHour: time.hour ?? 9, minute: time.minute ?? 0, second: 0, of: next) ?? next

            emitted += 1
            if let count = rule.count, emitted > count { return nil }
            if let until = rule.until, next > until { return nil }

            if next > after { return next }
            cursor = next
        }
        return nil
    }

    private static func nextWeeklyOccurrence(after date: Date, rule: Rule, calendar: Calendar, isFirst: Bool) -> Date? {
        let currentIso = CaptureGrammar.isoWeekday(of: date, calendar: calendar)
        let sorted = rule.byDay.sorted()

        if let nextInWeek = sorted.first(where: { $0 > currentIso }) {
            return calendar.date(byAdding: .day, value: nextInWeek - currentIso, to: date)
        }
        guard let first = sorted.first else { return nil }
        let daysToNextWeek = (7 - currentIso) + first + 7 * (rule.interval - 1)
        return calendar.date(byAdding: .day, value: daysToNextWeek, to: date)
    }

    /// Human phrasing for the UI and for Obsidian task lines.
    public static func describe(_ text: String) -> String {
        guard let rule = parse(text) else { return text }
        let names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

        if rule.frequency == .weekly, !rule.byDay.isEmpty {
            if rule.byDay == [1, 2, 3, 4, 5], rule.interval == 1 { return "every weekday" }
            let dayList = rule.byDay.compactMap { names[safe: $0 - 1] }.joined(separator: ", ")
            return rule.interval == 1 ? "every week on \(dayList)" : "every \(rule.interval) weeks on \(dayList)"
        }

        let unit = ["DAILY": "day", "WEEKLY": "week", "MONTHLY": "month", "YEARLY": "year"][rule.frequency.rawValue] ?? "period"
        return rule.interval == 1 ? "every \(unit)" : "every \(rule.interval) \(unit)s"
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
