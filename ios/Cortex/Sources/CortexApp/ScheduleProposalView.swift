import SwiftUI
import CortexKit

/// Time blocks the model proposed, which the user approves one at a time.
///
/// The split of responsibility here is the important part: this device computes
/// the free slots arithmetically from the calendar, hands the model only the
/// slots and the work, and then re-validates every placement against those slots
/// before showing it. A hallucinated timestamp cannot reach the calendar.
struct ScheduleProposalView: View {
    @Environment(AppSession.self) private var session
    @State private var proposals: [ProposedBlock] = []
    @State private var slots: [FreeSlot] = []
    @State private var engine: AIEngine = .none
    @State private var isThinking = false
    @State private var approved: Set<String> = []
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                if slots.isEmpty {
                    Text("No free slots inside your working hours in the next three days.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(slots) { slot in
                        HStack {
                            Text(slot.start.formatted(date: .abbreviated, time: .shortened))
                            Spacer()
                            Text("\(slot.minutes) min").foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    }
                }
            } header: {
                Text("Free time")
            } footer: {
                Text("Computed from your calendar and working hours on this device.")
            }

            Section {
                if proposals.isEmpty {
                    Button {
                        Task { await propose() }
                    } label: {
                        Label(isThinking ? "Thinking..." : "Propose blocks", systemImage: "wand.and.stars")
                    }
                    .disabled(isThinking || slots.isEmpty)
                } else {
                    ForEach(proposals, id: \.taskId) { block in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(title(for: block.taskId)).font(.subheadline.weight(.medium))
                                Spacer()
                                Text("\(Int(block.endAt.timeIntervalSince(block.startAt) / 60))m")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text("\(block.startAt.formatted(date: .abbreviated, time: .shortened)) - \(block.endAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption).foregroundStyle(.secondary)
                            Text(block.rationale).font(.caption).italic().foregroundStyle(.secondary)

                            HStack {
                                Button(approved.contains(block.taskId) ? "Approved" : "Approve") {
                                    approved.insert(block.taskId)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(approved.contains(block.taskId))

                                Button("Skip") {
                                    proposals.removeAll { $0.taskId == block.taskId }
                                }
                                .buttonStyle(.bordered)
                            }
                            .font(.caption)
                        }
                        .padding(.vertical, 4)
                    }
                }

                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.secondary)
                }
            } header: {
                Text("Proposed")
            } footer: {
                if !proposals.isEmpty {
                    Text(engine == .afm
                         ? "Placed on this device by Apple Foundation Models. Nothing reaches your calendar until you approve it."
                         : "Placed by the built-in planner, first fit. Nothing reaches your calendar until you approve it.")
                }
            }
        }
        .navigationTitle("Schedule")
        .navigationBarTitleDisplayMode(.inline)
        .task { computeSlots() }
    }

    private func title(for taskId: String) -> String {
        session.sync?.context?.tasks.first { $0.id == taskId }?.title ?? "Task"
    }

    private func computeSlots() {
        guard let context = session.sync?.context else { return }
        let busy = context.events
            .filter(\.blocksTime)
            .map { Scheduling.BusyInterval(start: $0.startAt, end: $0.endAt) }

        slots = Scheduling.freeSlots(
            busy: busy,
            from: .now,
            to: .now.addingTimeInterval(3 * 86_400),
            settings: context.scheduling,
            notBefore: .now
        )
    }

    private func propose() async {
        guard let intelligence = session.intelligence, let context = session.sync?.context else { return }
        isThinking = true
        errorMessage = nil
        defer { isThinking = false }

        do {
            let result = try await intelligence.proposeBlocks(
                tasks: Array(context.tasks.prefix(12)),
                slots: slots,
                settings: context.scheduling
            )
            proposals = result.value
            engine = result.engine
            if proposals.isEmpty { errorMessage = "Nothing fitted into the free slots." }
        } catch let error as IntelligenceError {
            errorMessage = error.userMessage
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
