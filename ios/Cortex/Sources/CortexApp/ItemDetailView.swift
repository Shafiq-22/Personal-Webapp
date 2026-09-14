import SwiftUI
import CortexKit

/// One piece of information, summarised on device in whichever style the user
/// asks for.
///
/// The six styles are the reason the on-device model earns its place: the same
/// paper read as a TL;DR, as key points, as practical implications, in plain
/// language, as methodology, or as actions - generated locally, offline, in a
/// second or two, with nothing leaving the phone.
struct ItemDetailView: View {
    let item: InfoItem
    var reason: String?

    @Environment(AppSession.self) private var session
    @State private var style: SummaryStyle = .tldr
    @State private var summaries: [SummaryStyle: ItemSummary] = [:]
    @State private var availableStyles: [SummaryStyle] = []
    @State private var isSummarizing = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                if !availableStyles.isEmpty {
                    Picker("Summary style", selection: $style) {
                        ForEach(availableStyles) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                    .onChange(of: style) { _, _ in Task { await summarize() } }
                }

                summaryBody

                if let abstract = item.summaryRaw, !abstract.isEmpty {
                    DisclosureGroup("Original abstract") {
                        Text(abstract).font(.callout).padding(.top, 4)
                    }
                }

                actions
            }
            .padding()
        }
        .navigationTitle(item.kind.capitalized)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            availableStyles = await session.intelligence?.supportedStyles(for: item) ?? []
            await summarize()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.title).font(.title3.weight(.semibold))

            if !item.authors.isEmpty {
                Text(item.authors.joined(separator: ", ")).font(.subheadline).foregroundStyle(.secondary)
            }

            if let reason {
                Label(reason, systemImage: "sparkles").font(.caption).foregroundStyle(.secondary)
            }

            if let url = URL(string: item.canonicalUrl ?? item.url) {
                Link(destination: url) {
                    Label(url.host() ?? "Open", systemImage: "safari")
                }
                .font(.caption)
            }
        }
    }

    @ViewBuilder
    private var summaryBody: some View {
        if isSummarizing {
            HStack(spacing: 8) {
                ProgressView()
                Text("Summarising on device...").font(.callout).foregroundStyle(.secondary)
            }
        } else if let summary = summaries[style] {
            VStack(alignment: .leading, spacing: 8) {
                Text(summary.text).font(.body)

                Text(summary.engine == .afm
                     ? "Written on this device with Apple Foundation Models. Nothing was sent to a server."
                     : "Sentences extracted from the original text - not a written summary.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding()
            .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 12))
        } else if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var actions: some View {
        VStack(spacing: 8) {
            Button {
                Task { await createTask() }
            } label: {
                Label("Create a task from this", systemImage: "plus.circle").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                Task { await session.sync?.setItemState("saved", for: item.id) }
            } label: {
                Label("Save to library", systemImage: "bookmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button {
                Task { await saveToVault() }
            } label: {
                Label("Write to Obsidian", systemImage: "doc.text").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    // MARK: Actions

    private func summarize() async {
        guard let intelligence = session.intelligence, summaries[style] == nil else { return }
        isSummarizing = true
        errorMessage = nil
        defer { isSummarizing = false }

        do {
            let result = try await intelligence.summarize(item, style: style)
            guard !result.value.isEmpty else {
                errorMessage = "There was not enough text to summarise."
                return
            }
            let summary = ItemSummary(itemId: item.id, style: style, text: result.value, engine: result.engine, modelIdentifier: result.modelIdentifier)
            summaries[style] = summary

            // Uploaded only when the user turned summary sync on.
            await session.sync?.uploadInference(scores: [], summaries: [summary], syncSummaries: session.settings.syncSummaries)
        } catch let error as IntelligenceError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func createTask() async {
        await session.sync?.addTask(
            .init(
                title: "Read: \(item.title)",
                notes: item.canonicalUrl ?? item.url,
                estimateMinutes: 25,
                sourceItemId: item.id,
                origin: .ios
            )
        )
    }

    private func saveToVault() async {
        let vault = ObsidianVault()
        let note = MarkdownNote.itemNote(
            item,
            summaries: Array(summaries.values).sorted { $0.style.rawValue < $1.style.rawValue },
            relevance: nil
        )
        try? await vault.write(note, to: await vault.path(forItem: item))
    }
}
