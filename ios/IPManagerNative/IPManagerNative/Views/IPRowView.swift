import SwiftUI

// MARK: - Row View

struct IPRowView: View {
    @EnvironmentObject private var vm: IPListViewModel
    let entry: IPEntry

    private var rangeType: IPRangeType { entry.rangeType(config: vm.config) }

    var body: some View {
        HStack(spacing: 12) {
            // Left column
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(entry.ip)
                        .font(.system(.callout, design: .monospaced))
                        .fontWeight(.semibold)
                        .foregroundStyle(entry.isFree ? .green : .primary)
                    RangeBadge(type: rangeType)
                }

                Text(entry.displayName)
                    .font(.subheadline)
                    .foregroundStyle(entry.isFree ? Color.green : .primary)
                    .lineLimit(1)

                if let hostname = entry.hostname, !hostname.isEmpty {
                    Text(hostname)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if let notes = entry.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .italic()
                }
            }

            Spacer()

            // Right column
            VStack(alignment: .trailing, spacing: 4) {
                if let location = entry.location, !location.isEmpty {
                    Label(location, systemImage: "mappin")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if let apps = entry.apps, !apps.isEmpty {
                    Text(apps)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                if let tags = entry.tags, !tags.isEmpty {
                    HStack(spacing: 3) {
                        ForEach(tags.prefix(2), id: \.self) { tag in
                            Text("#\(tag)")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.purple.opacity(0.12))
                                .foregroundStyle(Color.purple)
                                .clipShape(Capsule())
                        }
                        if tags.count > 2 {
                            Text("+\(tags.count - 2)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Range Badge

struct RangeBadge: View {
    let type: IPRangeType

    var body: some View {
        Text(type.label)
            .font(.system(size: 9, weight: .bold))
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(type.background)
            .foregroundStyle(type.color)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(type.color.opacity(0.3), lineWidth: 0.5))
    }
}
