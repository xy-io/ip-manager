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
                ContentUnavailableView(
                    "Select an entry",
                    systemImage: "network",
                    description: Text("Choose an IP address from the list on the left")
                )
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
                ProgressView("Loading…")
                    .padding(20)
                    .glassEffect(in: RoundedRectangle(cornerRadius: 16))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: 5) {
                Circle()
                    .fill(vm.lastError == nil ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                    .shadow(color: (vm.lastError == nil ? Color.green : Color.orange).opacity(0.7),
                            radius: 3, x: 0, y: 0)
                Text(vm.modeLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            HStack(spacing: 10) {
                if vm.isSaving {
                    ProgressView().scaleEffect(0.75)
                }
                NavigationLink {
                    ServerSettingsView()
                } label: {
                    Image(systemName: "gearshape.fill")
                        .symbolRenderingMode(.hierarchical)
                }
                .buttonStyle(.glass)
            }
        }
    }

    // MARK: Filter Bar (Liquid Glass)

    private var filterBar: some View {
        VStack(spacing: 0) {
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                GlassEffectContainer(spacing: 6) {
                    HStack(spacing: 6) {
                        FilterChip(label: "Free", icon: "circle.dotted", active: vm.showFreeOnly) {
                            vm.showFreeOnly.toggle()
                        }
                        FilterChip(label: "Reserved", icon: "lock.fill", active: vm.showReserved) {
                            vm.showReserved.toggle()
                        }

                        if vm.types.count > 1 {
                            ForEach(vm.types.dropFirst(), id: \.self) { t in
                                FilterChip(label: t, active: vm.selectedType == t) {
                                    vm.selectedType = vm.selectedType == t ? "All" : t
                                }
                            }
                        }

                        if vm.allTags.count > 1 {
                            ForEach(vm.allTags.dropFirst(), id: \.self) { tag in
                                FilterChip(label: "#\(tag)", icon: "tag", active: vm.selectedTag == tag) {
                                    vm.selectedTag = vm.selectedTag == tag ? "All" : tag
                                }
                            }
                        }

                        if vm.hasActiveFilters {
                            Button { vm.resetFilters() } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
            }

            // Stats strip
            HStack(spacing: 14) {
                Label("\(vm.assignedCount) assigned", systemImage: "server.rack")
                Label("\(vm.freeCount) free", systemImage: "circle.dotted")
                Spacer()
                Text("Showing \(vm.filtered.count) of \(vm.allIPs.count)")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
        .background(.bar)
    }
}

// MARK: - Filter Chip (Liquid Glass)

struct FilterChip: View {
    let label: String
    var icon: String? = nil
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.caption2)
                        .symbolRenderingMode(.hierarchical)
                }
                Text(label)
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(active ? Color.accentColor : Color.primary)
        }
        .buttonStyle(.glass)
        .tint(active ? Color.accentColor : Color.clear)
    }
}
