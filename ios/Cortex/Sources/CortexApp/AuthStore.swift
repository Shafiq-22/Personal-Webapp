import Foundation
import Security

/// Holds the Supabase session.
///
/// The refresh token is kept in the Keychain with
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: it must survive a reboot
/// for background refresh to work, but it must never travel in an iCloud backup
/// to another device.
actor AuthStore {
    private struct Session: Codable {
        var accessToken: String
        var refreshToken: String
        var expiresAt: Date
    }

    private let service = "com.cortex.session"
    private let account = "supabase"
    private var cached: Session?

    func accessToken() async -> String? {
        if let cached, cached.expiresAt > .now.addingTimeInterval(60) { return cached.accessToken }
        guard let stored = load() else { return nil }
        cached = stored
        if stored.expiresAt > .now.addingTimeInterval(60) { return stored.accessToken }
        return await refresh(using: stored.refreshToken)
    }

    func store(accessToken: String, refreshToken: String, expiresIn: TimeInterval) {
        let session = Session(accessToken: accessToken, refreshToken: refreshToken, expiresAt: .now.addingTimeInterval(expiresIn))
        cached = session
        guard let data = try? JSONEncoder().encode(session) else { return }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)

        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func signOut() {
        cached = nil
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func load() -> Session? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return try? JSONDecoder().decode(Session.self, from: data)
    }

    /// Exchange the refresh token for a new access token.
    private func refresh(using refreshToken: String) async -> String? {
        guard let base = UserDefaults.standard.string(forKey: "cortex.supabaseURL"),
              let anonKey = UserDefaults.standard.string(forKey: "cortex.supabaseAnonKey"),
              let url = URL(string: "\(base)/auth/v1/token?grant_type=refresh_token")
        else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

        struct TokenResponse: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: TimeInterval
        }

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let token = try? JSONDecoder().decode(TokenResponse.self, from: data)
        else { return nil }

        store(accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in)
        return token.access_token
    }
}
