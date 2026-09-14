import Foundation

/// Renders and parses the Markdown Cortex writes into an Obsidian vault.
///
/// Byte-compatible with the TypeScript renderer in `@cortex/core`, because a
/// note may be written by the phone and read back by the web export (or the
/// other way round) and a difference in either direction would show up as a
/// spurious conflict during sync.
///
/// Task lines follow the Obsidian Tasks plugin syntax so a user's existing
/// queries pick Cortex tasks up with no configuration.
public enum MarkdownNote {
    public static let schemaVersion = 1

    // MARK: Frontmatter

    public enum Value: Sendable {
        case string(String)
        case number(Double)
        case bool(Bool)
        case list([String])
        case null
    }

    /// Quote only when a bare scalar would change meaning in YAML.
    static func serialize(_ value: Value) -> String {
        switch value {
        case .null: "null"
        case .bool(let flag): flag ? "true" : "false"
        case .number(let number): number == number.rounded() ? String(Int(number)) : String(number)
        case .list(let items): items.isEmpty ? "[]" : "\n" + items.map { "  - \(quote($0))" }.joined(separator: "\n")
        case .string(let text): quote(text)
        }
    }

    static func quote(_ value: String) -> String {
        if value.isEmpty { return "\"\"" }
        let needsQuotes =
            value.hasPrefix(" ") || value.hasSuffix(" ") ||
            value.range(of: #"^[-?:,\[\]{}#&*!|>'"%@`]"#, options: .regularExpression) != nil ||
            value.contains(": ") || value.contains(" #") ||
            ["true", "false", "null", "yes", "no", "on", "off", "~"].contains(value.lowercased()) ||
            value.range(of: #"^-?\d+(\.\d+)?$"#, options: .regularExpression) != nil ||
            value.contains("\n")
        guard needsQuotes else { return value }
        let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\n", with: "\\n")
        return "\"\(escaped)\""
    }

    public static func frontmatter(_ pairs: [(String, Value)]) -> String {
        let lines = pairs.map { "\($0.0): \(serialize($0.1))" }
        return "---\n\(lines.joined(separator: "\n"))\n---"
    }

    /// Parse the frontmatter block into raw strings. Enough to read Cortex's
    /// own fields back; not a general YAML parser.
    public static func parseFrontmatter(_ source: String) -> (fields: [String: String], lists: [String: [String]], body: String) {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.hasPrefix("---\n"),
              let closing = normalized.range(of: "\n---", range: normalized.index(normalized.startIndex, offsetBy: 4)..<normalized.endIndex)
        else {
            return ([:], [:], normalized.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        let header = String(normalized[normalized.index(normalized.startIndex, offsetBy: 4)..<closing.lowerBound])
        let body = String(normalized[closing.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)

        var fields: [String: String] = [:]
        var lists: [String: [String]] = [:]
        var currentKey: String?

        for line in header.split(separator: "\n", omittingEmptySubsequences: false) {
            let text = String(line)
            if let match = text.range(of: #"^\s+-\s+"#, options: .regularExpression), let key = currentKey {
                lists[key, default: []].append(unquote(String(text[match.upperBound...])))
                continue
            }
            guard let colon = text.firstIndex(of: ":") else { continue }
            let key = String(text[..<colon]).trimmingCharacters(in: .whitespaces)
            let value = String(text[text.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            currentKey = key
            if value.isEmpty { lists[key] = [] } else { fields[key] = unquote(value) }
        }

        return (fields, lists, body)
    }

    static func unquote(_ value: String) -> String {
        guard value.count >= 2, value.hasPrefix("\""), value.hasSuffix("\"") else { return value }
        return String(value.dropFirst().dropLast())
            .replacingOccurrences(of: "\\\"", with: "\"")
            .replacingOccurrences(of: "\\n", with: "\n")
            .replacingOccurrences(of: "\\\\", with: "\\")
    }

    // MARK: Task notes

    static let priorityEmoji: [Priority: String] = [.p1: "⏫", .p2: "🔼", .p3: "", .p4: "🔽"]

    /// One line of Obsidian Tasks syntax.
    public static func taskLine(_ task: CortexTask, tags: [String] = []) -> String {
        var parts: [String] = []
        let box = switch task.status {
        case .done: "[x]"
        case .cancelled: "[-]"
        case .inProgress: "[/]"
        case .todo: "[ ]"
        }
        parts.append("- \(box) \(task.title)")

        if let emoji = priorityEmoji[task.priority], !emoji.isEmpty { parts.append(emoji) }
        for tag in tags { parts.append("#\(slug(tag))") }
        if let rule = task.recurrenceRule { parts.append("🔁 \(Recurrence.describe(rule))") }
        if let start = task.startAt { parts.append("🛫 \(dayKey(start))") }
        if let due = task.dueAt { parts.append("📅 \(dayKey(due))") }
        if let completed = task.completedAt { parts.append("✅ \(dayKey(completed))") }

        return parts.joined(separator: " ")
    }

    public static func taskNote(_ task: CortexTask, projectName: String? = nil, tags: [String] = [], subtasks: [CortexTask] = []) -> String {
        let header = frontmatter([
            ("cortex_type", .string("task")),
            ("cortex_id", .string(task.id)),
            ("cortex_schema", .number(Double(schemaVersion))),
            ("title", .string(task.title)),
            ("status", .string(task.status.rawValue)),
            ("priority", .string(task.priority.rawValue)),
            ("project", projectName.map { Value.string($0) } ?? .null),
            ("tags", .list(tags.map(slug))),
            ("due", task.dueAt.map { Value.string(task.dueAllDay ? dayKey($0) : iso($0)) } ?? .null),
            ("start", task.startAt.map { Value.string(iso($0)) } ?? .null),
            ("estimate_minutes", task.estimateMinutes.map { Value.number(Double($0)) } ?? .null),
            ("energy", task.energy.map { Value.string($0.rawValue) } ?? .null),
            ("recurrence", task.recurrenceRule.map { Value.string($0) } ?? .null),
            ("completed", task.completedAt.map { Value.string(iso($0)) } ?? .null),
            ("origin", .string(task.origin.rawValue)),
            ("updated", .string(iso(task.updatedAt))),
        ])

        var lines = ["# \(task.title)", "", taskLine(task, tags: tags)]
        if let notes = task.notes, !notes.isEmpty { lines += ["", notes] }
        if !subtasks.isEmpty {
            lines += ["", "## Subtasks", ""]
            lines += subtasks.map { taskLine($0) }
        }
        lines += ["", "---", "", "*Synced from Cortex. Edit freely - changes flow back on the next sync.*"]

        return "\(header)\n\n\(lines.joined(separator: "\n"))\n"
    }

    // MARK: Research notes

    public static func itemNote(_ item: InfoItem, summaries: [ItemSummary] = [], topicLabels: [String] = [], relevance: Double? = nil, userNotes: String? = nil) -> String {
        let header = frontmatter([
            ("cortex_type", .string("item")),
            ("cortex_id", .string(item.id)),
            ("cortex_schema", .number(Double(schemaVersion))),
            ("title", .string(item.title)),
            ("kind", .string(item.kind)),
            ("authors", .list(item.authors)),
            ("url", .string(item.canonicalUrl ?? item.url)),
            ("doi", item.doi.map { Value.string($0) } ?? .null),
            ("arxiv", item.arxivId.map { Value.string($0) } ?? .null),
            ("venue", item.venue.map { Value.string($0) } ?? .null),
            ("published", item.publishedAt.map { Value.string(iso($0)) } ?? .null),
            ("captured", .string(iso(item.fetchedAt))),
            ("topics", .list(topicLabels)),
            ("tags", .list(["cortex/research"])),
            ("relevance", relevance.map { Value.number(($0 * 100).rounded() / 100) } ?? .null),
            ("ai_engine", .string(summaries.first?.engine.rawValue ?? "none")),
        ])

        var lines = ["# \(item.title)", ""]
        if !item.authors.isEmpty { lines += ["**Authors:** \(item.authors.joined(separator: ", "))", ""] }
        lines.append("**Source:** [\(host(of: item.canonicalUrl ?? item.url))](\(item.canonicalUrl ?? item.url))")
        if let doi = item.doi { lines.append("**DOI:** [\(doi)](https://doi.org/\(doi))") }

        for summary in summaries {
            lines += ["", "## \(summary.style.label)", "", summary.text.trimmingCharacters(in: .whitespacesAndNewlines)]
        }
        if let engine = summaries.first?.engine {
            lines += [
                "",
                engine == .afm
                    ? "*Summaries generated on this device with Apple Foundation Models. Nothing was sent to a server.*"
                    : "*Sentences extracted from the original text - no on-device model was available to write a summary.*",
            ]
        }
        if let abstract = item.summaryRaw, !abstract.isEmpty {
            lines += ["", "## Original abstract", "", abstract]
        }
        lines += ["", "## My notes", "", userNotes ?? ""]

        return "\(header)\n\n\(lines.joined(separator: "\n"))\n"
    }

    // MARK: Daily notes

    public static let dailySectionStart = "<!-- cortex:start -->"
    public static let dailySectionEnd = "<!-- cortex:end -->"

    public static func dailySection(day: Date, tasks: [CortexTask], events: [CalendarEvent], digestHeadline: String? = nil) -> String {
        var lines = [dailySectionStart, "", "## Cortex", ""]

        if !events.isEmpty {
            lines += ["### Schedule", ""]
            for event in events.sorted(by: { $0.startAt < $1.startAt }) {
                let window = event.allDay ? "all day" : "\(clock(event.startAt))-\(clock(event.endAt))"
                lines.append("- \(window) \(event.title)")
            }
            lines.append("")
        }

        lines += ["### Tasks", ""]
        if tasks.isEmpty { lines.append("- _No tasks due._") }
        lines += tasks.map { taskLine($0) }

        if let digestHeadline {
            lines += ["", "### Research", "", "- \(digestHeadline)"]
        }

        lines += ["", dailySectionEnd]
        return lines.joined(separator: "\n")
    }

    /// Replace only the block Cortex owns, leaving the user's own journal alone.
    public static func upsertDailySection(in existing: String, section: String) -> String {
        guard let start = existing.range(of: dailySectionStart),
              let end = existing.range(of: dailySectionEnd),
              start.lowerBound < end.lowerBound
        else {
            return existing.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n" + section + "\n"
        }
        return existing.replacingCharacters(in: start.lowerBound..<end.upperBound, with: section)
    }

    // MARK: Reading a note back

    public struct ParsedTaskLine: Sendable, Equatable {
        public var title: String
        public var status: TaskStatus
        public var priority: Priority
        public var due: String?
        public var completed: String?
        public var tags: [String]
    }

    public static func parseTaskLine(_ line: String) -> ParsedTaskLine? {
        guard let match = line.range(of: #"^\s*-\s*\[( |x|X|-|/)\]\s*"#, options: .regularExpression) else { return nil }
        let marker = line[match].last(where: { "xX-/ ".contains($0) }) ?? " "
        var rest = String(line[match.upperBound...])

        let status: TaskStatus = switch marker {
        case "x", "X": .done
        case "-": .cancelled
        case "/": .inProgress
        default: .todo
        }

        let priority: Priority = rest.contains("⏫") ? .p1 : rest.contains("🔼") ? .p2 : rest.contains("🔽") ? .p4 : .p3
        let due = firstMatch(in: rest, pattern: #"📅\s*(\d{4}-\d{2}-\d{2})"#)
        let completed = firstMatch(in: rest, pattern: #"✅\s*(\d{4}-\d{2}-\d{2})"#)
        let tags = allMatches(in: rest, pattern: #"(?:^|\s)#([\w/-]+)"#).map { $0.replacingOccurrences(of: "#", with: "").trimmingCharacters(in: .whitespaces) }

        for pattern in [#"[📅🛫✅⏳➕]\s*\d{4}-\d{2}-\d{2}"#, #"🔁\s*[^📅🛫✅#⏫🔼🔽]+"#, #"(?:^|\s)#[\w/-]+"#, #"[⏫🔼🔽]"#] {
            rest = rest.replacingOccurrences(of: pattern, with: " ", options: .regularExpression)
        }

        return ParsedTaskLine(
            title: rest.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces),
            status: status,
            priority: priority,
            due: due,
            completed: completed,
            tags: tags
        )
    }

    // MARK: Helpers

    public static func slug(_ input: String, maxLength: Int = 60) -> String {
        let folded = input.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var slug = ""
        var lastWasDash = false
        for character in folded {
            if character.isLetter || character.isNumber {
                slug.append(Character(character.lowercased()))
                lastWasDash = false
            } else if !lastWasDash, !slug.isEmpty {
                slug.append("-")
                lastWasDash = true
            }
        }
        while slug.hasSuffix("-") { slug.removeLast() }
        if slug.count > maxLength { slug = String(slug.prefix(maxLength)) }
        while slug.hasSuffix("-") { slug.removeLast() }
        return slug.isEmpty ? "untitled" : slug
    }

    public static func dayKey(_ date: Date) -> String {
        DateFormatter.isoDay.string(from: date)
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.string(from: date)
    }

    static func host(of url: String) -> String {
        URL(string: url)?.host()?.replacingOccurrences(of: "www.", with: "") ?? url
    }

    static func firstMatch(in text: String, pattern: String) -> String? {
        guard let range = text.range(of: pattern, options: .regularExpression) else { return nil }
        let matched = String(text[range])
        return matched.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression).map { String(matched[$0]) }
    }

    static func allMatches(in text: String, pattern: String) -> [String] {
        text.ranges(matching: pattern).map { String(text[$0]).trimmingCharacters(in: .whitespaces) }
    }
}
