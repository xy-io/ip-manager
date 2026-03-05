import SwiftUI

// MARK: - Root (iPad NavigationSplitView)

struct RootView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @State private var selectedEntry: IPEntry?

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            SidebarView(selectedEntry: $selectedEntry)
        } detail: {
            if let entry = selectedEntry {
                IPDetailView(entry: entry, selectedEntry: $selectedEntry)
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "network")
                        .font(.system(size: 56))
                        .foregroundStyle(.tertiary)
                    Text("Select an entry")
                        .font(.title2)
                        .fontWeight(.semibold)
                    Text("Choose an IP address from the list on the left")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground))
            }
        }
        .searchable(text: $vm.searchText, placement: .toolbar, prompt: "Search IP, hostname, tag…")
    }
}

// MARK: - Sidebar

struct SidebarView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @Binding var selectedEntry: IPEntry?

    var body: some View {
        List(vm.filtered, selection: $selectedEntry) { item in
            IPRowView(entry: item)
                .tag(item)
        }
        .listStyle(.insetGrouped)
        .navigationTitle("IP Manager")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { toolbarContent }
        .refreshable { await vm.refresh() }
        .safeAreaInset(edge: .bottom) { filterBar }
        .overlay {
            if vm.isLoading && vm.allIPs.isEmpty {
                ProgressView("Loading from LXC…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.regularMaterial)
            }
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: 6) {
                Circle()
                    .fill(vm.lastError == nil ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(vm.modeLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 12) {
                if vm.isSaving {
                    ProgressView().scaleEffect(0.7)
                }
                NavigationLink {
                    ServerSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
    }

    private var filterBar: some View {
        VStack(spacing: 0) {
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterChip(label: "Free only", icon: "circle.dotted", active: vm.showFreeOnly) {
                        vm.showFreeOnly.toggle()
                    }
                    FilterChip(label: "Reserved", icon: "lock", active: vm.showReserved) {
                        vm.showReserved.toggle()
                    }

                    if vm.types.count > 1 {
                        Divider().frame(height: 20)
                        ForEach(vm.types.dropFirst(), id: \.self) { t in
                            FilterChip(label: t, active: vm.selectedType == t) {
                                vm.selectedType = vm.selectedType == t ? "All" : t
                            }
                        }
                    }

                    if vm.allTags.count > 1 {
                        Divider().frame(height: 20)
                        ForEach(vm.allTags.dropFirst(), id: \.self) { tag in
                            FilterChip(label: "#\(tag)", icon: "tag", active: vm.selectedTag == tag) {
                                vm.selectedTag = vm.selectedTag == tag ? "All" : tag
                            }
                        }
                    }

                    if vm.hasActiveFilters {
                        Button { vm.resetFilters() } label: {
                            Label("Clear", systemImage: "xmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            // Stats strip
            HStack(spacing: 16) {
                Label("\(vm.assignedCount) assigned", systemImage: "server.rack")
                Label("\(vm.freeCount) free", systemImage: "circle.dotted")
                Spacer()
                Text("Showing \(vm.filtered.count) of \(vm.allIPs.count)")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .background(.bar)
    }
}

// MARK: - Filter Chip

struct FilterChip: View {
    let label: String
    var icon: String? = nil
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon { Image(systemName: icon).font(.caption2) }
                Text(label).font(.caption).fontWeight(.medium)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(active ? Color.accentColor : Color(.systemGray5))
            .foregroundStyle(active ? .white : .primary)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
