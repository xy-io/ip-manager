import SwiftUI

struct ServerSettingsView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var baseURL = UserDefaults.standard.string(forKey: "ip-manager-base-url") ?? "http://192.168.0.10"
    @State private var isTesting = false
    @State private var testResult: String?

    var body: some View {
        Form {
            Section {
                TextField("Base URL", text: $baseURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                Text("Example: http://192.168.0.50")
                    .font(.caption).foregroundStyle(.secondary)
            } header: {
                Text("LXC Server")
            } footer: {
                Text("The IP or hostname of your LXC container running the IP Manager API.")
            }

            Section {
                Button {
                    Task {
                        isTesting = true
                        testResult = nil
                        vm.updateServerBaseURL(baseURL)
                        do {
                            _ = try await APIClient.shared.health()
                            testResult = "✓ Connected successfully"
                        } catch {
                            testResult = "✗ \(error.localizedDescription)"
                        }
                        isTesting = false
                    }
                } label: {
                    HStack {
                        Label("Test Connection", systemImage: "antenna.radiowaves.left.and.right")
                        Spacer()
                        if isTesting { ProgressView().scaleEffect(0.8) }
                    }
                }
                if let result = testResult {
                    Text(result)
                        .font(.caption)
                        .foregroundStyle(result.hasPrefix("✓") ? .green : .red)
                }
            }
        }
        .navigationTitle("Server Settings")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") {
                    vm.updateServerBaseURL(baseURL)
                    Task { await vm.refresh(); dismiss() }
                }
                .fontWeight(.semibold)
            }
        }
    }
}
