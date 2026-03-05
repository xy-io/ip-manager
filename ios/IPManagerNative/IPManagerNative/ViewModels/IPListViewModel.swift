import Foundation

@MainActor
final class IPListViewModel: ObservableObject {
    @Published var allIPs: [IPEntry] = []
    @Published var filtered: [IPEntry] = []
    @Published var config: NetworkConfig = .default

    @Published var searchText = "" {
        didSet { applyFilters() }
    }
    @Published var selectedLocation = "All" {
        didSet { applyFilters() }
    }
    @Published var selectedType = "All" {
        didSet { applyFilters() }
    }
    @Published var showFreeOnly = false {
        didSet { applyFilters() }
    }

    @Published var isLoading = false
    @Published var modeLabel = "Checking…"
    @Published var lastError: String?

    var locations: [String] {
        ["All"] + Array(Set(allIPs.compactMap(\.location))).sorted()
    }

    var types: [String] {
        ["All"] + Array(Set(allIPs.compactMap(\.type))).sorted()
    }

    func bootstrap() async {
        await refresh()
    }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let healthy = try await APIClient.shared.health()
            modeLabel = healthy ? "SQLite (LXC)" : "Offline"

            async let ips = APIClient.shared.fetchIPs()
            async let cfg = APIClient.shared.fetchConfig()

            self.allIPs = try await ips.sorted { lhs, rhs in
                lastOctet(lhs.ip) < lastOctet(rhs.ip)
            }
            self.config = try await cfg
            self.lastError = nil
            applyFilters()
        } catch {
            self.lastError = error.localizedDescription
            self.modeLabel = "Connection issue"
        }
    }

    func save(entry: IPEntry) async {
        if let idx = allIPs.firstIndex(where: { $0.ip == entry.ip }) {
            allIPs[idx] = entry
        }
        do {
            try await APIClient.shared.saveIPs(allIPs)
            applyFilters()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func updateServerBaseURL(_ baseURL: String) {
        APIClient.shared.updateBaseURL(baseURL)
    }

    private func applyFilters() {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        filtered = allIPs.filter { item in
            if showFreeOnly, !item.isFree { return false }
            if selectedLocation != "All", item.location != selectedLocation { return false }
            if selectedType != "All", item.type != selectedType { return false }

            guard !q.isEmpty else { return true }
            let haystack = [item.ip, item.assetName, item.hostname ?? "", item.apps ?? "", item.location ?? "", (item.tags ?? []).joined(separator: " ")]
                .joined(separator: " ")
                .lowercased()
            return haystack.contains(q)
        }
    }

    private func lastOctet(_ ip: String) -> Int {
        Int(ip.split(separator: ".").last ?? "0") ?? 0
    }
}
