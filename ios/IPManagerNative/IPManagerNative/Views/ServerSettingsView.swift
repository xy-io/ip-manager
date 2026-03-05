import SwiftUI

struct ServerSettingsView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = UserDefaults.standard.string(forKey: "ip-manager-base-url") ?? "http://192.168.0.10"

    var body: some View {
        Form {
            Section("LXC Server") {
                TextField("Base URL", text: $baseURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                Text("Example: http://192.168.0.50 or https://ip-manager.local")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Server")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") {
                    vm.updateServerBaseURL(baseURL)
                    Task { await vm.refresh() }
                    dismiss()
                }
                .fontWeight(.semibold)
            }
        }
    }
}
