import UIKit
import SwiftUI
import UniformTypeIdentifiers
import CortexKit

/// Share Sheet capture.
///
/// Anything the user shares - a link from Safari, selected text, a PDF - becomes
/// a library item, and optionally a task, without leaving the app they were in.
/// The extension writes through the same API as the app and inherits the same
/// offline queue.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        Task { @MainActor in
            let payload = await extractPayload()
            let view = ShareCaptureView(payload: payload) { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
            } onCancel: { [weak self] in
                self?.extensionContext?.cancelRequest(withError: NSError(domain: "com.cortex.share", code: 0))
            }

            let hosting = UIHostingController(rootView: view)
            addChild(hosting)
            hosting.view.frame = view_bounds()
            self.view.addSubview(hosting.view)
            hosting.didMove(toParent: self)
        }
    }

    private func view_bounds() -> CGRect { view.bounds }

    private func extractPayload() async -> SharePayload {
        guard let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
              let attachments = item.attachments
        else { return SharePayload(url: nil, title: nil, text: nil) }

        var url: URL?
        var text: String?

        for provider in attachments {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
            }
        }

        return SharePayload(url: url, title: item.attributedContentText?.string, text: text)
    }
}

struct SharePayload: Sendable {
    var url: URL?
    var title: String?
    var text: String?
}

struct ShareCaptureView: View {
    let payload: SharePayload
    let onDone: () -> Void
    let onCancel: () -> Void

    @State private var title: String = ""
    @State private var note: String = ""
    @State private var alsoCreateTask = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Save to Cortex") {
                    TextField("Title", text: $title, axis: .vertical)
                    if let url = payload.url {
                        Text(url.absoluteString).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    TextField("Note (optional)", text: $note, axis: .vertical)
                }

                Section {
                    Toggle("Also create a task to read it", isOn: $alsoCreateTask)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Cortex")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(isSaving || title.isEmpty)
                }
            }
            .onAppear {
                title = payload.title ?? payload.url?.host() ?? String((payload.text ?? "").prefix(120))
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }

        guard let urlString = payload.url?.absoluteString else {
            errorMessage = "Nothing to save - no link was shared."
            return
        }

        let auth = AuthStore()
        let api = APIClient(
            configuration: .init(baseURL: sharedBaseURL()),
            tokenProvider: { await auth.accessToken() }
        )

        do {
            let clipped = try await api.clip(url: urlString, title: title, summary: note.isEmpty ? nil : note, content: payload.text)
            if alsoCreateTask {
                _ = try await api.createTask(.init(title: "Read: \(title)", notes: urlString, estimateMinutes: 25, sourceItemId: clipped.item.id, origin: .ios))
            }
            onDone()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// The extension and the app share defaults through an App Group.
    private func sharedBaseURL() -> URL {
        let defaults = UserDefaults(suiteName: "group.com.cortex.app") ?? .standard
        let text = defaults.string(forKey: "cortex.baseURL") ?? "https://cortex.local"
        return URL(string: text) ?? URL(string: "https://cortex.local")!
    }
}
