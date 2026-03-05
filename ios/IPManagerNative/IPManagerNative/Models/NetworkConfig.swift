import Foundation

struct NetworkConfig: Codable {
    var networkName: String
    var subnet: String
    var dhcpStart: Int
    var dhcpEnd: Int
    var staticStart: Int
    var staticEnd: Int
    var fixedInDHCP: [Int]

    static let `default` = NetworkConfig(
        networkName: "Home Network",
        subnet: "192.168.0",
        dhcpStart: 1,
        dhcpEnd: 170,
        staticStart: 171,
        staticEnd: 254,
        fixedInDHCP: [6, 50]
    )

    var dhcpPoolSize: Int { dhcpEnd - dhcpStart + 1 - fixedInDHCP.count }
}

struct NetworkConfigResponse: Codable {
    let data: NetworkConfig?
}
