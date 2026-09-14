import SwiftUI
import CortexKit

/// The monitored feed, re-ranked on device.
struct FeedView: View {
    @Environment(AppSession.self) private var session
    @State private var ranked: [RankedItem] = []
    @State private var engine: AIEngine = .none
    @State private var isRanking = false

    private var items: [InfoItem] { session.sync?.feed ?? [] }

    private var ordered: [InfoItem] {
        guard !ranked.isEmpty else { return items }
        let scores = Dictionary(uniqueKeysWithValues: ranked.map { ($0.itemId, $0.score) })
        return items.sorted { (scores[$0.id] ?? 0) > (scores[$1.id] ?? 0) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let availability = session.intelligence?.availability, !availability.isAvailable {
                    Section {
                        Label(availability.explanation, systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                ForEach(ordered) { item in
                    NavigationLink {
                        ItemDetailView(item: item, reason: reason(for: item))
                    } label: {
                        FeedRowView(item: item, score: score(for: item), reason: reason(for: item), engine: engine)
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            Task { await session.sync?.setItemState("saved", for: item.id) }
                        } label: {
                            Label("Save", systemImage: "bookmark")
                        }
                        .tint(.blue)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await session.sync?.setItemState("dismissed", for: item.id) }
                        } label: {
                            Label("Dismiss", systemImage: "xmark")
                        }
                    }
                }
            }
            .navigationTitle("Feed")
            .overlay {
                if items.isEmpty {
                    ContentUnavailableView(
                        "Nothing yet",
                        systemImage: "tray",
                        description: Text("Add sources and topics in the web app, or let Cortex derive topics from your own tasks.")
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await rank() } } label: {
                        Label("Rank on device", systemImage: "sparkles")
                    }
                    .disabled(isRanking || items.isEmpty)
                }
            }
            .refreshable {
                await session.sync?.refresh()
                await rank()
            }
            .task { await rank() }
        }
    }

    private func score(for item: InfoItem) -> Double? {
        ranked.first { $0.itemId == item.id }?.score
    }

    private func reason(for item: InfoItem) -> String? {
        ranked.first { $0.itemId == item.id }?.reason
    }

    /// Re-rank the feed against what the user is actually working on.
    ///
    /// This is the feature that most justifies an on-device model: the server
    /// can only match vocabulary, while the model can tell that a paper in
    /// entirely different words bears on an open task. The results are uploaded
    /// so the web app benefits too - scores, not content.
    private func rank() async {
        guard let intelligence = session.intelligence,
              let sync = session.sync,
              let context = sync.context,
              !items.isEmpty
        else { return }

        isRanking = true
        defer { isRanking = false }

        do {
            let result = try await intelligence.rank(items: Array(items.prefix(40)), context: context)
            ranked = result.value
            engine = result.engine
            if result.engine == .afm {
                await sync.uploadInference(scores: result.value, summaries: [], syncSummaries: false)
            }
        } catch {
            ranked = []
            engine = .none
        }
    }
}

struct FeedRowView: View {
    let item: InfoItem
    let score: Double?
    let reason: String?
    let engine: AIEngine

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Text(item.title).font(.subheadline.weight(.medium)).lineLimit(3)
                Spacer(minLength: 8)
                if let score {
                    Text("\(Int(score * 100))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(score > 0.7 ? .green : .secondary)
                }
            }

            Text(hostLabel).font(.caption).foregroundStyle(.secondary)

            if let reason {
                Label(reason, systemImage: engine == .afm ? "cpu" : "text.magnifyingglass")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 2)
    }

    private var hostLabel: String {
        var parts: [String] = []
        if let host = URL(string: item.canonicalUrl ?? item.url)?.host() {
            parts.append(host.replacingOccurrences(of: "www.", with: ""))
        }
        if !item.authors.isEmpty { parts.append(item.authors.prefix(2).joined(separator: ", ")) }
        if let published = item.publishedAt { parts.append(published.formatted(date: .abbreviated, time: .omitted)) }
        return parts.joined(separator: " · ")
    }
}
