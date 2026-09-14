import Foundation

/// Deterministic natural-language capture, ported from `@cortex/core`.
///
/// Two reasons this exists in Swift rather than being left to the server:
///
/// 1. It is the fallback when Apple Foundation Models is unavailable, and it
///    has to work with no network - capture is the one thing that must never
///    fail.
/// 2. It powers the live preview under the capture field, which needs to update
///    as the user types without a round trip.
///
/// The grammar is identical to the web one, so the same sentence produces the
/// same task on either platform.
public enum CaptureGrammar {
    public static func parse(_ input: String, now: Date = .now, timeZone: TimeZone = .current) -> ParsedCapture {
        var working = input
        var signals = 0

        var priority = Priority.p3
        if let matched = extractPriority(&working) {
            priority = matched
            signals += 1
        }

        var projectName: String?
        if let matched = extractProject(&working) {
            projectName = matched
            signals += 1
        }

        let tagNames = extractTags(&working)
        if !tagNames.isEmpty { signals += 1 }

        var energy: EnergyLevel?
        if let matched = extractEnergy(&working) {
            energy = matched
            signals += 1
        }

        let recurrence = extractRecurrence(&working)
        if recurrence != nil { signals += 1 }

        let duration = extractDuration(&working)
        if duration != nil { signals += 1 }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        let when = extractDateTime(&working, now: now, calendar: calendar, recurrence: recurrence)
        if when != nil { signals += 1 }

        let title = working
            .replacingOccurrences(of: "\\s{2,}", with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,;:-"))

        return ParsedCapture(
            title: title.isEmpty ? input.trimmingCharacters(in: .whitespacesAndNewlines) : title,
            dueAt: when?.date,
            dueAllDay: when?.allDay ?? false,
            estimateMinutes: duration,
            priority: priority,
            energy: energy,
            recurrenceRule: recurrence,
            projectName: projectName,
            tagNames: tagNames,
            confidence: min(1, Double(signals) / 4)
        )
    }

    // MARK: Fragments

    private static func extractPriority(_ text: inout String) -> Priority? {
        guard let range = text.range(of: #"(?:^|\s)(?:!([1-4])|[pP]([1-4]))(?=\s|$)"#, options: .regularExpression) else { return nil }
        let matched = String(text[range])
        let digit = matched.first(where: { $0.isNumber }).map(String.init) ?? "3"
        text.removeSubrange(range)
        return Priority(rawValue: "p\(digit)")
    }

    private static func extractProject(_ text: inout String) -> String? {
        guard let range = text.range(of: #"(?:^|\s)#[\p{L}\p{N}_-]{1,60}"#, options: .regularExpression) else { return nil }
        let name = String(text[range])
            .trimmingCharacters(in: .whitespaces)
            .dropFirst()
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
        text.removeSubrange(range)
        return name.trimmingCharacters(in: .whitespaces)
    }

    private static func extractTags(_ text: inout String) -> [String] {
        var tags: [String] = []
        while let range = text.range(of: #"(?:^|\s)@[\p{L}\p{N}_-]{1,60}"#, options: .regularExpression) {
            let tag = String(text[range]).trimmingCharacters(in: .whitespaces).dropFirst().lowercased()
            tags.append(String(tag))
            text.removeSubrange(range)
        }
        return tags
    }

    private static func extractEnergy(_ text: inout String) -> EnergyLevel? {
        guard let range = text.range(of: #"(?:^|\s)(low|high|medium)\s+energy(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let word = String(text[range]).lowercased()
        text.removeSubrange(range)
        if word.contains("low") { return .low }
        if word.contains("high") { return .high }
        return .medium
    }

    private static let recurrencePatterns: [(pattern: String, rule: (String) -> String?)] = [
        (#"(?:^|\s)every\s+day(?=\s|$)|(?:^|\s)daily(?=\s|$)"#, { _ in "FREQ=DAILY;INTERVAL=1" }),
        (#"(?:^|\s)every\s+weekday(?=\s|$)|(?:^|\s)weekdays(?=\s|$)"#, { _ in "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }),
        (#"(?:^|\s)every\s+other\s+day(?=\s|$)"#, { _ in "FREQ=DAILY;INTERVAL=2" }),
        (#"(?:^|\s)every\s+(\d{1,2})\s+days?(?=\s|$)"#, { match in
            let n = match.components(separatedBy: CharacterSet.decimalDigits.inverted).first(where: { !$0.isEmpty }) ?? "1"
            return "FREQ=DAILY;INTERVAL=\(n)"
        }),
        (#"(?:^|\s)every\s+(\d{1,2})\s+weeks?(?=\s|$)"#, { match in
            let n = match.components(separatedBy: CharacterSet.decimalDigits.inverted).first(where: { !$0.isEmpty }) ?? "1"
            return "FREQ=WEEKLY;INTERVAL=\(n)"
        }),
        (#"(?:^|\s)every\s+(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)(?=\s|$)"#, { match in
            guard let day = weekdayIndex(in: match) else { return nil }
            let codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
            return "FREQ=WEEKLY;INTERVAL=1;BYDAY=\(codes[day - 1])"
        }),
        (#"(?:^|\s)every\s+week(?=\s|$)|(?:^|\s)weekly(?=\s|$)"#, { _ in "FREQ=WEEKLY;INTERVAL=1" }),
        (#"(?:^|\s)every\s+month(?=\s|$)|(?:^|\s)monthly(?=\s|$)"#, { _ in "FREQ=MONTHLY;INTERVAL=1" }),
        (#"(?:^|\s)every\s+year(?=\s|$)|(?:^|\s)yearly(?=\s|$)|(?:^|\s)annually(?=\s|$)"#, { _ in "FREQ=YEARLY;INTERVAL=1" }),
    ]

    private static func extractRecurrence(_ text: inout String) -> String? {
        for (pattern, build) in recurrencePatterns {
            guard let range = text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) else { continue }
            let matched = String(text[range]).lowercased()
            guard let rule = build(matched) else { continue }
            text.removeSubrange(range)
            return rule
        }
        return nil
    }

    private static func extractDuration(_ text: inout String) -> Int? {
        guard let range = text.range(
            of: #"(?:^|\s)(?:for|takes?|about|approx\.?|~)\s*(\d{1,3})\s*(minutes|minute|mins|min|hours|hour|hrs|hr|m|h)(?=\s|$)"#,
            options: [.regularExpression, .caseInsensitive]
        ) else { return nil }

        let matched = String(text[range]).lowercased()
        let number = Int(matched.components(separatedBy: CharacterSet.decimalDigits.inverted).first(where: { !$0.isEmpty }) ?? "") ?? 0
        guard number > 0 else { return nil }

        let isHours = matched.range(of: #"\d\s*(h|hr|hrs|hour|hours)(?=\s|$)"#, options: .regularExpression) != nil
        text.removeSubrange(range)
        let minutes = isHours ? number * 60 : number
        return (minutes > 0 && minutes <= 24 * 60) ? minutes : nil
    }

    private struct Resolved {
        var date: Date
        var allDay: Bool
    }

    private static func extractDateTime(_ text: inout String, now: Date, calendar: Calendar, recurrence: String?) -> Resolved? {
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        var matchedDate = false
        var impliedHour: Int?

        if let range = text.range(of: #"(?:^|\s)today(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            text.removeSubrange(range)
            matchedDate = true
        } else if let range = text.range(of: #"(?:^|\s)tonight(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            text.removeSubrange(range)
            matchedDate = true
            impliedHour = 20
        } else if let range = text.range(of: #"(?:^|\s)(tomorrow|tmr|tmrw)(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            text.removeSubrange(range)
            components.day = (components.day ?? 1) + 1
            matchedDate = true
        } else if let range = text.range(of: #"(?:^|\s)in\s+(\d{1,3})\s+days?(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            let matched = String(text[range])
            let n = Int(matched.components(separatedBy: CharacterSet.decimalDigits.inverted).first(where: { !$0.isEmpty }) ?? "") ?? 0
            text.removeSubrange(range)
            components.day = (components.day ?? 1) + n
            matchedDate = true
        } else if let range = text.range(of: #"(?:^|\s)next\s+week(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            text.removeSubrange(range)
            components.day = (components.day ?? 1) + 7
            matchedDate = true
        } else if let range = text.range(of: #"(?:^|\s)\d{4}-\d{2}-\d{2}(?=\s|$)"#, options: .regularExpression) {
            let iso = String(text[range]).trimmingCharacters(in: .whitespaces).split(separator: "-").compactMap { Int($0) }
            text.removeSubrange(range)
            if iso.count == 3 {
                components.year = iso[0]
                components.month = iso[1]
                components.day = iso[2]
                matchedDate = true
            }
        } else if let range = text.range(
            of: #"(?:^|\s)(?:(next|this|on|by)\s+)?(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)(?=\s|$)"#,
            options: [.regularExpression, .caseInsensitive]
        ) {
            let matched = String(text[range]).lowercased()
            if let target = weekdayIndex(in: matched) {
                text.removeSubrange(range)
                let currentIso = isoWeekday(of: now, calendar: calendar)
                var delta = (target - currentIso + 7) % 7
                if delta == 0 { delta = 7 }
                if matched.contains("next"), delta < 7 { delta += 7 }
                components.day = (components.day ?? 1) + delta
                matchedDate = true
            }
        }

        let time = extractTime(&text)
        // A bare recurrence anchors on its first matching weekday.
        if !matchedDate, let recurrence, let byDay = recurrence.range(of: #"BYDAY=([A-Z]{2})"#, options: .regularExpression) {
            let code = String(recurrence[byDay]).replacingOccurrences(of: "BYDAY=", with: "").prefix(2)
            let codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
            if let target = codes.firstIndex(of: String(code)).map({ $0 + 1 }) {
                let currentIso = isoWeekday(of: now, calendar: calendar)
                var delta = (target - currentIso + 7) % 7
                if delta == 0 { delta = 7 }
                components.day = (components.day ?? 1) + delta
                matchedDate = true
            }
        }

        guard matchedDate || time != nil else { return nil }

        components.hour = time?.hour ?? impliedHour ?? 9
        components.minute = time?.minute ?? 0
        components.second = 0

        guard var resolved = calendar.date(from: components) else { return nil }

        // "at 7am" with no date, already past today, means tomorrow.
        if !matchedDate, time != nil, resolved <= now {
            resolved = calendar.date(byAdding: .day, value: 1, to: resolved) ?? resolved
        }

        return Resolved(date: resolved, allDay: time == nil && impliedHour == nil)
    }

    private static func extractTime(_ text: inout String) -> (hour: Int, minute: Int)? {
        if let range = text.range(of: #"(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            let matched = String(text[range]).lowercased()
            let numbers = matched.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }
            var hour = Int(numbers.first ?? "0") ?? 0
            let minute = numbers.count > 1 ? (Int(numbers[1]) ?? 0) : 0
            if matched.contains("pm"), hour < 12 { hour += 12 }
            if matched.contains("am"), hour == 12 { hour = 0 }
            text.removeSubrange(range)
            return hour <= 23 && minute <= 59 ? (hour, minute) : nil
        }

        if let range = text.range(of: #"(?:^|\s)(?:at\s+)?(\d{1,2}):(\d{2})(?=\s|$)"#, options: .regularExpression) {
            let numbers = String(text[range]).components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }
            guard numbers.count >= 2, let hour = Int(numbers[0]), let minute = Int(numbers[1]), hour <= 23, minute <= 59 else { return nil }
            text.removeSubrange(range)
            return (hour, minute)
        }

        if let range = text.range(of: #"(?:^|\s)(noon|midday|midnight)(?=\s|$)"#, options: [.regularExpression, .caseInsensitive]) {
            let matched = String(text[range]).lowercased()
            text.removeSubrange(range)
            return matched.contains("midnight") ? (0, 0) : (12, 0)
        }

        return nil
    }

    // MARK: Helpers

    private static func weekdayIndex(in text: String) -> Int? {
        let names: [(String, Int)] = [
            ("monday", 1), ("mon", 1), ("tuesday", 2), ("tue", 2), ("wednesday", 3), ("wed", 3),
            ("thursday", 4), ("thu", 4), ("friday", 5), ("fri", 5), ("saturday", 6), ("sat", 6),
            ("sunday", 7), ("sun", 7),
        ]
        let lowered = text.lowercased()
        return names.first { lowered.contains($0.0) }?.1
    }

    /// Monday = 1 ... Sunday = 7, regardless of the calendar's first weekday.
    static func isoWeekday(of date: Date, calendar: Calendar) -> Int {
        let weekday = calendar.component(.weekday, from: date)
        return weekday == 1 ? 7 : weekday - 1
    }
}
