import Foundation

/// The no-model implementation.
///
/// This is what runs when Apple Foundation Models is unavailable - an older
/// device, Apple Intelligence switched off, or the model still downloading. It
/// is deterministic, instant and offline, and it mirrors the TypeScript
/// fallbacks in `@cortex/core` so the same input produces the same task whether
/// it was typed on the phone or in the browser.
///
/// It is careful about what it claims: `summarize` returns *extracted sentences*
/// and reports `engine == .heuristic`, and `supportedStyles` omits the styles it
/// cannot honestly produce (there is no extractive ELI5), so the UI can say
/// "open this on a device with Apple Intelligence" rather than showing something
/// that reads like a bad summary.
public struct HeuristicIntelligence: Intelligence {
    private let reasonUnavailable: IntelligenceAvailability

    public init(reason: IntelligenceAvailability = .unknown) {
        self.reasonUnavailable = reason
    }

    public var availability: IntelligenceAvailability { get async { reasonUnavailable } }

    public func supportedStyles(for item: InfoItem) async -> [SummaryStyle] {
        var styles: [SummaryStyle] = [.tldr, .keyPoints, .implications, .actions]
        if item.isScholarly { styles.append(.methodology) }
        // .eli5 is deliberately absent: rewriting for a lay reader is not
        // something sentence extraction can do.
        return styles
    }

    // MARK: Capture

    public func parseCapture(_ text: String, now: Date, timeZone: TimeZone) async throws -> IntelligenceResult<ParsedCapture> {
        IntelligenceResult(value: CaptureGrammar.parse(text, now: now, timeZone: timeZone), engine: .heuristic)
    }

    // MARK: Summaries

    public func summarize(_ item: InfoItem, style: SummaryStyle) async throws -> IntelligenceResult<String> {
        let text = item.readableText
        guard !text.isEmpty else { return IntelligenceResult(value: "", engine: .heuristic) }

        let extracted: String
        switch style {
        case .tldr:
            extracted = Extractive.summary(of: text, sentences: 2)
        case .keyPoints:
            extracted = Extractive.bullets(of: text, sentences: 5)
        case .methodology:
            let method = Extractive.sentences(in: text).filter {
                $0.range(of: "(method|approach|we (use|used|propose|train|evaluate)|dataset|experiment|protocol|cohort|sample size)", options: [.regularExpression, .caseInsensitive]) != nil
            }
            extracted = method.isEmpty ? Extractive.summary(of: text, sentences: 3) : method.prefix(4).map { "- \($0)" }.joined(separator: "\n")
        case .implications, .actions:
            let actionable = Extractive.sentences(in: text).filter {
                $0.range(of: "(should|implies|suggests|enables|requires|recommend|impact|means that)", options: [.regularExpression, .caseInsensitive]) != nil
            }
            extracted = actionable.isEmpty ? Extractive.summary(of: text, sentences: 3) : actionable.prefix(4).map { "- \($0)" }.joined(separator: "\n")
        case .eli5:
            // Refuse rather than produce something misleading.
            throw IntelligenceError.unavailable(reasonUnavailable)
        }

        return IntelligenceResult(value: extracted, engine: .heuristic)
    }

    // MARK: Task breakdown

    public func breakDown(task: CortexTask, context: WorkContext) async throws -> IntelligenceResult<[SubtaskSuggestion]> {
        // Without a model there is nothing intelligent to say about *this*
        // task, so the fallback offers a neutral structure rather than
        // pretending to understand the work.
        let total = task.estimateMinutes ?? 90
        let chunk = max(context.scheduling.minBlockMinutes, total / 3)
        let suggestions = [
            SubtaskSuggestion(title: "Outline \(task.title)", estimateMinutes: min(chunk, 30), rationale: "A standard first step - no on-device model was available to break this down properly."),
            SubtaskSuggestion(title: "Draft \(task.title)", estimateMinutes: chunk, rationale: nil),
            SubtaskSuggestion(title: "Review and finish \(task.title)", estimateMinutes: min(chunk, 45), rationale: nil),
        ]
        return IntelligenceResult(value: suggestions, engine: .heuristic)
    }

    // MARK: Prioritisation

    public func prioritize(context: WorkContext, limit: Int) async throws -> IntelligenceResult<[PrioritizedTask]> {
        // The server already computed a deterministic score and its reasons, so
        // the fallback reuses that rather than inventing a second ordering.
        let ranked = context.tasks
            .sorted { $0.heuristicScore > $1.heuristicScore }
            .prefix(limit)
            .map { task in
                PrioritizedTask(
                    taskId: task.id,
                    score: task.heuristicScore,
                    reason: task.heuristicReasons.isEmpty ? "Ordered by priority and due date" : task.heuristicReasons.joined(separator: ", "),
                    suggestedNextAction: nil
                )
            }
        return IntelligenceResult(value: Array(ranked), engine: .heuristic)
    }

    // MARK: Ranking

    public func rank(items: [InfoItem], context: WorkContext) async throws -> IntelligenceResult<[RankedItem]> {
        let ranked = items.compactMap { item -> RankedItem? in
            let haystack = item.readableText.lowercased()
            var best: (topic: Topic, hits: [String])? = nil

            for topic in context.topics {
                let terms = ([topic.label] + topic.keywords).map { $0.lowercased() }
                let hits = terms.filter { haystack.contains($0) }
                if !hits.isEmpty, hits.count > (best?.hits.count ?? 0) {
                    best = (topic, hits)
                }
            }
            guard let best else { return nil }

            let ageDays = max(0, Date.now.timeIntervalSince(item.publishedAt ?? item.fetchedAt) / 86_400)
            let recency = pow(0.5, ageDays / 5)
            let keyword = min(1, Double(best.hits.count) / 3)
            let score = min(1, keyword * 0.6 + recency * 0.3 + min(1, best.topic.weight / 1.5) * 0.1)

            return RankedItem(
                itemId: item.id,
                topicId: best.topic.id,
                score: score,
                reason: "Matches \"\(best.topic.label)\" on \(best.hits.prefix(3).joined(separator: ", "))"
            )
        }
        .sorted { $0.score > $1.score }

        return IntelligenceResult(value: ranked, engine: .heuristic)
    }

    // MARK: Scheduling

    public func proposeBlocks(tasks: [WorkContext.ContextTask], slots: [FreeSlot], settings: SchedulingSettings) async throws -> IntelligenceResult<[ProposedBlock]> {
        var remaining = slots.sorted { $0.start < $1.start }
        var proposals: [ProposedBlock] = []

        for task in tasks.sorted(by: { $0.heuristicScore > $1.heuristicScore }) {
            let wanted = min(max(task.estimateMinutes ?? settings.minBlockMinutes, settings.minBlockMinutes), settings.maxBlockMinutes)
            guard let index = remaining.firstIndex(where: { $0.minutes >= wanted }) else { continue }

            let slot = remaining[index]
            let end = slot.start.addingTimeInterval(Double(wanted) * 60)
            proposals.append(
                ProposedBlock(
                    taskId: task.id,
                    startAt: slot.start,
                    endAt: end,
                    rationale: "Placed \(wanted) min for \"\(task.title)\" in the first free window that fits. Ordered by \(task.heuristicReasons.prefix(2).joined(separator: ", "))."
                )
            )

            let nextStart = end.addingTimeInterval(Double(settings.bufferMinutes) * 60)
            if nextStart.addingTimeInterval(Double(settings.minBlockMinutes) * 60) <= slot.end {
                remaining[index] = FreeSlot(start: nextStart, end: slot.end)
            } else {
                remaining.remove(at: index)
            }
        }

        return IntelligenceResult(value: proposals, engine: .heuristic)
    }

    // MARK: Writing

    public func rewrite(_ text: String, as task: WritingTask) async throws -> IntelligenceResult<String> {
        switch task {
        case .keyParameters:
            // Numbers with units are extractable without a model; prose is not.
            let pattern = #"[-+]?\d[\d,.]*\s*(%|kWh|kW|mAh|mV|V|A|mA|nm|µm|um|mm|cm|m|km|kg|mg|g|K|°C|C|Hz|kHz|MHz|GHz|GB|MB|TB|h|hours|min|minutes|s|ms|x|×)"#
            let matches = text.ranges(matching: pattern).map { String(text[$0]) }
            let unique = Array(NSOrderedSet(array: matches)).compactMap { $0 as? String }
            return IntelligenceResult(value: unique.map { "- \($0)" }.joined(separator: "\n"), engine: .heuristic)
        case .rewriteConcise:
            return IntelligenceResult(value: Extractive.summary(of: text, sentences: 2), engine: .heuristic)
        case .taskDescription, .shortNote:
            // Genuinely generative - refuse rather than return the input back
            // to the user dressed up as a result.
            throw IntelligenceError.unavailable(reasonUnavailable)
        }
    }
}

// MARK: - Extractive helpers

enum Extractive {
    static func sentences(in text: String) -> [String] {
        text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .components(separatedBy: CharacterSet(charactersIn: ".!?"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count > 20 }
    }

    /// Frequency-weighted sentence selection, keeping the original order.
    static func summary(of text: String, sentences count: Int, maxCharacters: Int = 800) -> String {
        let all = sentences(in: text)
        guard all.count > count else { return all.joined(separator: ". ") }

        var frequency: [String: Int] = [:]
        for word in tokens(in: text) { frequency[word, default: 0] += 1 }

        let scored = all.enumerated().map { index, sentence -> (index: Int, sentence: String, score: Double) in
            let words = tokens(in: sentence)
            guard !words.isEmpty else { return (index, sentence, 0) }
            let total = words.reduce(0) { $0 + (frequency[$1] ?? 0) }
            var score = Double(total) / Double(words.count).squareRoot()
            if index == 0 { score *= 1.3 } else if index < 3 { score *= 1.1 }
            return (index, sentence, score)
        }

        let picked = scored
            .sorted { $0.score > $1.score }
            .prefix(count)
            .sorted { $0.index < $1.index }
            .map(\.sentence)

        return String(picked.joined(separator: ". ").prefix(maxCharacters))
    }

    static func bullets(of text: String, sentences count: Int) -> String {
        let summary = self.summary(of: text, sentences: count, maxCharacters: 1200)
        return sentences(in: summary).map { "- \($0)" }.joined(separator: "\n")
    }

    private static let stopwords: Set<String> = [
        "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have",
        "but", "not", "you", "our", "using", "used", "based", "new", "can", "may", "which",
        "these", "than", "their", "into", "also", "more", "most", "such", "when", "what", "how",
    ]

    static func tokens(in text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 2 && !stopwords.contains($0) }
    }
}

extension String {
    func ranges(matching pattern: String) -> [Range<String.Index>] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let nsRange = NSRange(startIndex..<endIndex, in: self)
        return regex.matches(in: self, range: nsRange).compactMap { Range($0.range, in: self) }
    }
}
