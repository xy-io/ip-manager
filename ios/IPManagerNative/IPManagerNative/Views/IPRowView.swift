import SwiftUI

// MARK: - Row View

struct IPRowView: View {
    @EnvironmentObject private var vm: IPListViewModel
    let entry: IPEntry

    private var rangeType: IPRangeType { entry.rangeType(config: vm.config) }

    var body: some View {
        HStack(spacing: 12) {
            // Status dot
            Circle()
                .fill(statusColor)
                .frame(width: 9, height: 9)
                .shadow(color: statusColor.opacity(0.6), radius: 3, x: 0, y: 0)

            VStack(alignment: .leading, spacing: 3) {
                // IP address + badge — must never wrap
                HStack(spacing: 6) {
                    Text(entry.ip)
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .foregroundStyle(entry.isFree ? Color.green : Color.primary)
                    RangeBadge(type: rangeType)
                    Spacer(minLength: 0)
                }

                // Display name
                Text(entry.displayName)
                    .font(.subheadline)
                    .fontWeight(entry.isFree ? .regular : .medium)
                    .foregroundStyle(entry.isFree ? Color.secondary : Color.primary)
                    .lineLimit(1)

                // Secondary info row
                HStack(spacing: 8) {
                    if let loc = entry.location, !loc.isEmpty {
                        Label(loc, systemImage: "mappin")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if let hostname = entry.hostname, !hostname.isEmpty,
                       entry.location == nil || entry.location!.isEmpty {
                        Text(hostname)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    if let tags = entry.tags, !tags.isEmpty {
                        Text("#\(tags[0])")
                            .font(.caption2)
                            .foregroundStyle(Color.purple.opacity(0.8))
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var statusColor: Color {
        if entry.isFree     { return .green }
        if entry.isReserved { return Color(.systemGray3) }
        switch rangeType {
        case .dhcp:     return .orange
        case .fixed:    return .blue
        case .staticIP: return .teal
        default:        return .teal
        }
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
            .overlay(Capsule().stroke(type.color.opacity(0.25), lineWidth: 0.5))
    }
}
