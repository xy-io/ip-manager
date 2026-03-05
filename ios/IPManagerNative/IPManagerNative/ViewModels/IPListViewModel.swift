import Foundation

@MainActor
final class IPListViewModel: ObservableObject {

    // MARK: - Data
    @Published var allIPs:  [IPEntry]     = []
    @Published var config:  NetworkConfig = .default
    @Published var filtered: [IPEntry]   = []

    // MARK: - Filters
    @Published var searchText      = ""    { didSet { applyFilters() } }
    @Published var selectedLocation = "All" { didSet { applyFilters() } }
    @Published var selectedType     = "All" { didSet { applyFilters() } }
    @Published var selectedTag      = "All" { didSet { applyFilters() } }
    @Published var showFreeOnly     = false { didSet { applyFilters() } }
    @Published var showReserved     = false { didSet { applyFilters() } }

    // MARK: - Status
    @Published var isLoading  = false
    @Published var isSaving   = false
    @Published var modeLabel  = "Checking…"
    @Published var lastError: String?

    // MARK: - Derived

    var locations: [String] {
        ["All"] + Array(Set(allIPs.compactMap(\.location).filter { !$0.isEmpty })).sorted()
    }

    var types: [String] {
        ["All"] + Array(Set(allIPs.compactMap(\.type).filter { !$0.isEmpty })).sorted()
    }

    var allTags: [String] {
        let tags = allIPs.flatMap { $0.tags ?? [] }.filter { !$0.isEmpty }
        return ["All"] + Array(Set(tags)).sorted()
    }

    var freeCount:     Int { allIPs.filter(\.isFree).count }
    var assignedCount: Int { allIPs.filter(\.isAssigned).count }

    var hasActiveFilters: Bool {
        selectedLocation != "All" || selectedType != "All" ||
        selectedTag != "All" || showFreeOnly || !searchText.isEmpty
    }

    // MARK: - Lifecycle

    func bootstrap() async { await refresh() }

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            _ = try await APIClient.shared.health()
            modeLabel = "SQLite (LXC)"
            async let ips = APIClient.shared.fetchIPs()
            async let cfg = APIClient.shared.fetchConfig()
            self.allIPs = try await ips.sorted { $0.lastOctet < $1.lastOctet }
            self.config = try await cfg
            self.lastError = nil
            applyFilters()
        } catch {
            modeLabel  = "Connection issue"
            lastError  = error.localizedDescription
        }
    }

    // MARK: - Mutations

    func save(entry: IPEntry) async {
        var stamped = entry
        stamped.stamp()
        if let idx = allIPs.firstIndex(where: { $0.ip == entry.ip }) {
            allIPs[idx] = stamped
        }
        await pushToServer()
    }

    func release(ip: String) async {
        guard let idx = allIPs.firstIndex(where: { $0.ip == ip }) else { return }
        allIPs[idx].markFree()
        await pushToServer()
    }

    func resetFilters() {
        searchText       = ""
        selectedLocation = "All"
        selectedType     = "All"
        selectedTag      = "All"
        showFreeOnly     = false
    }

    func updateServerBaseURL(_ url: String) {
        APIClient.shared.updateBaseURL(url)
    }

    // MARK: - Private

    private func pushToServer() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await APIClient.shared.saveIPs(allIPs)
            applyFilters()
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func applyFilters() {
        let q = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        filtered = allIPs.filter { item in
            if !showReserved && item.isReserved                           { return false }
            if showFreeOnly  && !item.isFree                             { return false }
            if selectedLocation != "All", item.location != selectedLocation { return false }
            if selectedType     != "All", item.type     != selectedType     { return false }
            if selectedTag      != "All", !(item.tags ?? []).contains(selectedTag) { return false }
            guard !q.isEmpty else { return true }
            let haystack = [item.ip, item.assetName,
                            item.hostname ?? "", item.apps ?? "",
                            item.location ?? "", item.notes ?? "",
                            (item.tags ?? []).joined(separator: " ")]
                .joined(separator: " ").lowercased()
            return haystack.contains(q)
        }
    }
}
