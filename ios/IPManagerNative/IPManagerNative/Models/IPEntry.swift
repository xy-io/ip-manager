import Foundation
import SwiftUI

// MARK: - IP Range Classification

enum IPRangeType {
    case free, reserved, dhcp, fixed, staticIP, other

    var label: String {
        switch self {
        case .free:     return "FREE"
        case .reserved: return "Reserved"
        case .dhcp:     return "DHCP"
        case .fixed:    return "Fixed"
        case .staticIP: return "Static"
        case .other:    return "—"
        }
    }

    var color: Color {
        switch self {
        case .free:     return .green
        case .reserved: return Color(.systemGray3)
        case .dhcp:     return .orange
        case .fixed:    return .blue
        case .staticIP: return .teal
        case .other:    return Color(.systemGray3)
        }
    }

    var background: Color {
        switch self {
        case .free:     return Color.green.opacity(0.12)
        case .reserved: return Color(.systemGray6)
        case .dhcp:     return Color.orange.opacity(0.10)
        case .fixed:    return Color.blue.opacity(0.10)
        case .staticIP: return Color.teal.opacity(0.10)
        case .other:    return Color(.systemGray6)
        }
    }
}

// MARK: - IP Entry Model

struct IPEntry: Codable, Identifiable, Hashable {
    var id: String { ip }

    let ip: String
    var assetName: String
    var hostname: String?
    var type: String?
    var location: String?
    var apps: String?
    var tags: [String]?
    var notes: String?
    var updatedAt: String?

    // MARK: Computed

    var isFree: Bool     { assetName == "Free" }
    var isReserved: Bool { assetName == "Reserved" }
    var isAssigned: Bool { !isFree && !isReserved }

    var lastOctet: Int {
        Int(ip.split(separator: ".").last ?? "0") ?? 0
    }

    var displayName: String {
        if isFree     { return "Available to claim" }
        if isReserved { return "Reserved" }
        return assetName
    }

    var formattedDate: String? {
        guard let updatedAt else { return nil }
        let formatters: [ISO8601DateFormatter] = [
            { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }(),
            ISO8601DateFormatter(),
        ]
        for formatter in formatters {
            if let date = formatter.date(from: updatedAt) {
                let out = DateFormatter()
                out.dateStyle = .medium
                out.timeStyle = .none
                return out.string(from: date)
            }
        }
        return nil
    }

    func rangeType(config: NetworkConfig) -> IPRangeType {
        if isFree     { return .free }
        if isReserved { return .reserved }
        let n = lastOctet
        if config.fixedInDHCP.contains(n)                   { return .fixed }
        if n >= config.dhcpStart && n <= config.dhcpEnd     { return .dhcp }
        if n >= config.staticStart && n <= config.staticEnd { return .staticIP }
        return .other
    }

    // MARK: Mutations

    mutating func markFree() {
        assetName = "Free"
        hostname  = nil
        type      = nil
        location  = nil
        apps      = nil
        tags      = []
        notes     = nil
        stamp()
    }

    mutating func stamp() {
        updatedAt = ISO8601DateFormatter().string(from: Date())
    }
}

struct IPListResponse: Codable {
    let data: [IPEntry]?
}
