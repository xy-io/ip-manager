import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL."
        case .invalidResponse: return "Unexpected server response."
        case let .serverError(code): return "Server returned HTTP \(code)."
        }
    }
}

final class APIClient {
    static let shared = APIClient()

    private(set) var baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private init() {
        let persisted = UserDefaults.standard.string(forKey: "ip-manager-base-url") ?? "http://192.168.0.10"
        self.baseURL = URL(string: persisted) ?? URL(string: "http://192.168.0.10")!

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        self.session = URLSession(configuration: config)
    }

    func updateBaseURL(_ value: String) {
        guard let url = URL(string: value) else { return }
        baseURL = url
        UserDefaults.standard.set(value, forKey: "ip-manager-base-url")
    }

    func health() async throws -> Bool {
        let req = try request(path: "/api/health", method: "GET")
        let (_, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (200..<300).contains(http.statusCode)
    }

    func fetchIPs() async throws -> [IPEntry] {
        let req = try request(path: "/api/ips", method: "GET")
        let (data, response) = try await session.data(for: req)
        try validate(response)
        return try decoder.decode(IPListResponse.self, from: data).data ?? []
    }

    func saveIPs(_ rows: [IPEntry]) async throws {
        var req = try request(path: "/api/ips", method: "PUT")
        req.httpBody = try encoder.encode(rows)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await session.data(for: req)
        try validate(response)
    }

    func fetchConfig() async throws -> NetworkConfig {
        let req = try request(path: "/api/config", method: "GET")
        let (data, response) = try await session.data(for: req)
        try validate(response)
        return try decoder.decode(NetworkConfigResponse.self, from: data).data ?? .default
    }

    private func request(path: String, method: String) throws -> URLRequest {
        guard let fullURL = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }
        var req = URLRequest(url: fullURL)
        req.httpMethod = method
        return req
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else { throw APIError.serverError(http.statusCode) }
    }
}
