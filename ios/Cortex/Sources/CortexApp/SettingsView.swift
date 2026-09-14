import SwiftUI
import UIKit
import UniformTypeIdentifiers
import CortexKit

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var showingVaultPicker = false
    @State private var vaultConfigured = false
    @State private var baseURLText = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("On-device intelligence") {
                    if let availability = session.intelligence?.availability {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(
                                availability.isAvailable ? "Apple Foundation Models is ready" : "Using the built-in fallback",
                                systemImage: availability.isAvailable ? "cpu" : "cpu.fill"
                            )
                            .font(.subheadline.weight(.medium))

                            Text(availability.explanation).font(.caption).foregroundStyle(.secondary)

                            if availability == .appleIntelligenceDisabled,
                               let url = URL(string: UIApplication.openSettingsURLString) {
                                Link("Open Settings", destination: url).font(.caption)
                            }
                        }
                        .padding(.vertical, 2)
                    }

                    if let reason = session.intelligence?.lastFallbackReason {
                        Text(reason).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section {
                    Toggle("Sync summaries to the cloud", isOn: Binding(
                        get: { session.settings.syncSummaries },
                        set: { session.settings.syncSummaries = $0 }
                    ))
                    Toggle("Let Cortex read the vault for topics", isOn: Binding(
                        get: { session.settings.allowVaultScan },
                        set: { session.settings.allowVaultScan = $0 }
                    ))
                } header: {
                    Text("Privacy")
                } footer: {
                    Text("""
                    All AI processing happens here, on this device. These switches decide what leaves it.

                    Summaries are written by Apple Foundation Models locally; with sync off they stay on this phone and the web app shows the original abstract instead. Vault scanning reads your notes locally to propose monitoring topics - only the topic labels are ever uploaded, never note text.
                    """)
                }

                Section {
                    Button {
                        showingVaultPicker = true
                    } label: {
                        Label(vaultConfigured ? "Change vault folder" : "Choose vault folder", systemImage: "folder")
                    }

                    if vaultConfigured {
                        Button {
                            Task { await writeDailyNote() }
                        } label: {
                            Label("Write today's daily note", systemImage: "doc.badge.plus")
                        }
                    }
                } header: {
                    Text("Obsidian")
                } footer: {
                    Text("Cortex writes plain Markdown with frontmatter, and task lines in Obsidian Tasks syntax. Pick the vault folder itself - iCloud Drive, or wherever it lives on this device.")
                }

                Section("Account") {
                    LabeledContent("Server", value: session.settings.baseURL.host() ?? "not set")
                    if let synced = session.sync?.lastSyncedAt {
                        LabeledContent("Last synced", value: synced.formatted(date: .omitted, time: .shortened))
                    }
                    if let queued = session.sync?.queuedCount, queued > 0 {
                        LabeledContent("Waiting to sync", value: "\(queued)")
                    }
                    Button("Sync now") { Task { await session.sync?.refresh() } }
                }

                Section {
                    Text("""
                    Cortex has no cloud model. Summarising, ranking, prioritising, breaking work down and understanding what you type all run on this iPhone through Apple Foundation Models, and work with no connection at all.

                    Where the model is unavailable the app says so and falls back to deterministic behaviour - it never presents extracted sentences as a written summary.
                    """)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } header: {
                    Text("How AI works here")
                }
            }
            .navigationTitle("Settings")
            .fileImporter(isPresented: $showingVaultPicker, allowedContentTypes: [.folder]) { result in
                if case .success(let url) = result {
                    Task {
                        let vault = ObsidianVault()
                        try? await vault.setVaultURL(url)
                        vaultConfigured = await vault.isConfigured
                    }
                }
            }
            .task {
                vaultConfigured = await ObsidianVault().isConfigured
            }
        }
    }

    private func writeDailyNote() async {
        guard let sync = session.sync else { return }
        let vault = ObsidianVault()
        let today = Date.now
        let calendar = Calendar.current

        let dueToday = sync.tasks.filter { task in
            guard let due = task.dueAt else { return false }
            return calendar.isDate(due, inSameDayAs: today)
        }
        let eventsToday = (sync.context?.events ?? []).filter { calendar.isDate($0.startAt, inSameDayAs: today) }

        let section = MarkdownNote.dailySection(day: today, tasks: dueToday, events: eventsToday)
        let path = await vault.dailyNotePath(for: today)
        let existing = (try? await vault.read(path)) ?? ""
        try? await vault.write(MarkdownNote.upsertDailySection(in: existing ?? "", section: section), to: path)
    }
}
