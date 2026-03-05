import SwiftUI

// MARK: - Detail View (iPad right pane)

struct IPDetailView: View {
    @EnvironmentObject private var vm: IPListViewModel
    let entry: IPEntry
    @Binding var selectedEntry: IPEntry?

    @State private var showEdit           = false
    @State private var showReleaseConfirm = false

    private var live: IPEntry? { vm.allIPs.first { $0.ip == entry.ip } }
    private var rangeType: IPRangeType { (live ?? entry).rangeType(config: vm.config) }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
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
            .padding(20)
        }
        .navigationTitle(entry.ip)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let e = live, e.isAssigned {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { showEdit = true }
                        .fontWeight(.semibold)
                        .buttonStyle(.glass)
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

    // MARK: - Header Card (Mesh Gradient + Glass)

    private var headerCard: some View {
        ZStack(alignment: .bottomLeading) {
            // Mesh gradient background
            MeshGradient(
                width: 3, height: 2,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 1], [0.5, 1], [1, 1]
                ],
                colors: headerGradientColors
            )
            .clipShape(RoundedRectangle(cornerRadius: 20))

            // Glass overlay with content
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(entry.ip)
                            .font(.system(.largeTitle, design: .monospaced))
                            .fontWeight(.bold)
                            .foregroundStyle(.white)
                            .shadow(color: .black.opacity(0.2), radius: 2, x: 0, y: 1)

                        HStack(spacing: 8) {
                            RangeBadge(type: rangeType)
                            if let type = live?.type, !type.isEmpty {
                                Text(type)
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(.white.opacity(0.2))
                                    .foregroundStyle(.white)
                                    .clipShape(Capsule())
                            }
                        }
                    }

                    Spacer()

                    Image(systemName: iconName)
                        .font(.system(size: 48))
                        .foregroundStyle(.white.opacity(0.9))
                        .shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 2)
                        .symbolEffect(.pulse, isActive: entry.isFree)
                        .symbolRenderingMode(.hierarchical)
                }

                if let name = live?.assetName, !entry.isFree {
                    Text(name)
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                } else if entry.isFree {
                    Text("Available to claim")
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
            .padding(20)
        }
        .frame(minHeight: 160)
    }

    private var headerGradientColors: [Color] {
        if entry.isFree {
            return [
                Color(hue: 0.38, saturation: 0.6, brightness: 0.55),
                Color(hue: 0.40, saturation: 0.5, brightness: 0.45),
                Color(hue: 0.42, saturation: 0.7, brightness: 0.40),
                Color(hue: 0.35, saturation: 0.5, brightness: 0.35),
                Color(hue: 0.38, saturation: 0.6, brightness: 0.30),
                Color(hue: 0.40, saturation: 0.5, brightness: 0.25),
            ]
        }
        if entry.isReserved {
            return [
                Color(hue: 0.6,  saturation: 0.15, brightness: 0.5),
                Color(hue: 0.62, saturation: 0.12, brightness: 0.42),
                Color(hue: 0.60, saturation: 0.15, brightness: 0.38),
                Color(hue: 0.58, saturation: 0.10, brightness: 0.30),
                Color(hue: 0.60, saturation: 0.12, brightness: 0.25),
                Color(hue: 0.62, saturation: 0.15, brightness: 0.20),
            ]
        }
        switch rangeType {
        case .dhcp:
            return [
                Color(hue: 0.08, saturation: 0.7, brightness: 0.65),
                Color(hue: 0.06, saturation: 0.6, brightness: 0.55),
                Color(hue: 0.10, saturation: 0.8, brightness: 0.50),
                Color(hue: 0.07, saturation: 0.6, brightness: 0.40),
                Color(hue: 0.08, saturation: 0.7, brightness: 0.32),
                Color(hue: 0.10, saturation: 0.6, brightness: 0.25),
            ]
        case .fixed:
            return [
                Color(hue: 0.60, saturation: 0.65, brightness: 0.65),
                Color(hue: 0.62, saturation: 0.55, brightness: 0.55),
                Color(hue: 0.58, saturation: 0.70, brightness: 0.50),
                Color(hue: 0.60, saturation: 0.55, brightness: 0.40),
                Color(hue: 0.62, saturation: 0.65, brightness: 0.32),
                Color(hue: 0.58, saturation: 0.55, brightness: 0.25),
            ]
        default:
            return [
                Color(hue: 0.53, saturation: 0.60, brightness: 0.60),
                Color(hue: 0.55, saturation: 0.50, brightness: 0.50),
                Color(hue: 0.51, saturation: 0.65, brightness: 0.45),
                Color(hue: 0.53, saturation: 0.50, brightness: 0.35),
                Color(hue: 0.55, saturation: 0.60, brightness: 0.28),
                Color(hue: 0.51, saturation: 0.50, brightness: 0.22),
            ]
        }
    }

    private var iconName: String {
        if entry.isFree     { return "circle.dotted" }
        if entry.isReserved { return "lock.fill" }
        switch rangeType {
        case .dhcp:     return "wifi.router.fill"
        case .fixed:    return "pin.fill"
        case .staticIP: return "server.rack"
        default:        return "server.rack"
        }
    }

    // MARK: - Info Grid (Glass Cards)

    private func infoGrid(_ e: IPEntry) -> some View {
        LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible())],
            spacing: 12
        ) {
            if let h = e.hostname, !h.isEmpty {
                InfoCell(title: "Hostname", value: h, icon: "globe", monospaced: true)
            }
            if let loc = e.location, !loc.isEmpty {
                InfoCell(title: "Location", value: loc, icon: "mappin.circle.fill")
            }
            if let apps = e.apps, !apps.isEmpty {
                InfoCell(title: "Service / Apps", value: apps, icon: "app.badge.fill")
            }
            if let date = e.formattedDate {
                InfoCell(title: "Last Modified", value: date, icon: "clock.fill")
            }
        }
    }

    // MARK: - Tags (Glass)

    private func tagsSection(_ tags: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Tags", systemImage: "tag.fill")
                .font(.subheadline).fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.hierarchical)
            FlowLayout(spacing: 8) {
                ForEach(tags, id: \.self) { tag in
                    Button {
                        vm.selectedTag = vm.selectedTag == tag ? "All" : tag
                    } label: {
                        Text("#\(tag)")
                            .font(.subheadline)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.glass)
                    .tint(vm.selectedTag == tag ? Color.purple : Color.clear)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glassEffect(in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Notes (Glass)

    private func notesSection(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Notes", systemImage: "note.text")
                .font(.subheadline).fontWeight(.semibold)
                .foregroundStyle(.secondary)
            Text(notes)
                .font(.body)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glassEffect(in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Actions

    private var actionsSection: some View {
        VStack(spacing: 10) {
            if let e = live {
                if e.isFree {
                    Button {
                        showEdit = true
                    } label: {
                        Label("Claim This IP", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .controlSize(.large)
                } else if e.isAssigned {
                    Button(role: .destructive) {
                        showReleaseConfirm = true
                    } label: {
                        Label("Release IP", systemImage: "minus.circle")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                            .fontWeight(.medium)
                    }
                    .buttonStyle(.glass)
                    .tint(.red)
                    .controlSize(.large)
                }
            }
        }
    }
}

// MARK: - Info Cell (Glass)

struct InfoCell: View {
    let title: String
    let value: String
    let icon: String
    var monospaced: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon)
                .font(.caption)
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.hierarchical)
            Text(value)
                .font(monospaced ? .system(.callout, design: .monospaced) : .callout)
                .fontWeight(.medium)
                .lineLimit(2)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glassEffect(in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = computeRows(proposal: proposal, subviews: subviews)
        let height = rows
            .map { $0.map { $0.sizeThatFits(.unspecified).height }.max() ?? 0 }
            .reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in computeRows(proposal: proposal, subviews: subviews) {
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

    private func computeRows(proposal: ProposedViewSize, subviews: Subviews) -> [[LayoutSubview]] {
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
