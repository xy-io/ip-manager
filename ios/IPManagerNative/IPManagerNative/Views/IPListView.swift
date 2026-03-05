import SwiftUI

struct IPListView: View {
    @EnvironmentObject private var vm: IPListViewModel

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView("Loading from LXC…")
            } else if let err = vm.lastError {
                ContentUnavailableView("Could not load data", systemImage: "wifi.exclamationmark", description: Text(err))
            } else {
                List(vm.filtered) { item in
                    NavigationLink {
                        EditIPView(entry: item)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.ip)
                                    .font(.system(.body, design: .monospaced))
                                    .fontWeight(.semibold)
                                Text(item.isFree ? "Available" : item.assetName)
                                    .foregroundStyle(item.isFree ? .green : .primary)
                                if let hostname = item.hostname, !hostname.isEmpty {
                                    Text(hostname).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if item.isFree {
                                Text("FREE").font(.caption2).padding(.horizontal, 8).padding(.vertical, 4).background(Color.green.opacity(0.15)).clipShape(Capsule())
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable {
                    await vm.refresh()
                }
            }
        }
        .navigationTitle("Addresses")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    ServerSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
            }
        }
    }
}
