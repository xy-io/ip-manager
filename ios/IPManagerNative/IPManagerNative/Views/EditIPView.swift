import SwiftUI

struct EditIPView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var draft: IPEntry

    init(entry: IPEntry) {
        _draft = State(initialValue: entry)
    }

    var body: some View {
        Form {
            Section("Identity") {
                LabeledContent("IP") {
                    Text(draft.ip).font(.system(.body, design: .monospaced))
                }
                TextField("Asset Name", text: $draft.assetName)
                TextField("Hostname", text: binding(\.hostname))
            }

            Section("Classification") {
                TextField("Type", text: binding(\.type))
                TextField("Location", text: binding(\.location))
                TextField("Service", text: binding(\.apps))
            }

            Section("Notes") {
                TextField("Notes", text: binding(\.notes), axis: .vertical)
                    .lineLimit(3...8)
            }
        }
        .navigationTitle(draft.ip)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") {
                    Task {
                        await vm.save(entry: draft)
                        dismiss()
                    }
                }
                .fontWeight(.semibold)
            }
        }
    }

    private func binding(_ keyPath: WritableKeyPath<IPEntry, String?>) -> Binding<String> {
        Binding(
            get: { draft[keyPath: keyPath] ?? "" },
            set: { draft[keyPath: keyPath] = $0.isEmpty ? nil : $0 }
        )
    }
}
