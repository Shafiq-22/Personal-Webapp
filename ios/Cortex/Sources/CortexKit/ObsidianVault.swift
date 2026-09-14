import Foundation

/// Reads and writes the user's Obsidian vault.
///
/// The iPhone is the side of Cortex that can actually touch the vault: an
/// iCloud Drive folder is reachable here and not from a web server. Everything
/// this type writes is plain Markdown with frontmatter identical to what the
/// web app generates, so a note written by either side round-trips through the
/// other.
///
/// Security-scoped bookmarks are used rather than a stored path, because that
/// is what survives a reboot without asking the user to re-pick the folder.
public actor ObsidianVault {
    public struct Folders: Sendable, Codable {
        public var tasks = "Cortex/Tasks"
        public var items = "Cortex/Research"
        public var digests = "Cortex/Digests"
        public var events = "Cortex/Calendar"
        public var projects = "Cortex/Projects"
        public var dailyNotes = "Daily Notes"

        public init() {}
    }

    public enum VaultError: Error, LocalizedError, Sendable {
        case notConfigured
        case accessDenied
        case writeFailed(String)

        public var errorDescription: String? {
            switch self {
            case .notConfigured: "Choose your Obsidian vault folder in Settings first."
            case .accessDenied: "Cortex lost access to the vault folder. Pick it again in Settings."
            case .writeFailed(let message): message
            }
        }
    }

    private let bookmarkKey = "cortex.vault.bookmark"
    private let defaults: UserDefaults
    private let fileManager: FileManager
    private var folders: Folders

    public init(defaults: UserDefaults = .standard, fileManager: FileManager = .default, folders: Folders = Folders()) {
        self.defaults = defaults
        self.fileManager = fileManager
        self.folders = folders
    }

    public func setFolders(_ folders: Folders) {
        self.folders = folders
    }

    // MARK: Access

    /// Store the folder the user picked, as a security-scoped bookmark.
    public func setVaultURL(_ url: URL) throws {
        let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
        defaults.set(bookmark, forKey: bookmarkKey)
    }

    public var isConfigured: Bool {
        defaults.data(forKey: bookmarkKey) != nil
    }

    private func resolveVaultURL() throws -> URL {
        guard let bookmark = defaults.data(forKey: bookmarkKey) else { throw VaultError.notConfigured }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            throw VaultError.accessDenied
        }
        if stale, let refreshed = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            defaults.set(refreshed, forKey: bookmarkKey)
        }
        return url
    }

    /// Run a block with the vault folder accessible, always balancing the
    /// security-scoped access.
    private func withVault<T>(_ body: (URL) throws -> T) throws -> T {
        let root = try resolveVaultURL()
        let accessed = root.startAccessingSecurityScopedResource()
        defer { if accessed { root.stopAccessingSecurityScopedResource() } }
        return try body(root)
    }

    // MARK: Writing

    @discardableResult
    public func write(_ contents: String, to relativePath: String) throws -> URL {
        try withVault { root in
            let url = root.appending(path: relativePath)
            let directory = url.deletingLastPathComponent()
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            do {
                try contents.write(to: url, atomically: true, encoding: .utf8)
            } catch {
                throw VaultError.writeFailed(error.localizedDescription)
            }
            return url
        }
    }

    public func read(_ relativePath: String) throws -> String? {
        try withVault { root in
            let url = root.appending(path: relativePath)
            guard fileManager.fileExists(atPath: url.path(percentEncoded: false)) else { return nil }
            return try String(contentsOf: url, encoding: .utf8)
        }
    }

    public func delete(_ relativePath: String) throws {
        try withVault { root in
            let url = root.appending(path: relativePath)
            if fileManager.fileExists(atPath: url.path(percentEncoded: false)) {
                try fileManager.removeItem(at: url)
            }
        }
    }

    /// Every Markdown file under the given vault-relative folders.
    ///
    /// Used only for topic discovery, and only when the user turned that on -
    /// the note text is read on this device, terms are extracted here, and only
    /// the resulting topic labels are ever uploaded.
    public func markdownFiles(in relativeFolders: [String], limit: Int = 400) throws -> [(path: String, contents: String, modified: Date)] {
        try withVault { root in
            var results: [(String, String, Date)] = []

            for folder in relativeFolders {
                let base = root.appending(path: folder)
                guard let enumerator = fileManager.enumerator(at: base, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else { continue }

                for case let url as URL in enumerator {
                    guard url.pathExtension.lowercased() == "md" else { continue }
                    guard let contents = try? String(contentsOf: url, encoding: .utf8) else { continue }
                    let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                    let relative = url.path(percentEncoded: false).replacingOccurrences(of: root.path(percentEncoded: false), with: "")
                    results.append((relative, contents, modified))
                    if results.count >= limit { return results }
                }
            }
            return results
        }
    }

    // MARK: Paths

    public func path(forTask task: CortexTask) -> String {
        "\(folders.tasks)/\(MarkdownNote.slug(task.title))-\(task.id.prefix(8)).md"
    }

    public func path(forItem item: InfoItem) -> String {
        "\(folders.items)/\(MarkdownNote.slug(item.title))-\(item.id.prefix(8)).md"
    }

    public func dailyNotePath(for day: Date) -> String {
        "\(folders.dailyNotes)/\(MarkdownNote.dayKey(day)).md"
    }
}
