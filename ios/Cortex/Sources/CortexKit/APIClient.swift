import Foundation

/// Talks to the Cortex web API.
///
/// The client is deliberately thin. It carries the user's Supabase access token,
/// speaks camelCase JSON in both directions, and never sends anything to a model
/// provider - the only inference in Cortex happens on this device, and the
/// results are *uploaded* here (and only when the user allowed it), never
/// requested from a server.
public actor APIClient {
    public struct Configuration: Sendable {
        public var baseURL: URL
        public var clientIdentifier: String

        public init(baseURL: URL, clientIdentifier: String = "cortex-ios") {
            self.baseURL = baseURL
            self.clientIdentifier = clientIdentifier
        }
    }

    public enum APIError: Error, LocalizedError, Sendable {
        case notAuthenticated
        case http(status: Int, message: String)
        case transport(String)
        case decoding(String)

        public var errorDescription: String? {
            switch self {
            case .notAuthenticated: "Sign in to sync with Cortex."
            case .http(let status, let message): status == 401 ? "Your session expired. Sign in again." : message
            case .transport(let message): message
            case .decoding(let message): "Unexpected response from Cortex: \(message)"
            }
        }

        /// Whether retrying later could plausibly succeed - drives the offline queue.
        public var isRetryable: Bool {
            switch self {
            case .transport: true
            case .http(let status, _): status >= 500 || status == 429
            default: false
            }
        }
    }

    private let configuration: Configuration
    private let session: URLSession
    private let tokenProvider: @Sendable () async -> String?

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        // Supabase and Postgres emit fractional seconds inconsistently, so the
        // decoder accepts both rather than failing on a timestamp.
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            let withFraction = ISO8601DateFormatter()
            withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFraction.date(from: text) { return date }
            let plain = ISO8601DateFormatter()
            plain.formatOptions = [.withInternetDateTime]
            if let date = plain.date(from: text) { return date }
            if text.count == 10, let date = DateFormatter.isoDay.date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "unrecognised date \(text)")
        }
        return decoder
    }()

    public init(configuration: Configuration, session: URLSession = .shared, tokenProvider: @escaping @Sendable () async -> String?) {
        self.configuration = configuration
        self.session = session
        self.tokenProvider = tokenProvider
    }

    // MARK: Requests

    private struct Envelope<T: Decodable & Sendable>: Decodable, Sendable {
        let data: T
    }

    private struct ErrorBody: Decodable {
        let error: String?
        let message: String?
    }

    private func request<Response: Decodable & Sendable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (any Encodable & Sendable)? = nil,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        guard let token = await tokenProvider() else { throw APIError.notAuthenticated }

        var components = URLComponents(url: configuration.baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.transport("Could not build a URL for \(path)") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(configuration.clientIdentifier, forHTTPHeaderField: "x-cortex-client")
        request.timeoutInterval = 30

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.transport("Malformed response") }
        guard (200..<300).contains(http.statusCode) else {
            let parsed = try? decoder.decode(ErrorBody.self, from: data)
            throw APIError.http(status: http.statusCode, message: parsed?.message ?? parsed?.error ?? "HTTP \(http.statusCode)")
        }

        if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response { return empty }

        do {
            return try decoder.decode(Envelope<Response>.self, from: data).data
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    public struct EmptyResponse: Decodable, Sendable {
        public init() {}
    }

    // MARK: Tasks

    public func tasks(updatedSince: Date? = nil, statuses: [TaskStatus] = [.todo, .inProgress]) async throws -> [CortexTask] {
        var query = [URLQueryItem(name: "status", value: statuses.map(\.rawValue).joined(separator: ","))]
        if let updatedSince {
            query.append(URLQueryItem(name: "updatedSince", value: ISO8601DateFormatter().string(from: updatedSince)))
        }
        return try await request("GET", "api/tasks", query: query)
    }

    public struct TaskDraft: Encodable, Sendable {
        public var title: String
        public var notes: String?
        public var priority: Priority?
        public var dueAt: Date?
        public var dueAllDay: Bool?
        public var estimateMinutes: Int?
        public var energy: EnergyLevel?
        public var recurrenceRule: String?
        public var parentTaskId: String?
        public var projectId: String?
        public var sourceItemId: String?
        public var origin: RecordOrigin?
        public var captureText: String?

        public init(
            title: String,
            notes: String? = nil,
            priority: Priority? = nil,
            dueAt: Date? = nil,
            dueAllDay: Bool? = nil,
            estimateMinutes: Int? = nil,
            energy: EnergyLevel? = nil,
            recurrenceRule: String? = nil,
            parentTaskId: String? = nil,
            projectId: String? = nil,
            sourceItemId: String? = nil,
            origin: RecordOrigin? = nil,
            captureText: String? = nil
        ) {
            self.title = title
            self.notes = notes
            self.priority = priority
            self.dueAt = dueAt
            self.dueAllDay = dueAllDay
            self.estimateMinutes = estimateMinutes
            self.energy = energy
            self.recurrenceRule = recurrenceRule
            self.parentTaskId = parentTaskId
            self.projectId = projectId
            self.sourceItemId = sourceItemId
            self.origin = origin
            self.captureText = captureText
        }
    }

    public func createTask(_ draft: TaskDraft) async throws -> CortexTask {
        try await request("POST", "api/tasks", body: draft)
    }

    public func createTasks(_ drafts: [TaskDraft]) async throws -> [CortexTask] {
        try await request("POST", "api/tasks", body: drafts)
    }

    public struct TaskPatchResult: Decodable, Sendable {
        public let task: CortexTask
        /// Set when completing a recurring task rolled it forward.
        public let rolledTo: Date?
    }

    public struct TaskPatch: Encodable, Sendable {
        public var title: String?
        public var notes: String?
        public var status: TaskStatus?
        public var priority: Priority?
        public var dueAt: Date?
        public var estimateMinutes: Int?
        public var energy: EnergyLevel?

        public init(title: String? = nil, notes: String? = nil, status: TaskStatus? = nil, priority: Priority? = nil, dueAt: Date? = nil, estimateMinutes: Int? = nil, energy: EnergyLevel? = nil) {
            self.title = title
            self.notes = notes
            self.status = status
            self.priority = priority
            self.dueAt = dueAt
            self.estimateMinutes = estimateMinutes
            self.energy = energy
        }
    }

    public func updateTask(id: String, patch: TaskPatch) async throws -> TaskPatchResult {
        try await request("PATCH", "api/tasks/\(id)", body: patch)
    }

    public func deleteTask(id: String) async throws {
        _ = try await request("DELETE", "api/tasks/\(id)", as: DeletedResponse.self)
    }

    private struct DeletedResponse: Decodable, Sendable {
        let deleted: String
    }

    // MARK: Capture

    private struct CapturePayload: Encodable, Sendable {
        let text: String
        let offsetMinutes: Int
        let engine: String
        let parsed: ParsedPayload?

        struct ParsedPayload: Encodable, Sendable {
            let title: String
            let dueAt: Date?
            let dueAllDay: Bool
            let estimateMinutes: Int?
            let priority: String
            let energy: String?
            let recurrenceRule: String?
            let projectName: String?
            let tagNames: [String]
        }
    }

    public struct CaptureResult: Decodable, Sendable {
        public let task: CortexTask
        public let engine: String
    }

    /// Send a capture, including the structure the on-device model produced.
    ///
    /// When `parsed` is present the server trusts it rather than re-parsing:
    /// Foundation Models understood the sentence with real language ability, and
    /// the server's grammar would only be a downgrade.
    public func capture(text: String, parsed: ParsedCapture?, engine: AIEngine, timeZone: TimeZone = .current) async throws -> CaptureResult {
        let payload = CapturePayload(
            text: text,
            offsetMinutes: timeZone.secondsFromGMT() / 60,
            engine: engine == .afm ? "afm" : "heuristic",
            parsed: parsed.map {
                CapturePayload.ParsedPayload(
                    title: $0.title,
                    dueAt: $0.dueAt,
                    dueAllDay: $0.dueAllDay,
                    estimateMinutes: $0.estimateMinutes,
                    priority: $0.priority.rawValue,
                    energy: $0.energy?.rawValue,
                    recurrenceRule: $0.recurrenceRule,
                    projectName: $0.projectName,
                    tagNames: $0.tagNames
                )
            }
        )
        return try await request("POST", "api/capture", body: payload)
    }

    // MARK: Context for on-device inference

    public func workContext(taskLimit: Int = 25) async throws -> WorkContext {
        try await request("GET", "api/context", query: [URLQueryItem(name: "tasks", value: String(taskLimit))])
    }

    // MARK: Monitoring

    public struct FeedEntry: Decodable, Sendable {
        public let item: InfoItem
        public let state: String
    }

    public func feed(limit: Int = 50, since: Date? = nil) async throws -> [FeedEntry] {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let since { query.append(URLQueryItem(name: "since", value: ISO8601DateFormatter().string(from: since))) }
        return try await request("GET", "api/items", query: query)
    }

    private struct ScorePayload: Encodable, Sendable {
        let itemId: String
        let topicId: String?
        let score: Double
        let signals: [String: Double]
        let matchedTerms: [String]
        let explanation: String?
    }

    private struct WrittenResponse: Decodable, Sendable {
        let written: Int
    }

    /// Upload relevance judged on device. These rows win over the server's
    /// keyword ranking wherever both exist.
    @discardableResult
    public func uploadScores(_ ranked: [RankedItem]) async throws -> Int {
        guard !ranked.isEmpty else { return 0 }
        let payload = ranked.map {
            ScorePayload(
                itemId: $0.itemId,
                topicId: $0.topicId,
                score: $0.score,
                signals: ["semantic": $0.score],
                matchedTerms: [],
                explanation: $0.reason
            )
        }
        return try await request("POST", "api/items/scores", body: payload, as: WrittenResponse.self).written
    }

    private struct StatePayload: Encodable, Sendable {
        let itemId: String
        let state: String
        let notes: String?
        let tags: [String]?
    }

    public func setItemState(itemId: String, state: String, notes: String? = nil, tags: [String]? = nil) async throws {
        _ = try await request(
            "POST",
            "api/items/state",
            body: StatePayload(itemId: itemId, state: state, notes: notes, tags: tags),
            as: AnyDecodable.self
        )
    }

    private struct SummaryPayload: Encodable, Sendable {
        let itemId: String
        let style: String
        let text: String
        let engine: String
        let modelIdentifier: String?
    }

    /// Upload on-device summaries. The server refuses with 403 unless the user
    /// switched summary sync on, which is the correct default: what the phone
    /// writes stays on the phone.
    public func uploadSummaries(_ summaries: [ItemSummary]) async throws {
        guard !summaries.isEmpty else { return }
        let payload = summaries.map {
            SummaryPayload(itemId: $0.itemId, style: $0.style.rawValue, text: $0.text, engine: $0.engine.rawValue, modelIdentifier: $0.modelIdentifier)
        }
        _ = try await request("POST", "api/summaries", body: payload, as: AnyDecodable.self)
    }

    // MARK: Device registration

    private struct DevicePayload: Encodable, Sendable {
        let name: String
        let platform: String
        let pushToken: String?
        let afmAvailability: String
        let appVersion: String?
    }

    /// Tell the account what this device can do, so the web app can explain
    /// exactly why an AI feature is or is not available.
    public func registerDevice(name: String, pushToken: String?, availability: IntelligenceAvailability, appVersion: String?) async throws {
        _ = try await request(
            "POST",
            "api/devices",
            body: DevicePayload(
                name: name,
                platform: "ios",
                pushToken: pushToken,
                afmAvailability: availability.rawValue,
                appVersion: appVersion
            ),
            as: AnyDecodable.self
        )
    }

    // MARK: Clipping

    private struct ClipPayload: Encodable, Sendable {
        let url: String
        let title: String
        let summary: String?
        let content: String?
        let origin: String
    }

    public struct ClipResult: Decodable, Sendable {
        public let item: InfoItem
        public let deduped: Bool
    }

    public func clip(url: String, title: String, summary: String?, content: String?) async throws -> ClipResult {
        try await request("POST", "api/items", body: ClipPayload(url: url, title: title, summary: summary, content: content, origin: "ios"))
    }
}

// MARK: - Encoding helpers

/// Type-erasing wrapper so `request` can take any Encodable body.
struct AnyEncodable: Encodable {
    private let encode: (Encoder) throws -> Void

    init(_ wrapped: any Encodable) {
        encode = wrapped.encode
    }

    func encode(to encoder: Encoder) throws {
        try encode(encoder)
    }
}

/// For endpoints whose body is not interesting.
struct AnyDecodable: Decodable, Sendable {
    init(from decoder: Decoder) throws {
        _ = try decoder.singleValueContainer()
    }
}

extension DateFormatter {
    static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter
    }()
}
