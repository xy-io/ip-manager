import Foundation

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

    var isFree: Bool { assetName == "Free" }
    var isReserved: Bool { assetName == "Reserved" }
}

struct IPListResponse: Codable {
    let data: [IPEntry]?
}
