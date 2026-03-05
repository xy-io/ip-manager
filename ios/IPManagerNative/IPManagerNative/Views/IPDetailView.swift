import SwiftUI

// MARK: - Detail View (iPad right pane)

struct IPDetailView: View {
    @EnvironmentObject private var vm: IPListViewModel
    let entry: IPEntry
    @Binding var selectedEntry: IPEntry?

    @State private var showEdit            = false
    @State private var showReleaseConfirm  = false

    private var live: IPEntry? { vm.allIPs.first { $0.ip == entry.ip } }
    private var rangeType: IPRangeType { (live ?? entry).rangeType(config: vm.config) }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                headerCard
                if let e = live {
                    if e.isAssigned || e.isFree {
                        infoGrid(e)
                    }
                    if let tags = e.tags, !tags.isEmpty {
                        tagsSection(tags)
                    }
                    if let notes = e.notes, !notes.isEmpty {
                        notesSection(notes)
                    }
                }
                actionsSection
            }
            .padding(24)
        }
        .navigationTitle(entry.ip)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let e = live, e.isAssigned {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { showEdit = true }
                        .fontWeight(.semibold)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let e = live {
                NavigationStack { EditIPView(entry: e) }
            }
        }
        .confirmationDialog(
            "Release \(entry.ip)?",
            isPresented: $showReleaseConfirm,
            titleVisibility: .visible
        ) {
            Button("Release IP", role: .destructive) {
                Task {
                    await vm.release(ip: entry.ip)
                    selectedEntry = nil
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will mark the IP as free and clear all details.")
        }
    }

    // MARK: - Header

    private var headerCard: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(entry.ip)
                        .font(.system(.title, design: .monospaced))
                        .fontWeight(.bold)
                        .foregroundStyle(entry.isFree ? .green : .primary)

                    HStack(spacing: 8) {
                        RangeBadge(type: rangeType)
                        if let type = live?.type, !type.isEmpty {
                            Text(type)
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color(.systemGray5))
                                .clipShape(Capsule())
                        }
                    }
                }
                Spacer()
                Image(systemName: iconName)
                    .font(.system(size: 44))
                    .foregroundStyle(iconColor)
                    .symbolEffect(.pulse, isActive: entry.isFree)
            }

            if let name = live?.assetName, !entry.isFree {
                Text(name)
                    .font(.title2)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if entry.isFree {
                Text("Available to claim")
                    .font(.title3)
                    .foregroundStyle(.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(20)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var iconName: String {
        if entry.isFree     { return "circle.dotted" }
        if entry.isReserved { return "lock.fill" }
        return "server.rack"
    }

    private var iconColor: Color {
        if entry.isFree     { return .green }
        if entry.isReserved { return Color(.systemGray3) }
        return .teal
    }

    // MARK: - Info Grid

    private func infoGrid(_ e: IPEntry) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            if let h = e.hostname, !h.isEmpty {
                InfoCell(title: "Hostname", value: h, icon: "globe", monospaced: true)
            }
            if let loc = e.location, !loc.isEmpty {
                InfoCell(title: "Location", value: loc, icon: "mappin.circle")
            }
            if let apps = e.apps, !apps.isEmpty {
                InfoCell(title: "Service / Apps", value: apps, icon: "app.badge")
            }
            if let date = e.formattedDate {
                InfoCell(title: "Last Modified", value: date, icon: "clock")
            }
        }
    }

    // MARK: - Tags

    private func tagsSection(_ tags: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Tags", systemImage: "tag")
                .font(.subheadline).fontWeight(.semibold)
                .foregroundStyle(.secondary)
            FlowLayout(spacing: 8) {
                ForEach(tags, id: \.self) { tag in
                    Button {
                        vm.selectedTag = vm.selectedTag == tag ? "All" : tag
                    } label: {
                        Text("#\(tag)")
                            .font(.subheadline)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(vm.selectedTag == tag ? Color.purple : Color.purple.opacity(0.12))
                            .foregroundStyle(vm.selectedTag == tag ? .white : Color.purple)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Notes

    private func notesSection(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Notes", systemImage: "note.text")
                .font(.subheadline).fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Text(notes)
                .font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: 12) {
            if let e = live {
                if e.isFree {
                    Button { showEdit = true } label: {
                        Label("Claim This IP", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.green)
                            .foregroundStyle(.white)
                            .fontWeight(.semibold)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                } else if e.isAssigned {
                    Button(role: .destructive) { showReleaseConfirm = true } label: {
                        Label("Release IP", systemImage: "minus.circle")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.red.opacity(0.08))
                            .foregroundStyle(.red)
                            .fontWeight(.medium)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// MARK: - Info Cell

struct InfoCell: View {
    let title: String
    let value: String
    let icon: String
    var monospaced: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(title, systemImage: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(monospaced ? .system(.callout, design: .monospaced) : .callout)
                .fontWeight(.medium)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Flow Layout (wrapping tag chips)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(proposal: proposal, subviews: subviews)
        let height = rows
            .map { $0.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0 }
            .reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(proposal: proposal, subviews: subviews) {
            var x = bounds.minX
            let rowH = row.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0
            for sub in row {
                let size = sub.sizeThatFits(.unspecified)
                sub.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
                x += size.width + spacing
            }
            y += rowH + spacing
        }
    }

    private func rows(proposal: ProposedViewSize, subviews: Subviews) -> [[LayoutSubview]] {
        var rows: [[LayoutSubview]] = [[]]
        var rowWidth: CGFloat = 0
        let maxWidth = proposal.width ?? .infinity
        for sub in subviews {
            let w = sub.sizeThatFits(.unspecified).width
            if rowWidth + w > maxWidth, !rows[rows.endIndex - 1].isEmpty {
                rows.append([])
                rowWidth = 0
            }
            rows[rows.endIndex - 1].append(sub)
            rowWidth += w + spacing
        }
        return rows
    }
}
