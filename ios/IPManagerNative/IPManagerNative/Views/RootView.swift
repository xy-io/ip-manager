import SwiftUI

struct RootView: View {
    @EnvironmentObject private var vm: IPListViewModel

    var body: some View {
        NavigationSplitView {
            List {
                Section("Network") {
                    Label(vm.config.networkName, systemImage: "network")
                    Label("\(vm.config.subnet).0/24", systemImage: "number")
                    Label(vm.modeLabel, systemImage: "externaldrive.connected.to.line.below")
                }

                Section("Filters") {
                    Toggle("Show free only", isOn: $vm.showFreeOnly)

                    Picker("Type", selection: $vm.selectedType) {
                        ForEach(vm.types, id: \.self) { Text($0) }
                    }

                    Picker("Location", selection: $vm.selectedLocation) {
                        ForEach(vm.locations, id: \.self) { Text($0) }
                    }
                }
            }
            .navigationTitle("IP Manager")
        } detail: {
            IPListView()
        }
        .searchable(text: $vm.searchText, placement: .toolbar, prompt: "Search IP, hostname, tag")
    }
}
