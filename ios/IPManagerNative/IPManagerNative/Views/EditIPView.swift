import SwiftUI

struct EditIPView: View {
    @EnvironmentObject private var vm: IPListViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var draft: IPEntry
    @State private var tagInput           = ""
    @State private var showReleaseConfirm = false

    private let originallyFree: Bool

    init(entry: IPEntry) {
        _draft = State(initialValue: entry)
        originallyFree = entry.isFree
    }

    var body: some View {
        Form {
            // IP header
            Section {
                HStack {
                    Text(draft.ip)
                        .font(.system(.title2, design: .monospaced))
                        .fontWeight(.bold)
                    Spacer()
                    Text(originallyFree ? "Claiming" : "Editing")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            Section("Identity") {
                TextField(originallyFree ? "Asset Name (required)" : "Asset Name",
                          text: $draft.assetName)
                TextField("Hostname", text: optBinding(\.hostname))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
            }

            Section("Classification") {
                Picker("Type", selection: optBindingEmpty(\.type)) {
                    Text("—").tag("")
                    ForEach(["Virtual","Physical","LXC","VM","IoT","Network"], id: \.self) {
                        Text($0).tag($0)
                    }
                }
                Picker("Location", selection: optBindingEmpty(\.location)) {
                    Text("—").tag("")
                    ForEach(vm.locations.dropFirst(), id: \.self) { Text($0).tag($0) }
                }
                TextField("Service / Apps", text: optBinding(\.apps))
            }

            Section {
                if let tags = draft.tags, !tags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tags, id: \.self) { tag in
                                HStack(spacing: 3) {
                                    Text(tag).font(.caption).fontWeight(.medium)
                                    Button { removeTag(tag) } label: {
                                        Image(systemName: "xmark")
                                            .font(.system(size: 9, weight: .bold))
                                    }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Color.purple.opacity(0.12))
                                .foregroundStyle(Color.purple)
                                .clipShape(Capsule())
                            }
                        }
                    }
                }
                HStack {
                    TextField("Add tag…", text: $tagInput)
                        .onSubmit { addTag() }
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !tagInput.isEmpty {
                        Button("Add", action: addTag)
                    }
                }
            } header: { Text("Tags") } footer: {
                Text("Press Return or tap Add after each tag.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Notes") {
                TextField("Notes", text: optBinding(\.notes), axis: .vertical)
                    .lineLimit(3...8)
            }

            if !originallyFree {
                Section {
                    Button(role: .destructive) { showReleaseConfirm = true } label: {
                        Label("Release IP", systemImage: "minus.circle")
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .navigationTitle(originallyFree ? "Claim \(draft.ip)" : "Edit \(draft.ip)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(originallyFree ? "Claim" : "Save") {
                    if !tagInput.isEmpty { addTag() }
                    Task { await vm.save(entry: draft); dismiss() }
                }
                .fontWeight(.semibold)
                .disabled(draft.assetName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .confirmationDialog(
            "Release \(draft.ip)?",
            isPresented: $showReleaseConfirm,
            titleVisibility: .visible
        ) {
            Button("Release IP", role: .destructive) {
                Task { await vm.release(ip: draft.ip); dismiss() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will mark the IP as free and clear all details.")
        }
    }

    // MARK: - Tag helpers

    private func addTag() {
        let newTags = tagInput
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        var current = draft.tags ?? []
        for t in newTags where !current.contains(t) { current.append(t) }
        draft.tags = current
        tagInput = ""
    }

    private func removeTag(_ tag: String) {
        draft.tags?.removeAll { $0 == tag }
    }

    // MARK: - Bindings

    private func optBinding(_ kp: WritableKeyPath<IPEntry, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: kp] ?? "" },
                set: { draft[keyPath: kp] = $0.isEmpty ? nil : $0 })
    }

    private func optBindingEmpty(_ kp: WritableKeyPath<IPEntry, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: kp] ?? "" },
                set: { draft[keyPath: kp] = $0.isEmpty ? nil : $0 })
    }
}
