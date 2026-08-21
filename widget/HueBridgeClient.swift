import Foundation

// MARK: - Credentials
//
// Written by the Electron app into the shared App Group container. The widget
// needs them because it queries and controls the bridge itself rather than going
// through the app — that is what makes it work while the app is not running.

struct HueCredentials: Codable {
    let bridgeId: String
    let ip: String
    let applicationKey: String

    static func load() -> HueCredentials? {
        guard let group = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SnapshotStore.appGroup
        ) else { return nil }
        let url = group.appendingPathComponent("widget-credentials.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(HueCredentials.self, from: data)
    }
}

enum HueBridgeError: Error {
    case notPaired
    case badResponse(Int)
    case noGroupedLight
}

// MARK: - TLS
//
// The Swift counterpart of createHueTransport() in src/main/hue/HueTransport.ts.
// A Hue bridge serves a certificate issued by Signify's private "root-bridge" CA
// that carries the bridge id as Common Name and no subjectAltName at all, so:
//
//   1. only that CA is trusted — never the system store, and never a blanket
//      "accept anything" credential;
//   2. the hostname check is replaced by an explicit Common Name comparison
//      against the bridge id we paired with, because the default check runs
//      against an IP address and can only ever fail.

private let hueRootCA = """
MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIwOTELMAkGA1UE\
BhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAtyb290LWJyaWRnZTAiGA8yMDE3\
MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhp\
bGlwcyBIdWUxFDASBgNVBAMMC3Jvb3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\
jNw2tx2AplOf9x86aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK\
0G22jOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQU\
Z2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8ItRnKfqWKnHFGmShPaQ7\
MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBzIEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlk\
Z2WCFDuxUi22sYpLlwJY81Wrqy11phcOMAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnG\
w557lVkORgit2Rm1h3B2sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
"""

/// The bridge id is 16 lowercase hex digits — the Swift side of BRIDGE_ID_PATTERN.
private func isBridgeId(_ value: String) -> Bool {
    value.count == 16 && value.allSatisfy { $0.isHexDigit && !$0.isUppercase }
}

final class HueTrustDelegate: NSObject, URLSessionDelegate {
    private let expectedBridgeId: String

    init(expectedBridgeId: String) {
        self.expectedBridgeId = expectedBridgeId.lowercased()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let anchorData = Data(base64Encoded: hueRootCA),
              let anchor = SecCertificateCreateWithData(nil, anchorData as CFData)
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Basic X509 rather than SSL: the SSL policy would insist on a hostname
        // match that a bridge certificate can never satisfy.
        guard SecTrustSetPolicies(trust, SecPolicyCreateBasicX509()) == errSecSuccess,
              SecTrustSetAnchorCertificates(trust, [anchor] as CFArray) == errSecSuccess,
              SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess,
              SecTrustEvaluateWithError(trust, nil)
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // The chain is genuine; now check it is *our* bridge and not another one
        // on the network holding an equally genuine Signify certificate.
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        var commonName: CFString?
        SecCertificateCopyCommonName(leaf, &commonName)
        guard let cn = (commonName as String?)?.lowercased(),
              isBridgeId(cn),
              cn == expectedBridgeId
        else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}

// MARK: - Wire format
//
// Only the fields the widget actually uses. Hue sends a great deal more, and
// decoding all of it would mean maintaining a second copy of src/main/hue/dto.ts.

private struct HueEnvelope: Decodable {
    let data: [HueResource]
}

private struct HueResource: Decodable {
    struct Ref: Decodable {
        let rid: String
        let rtype: String
    }
    struct Metadata: Decodable { let name: String? }
    struct On: Decodable { let on: Bool }
    struct Dimming: Decodable { let brightness: Double }

    let id: String
    let type: String
    let owner: Ref?
    let metadata: Metadata?
    let on: On?
    let dimming: Dimming?
    let children: [Ref]?
    let services: [Ref]?
}

// MARK: - Client

enum HueBridgeClient {
    private static func session(for credentials: HueCredentials) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 10
        return URLSession(
            configuration: config,
            delegate: HueTrustDelegate(expectedBridgeId: credentials.bridgeId),
            delegateQueue: nil
        )
    }

    private static func request(
        _ credentials: HueCredentials,
        method: String,
        path: String,
        body: Data? = nil
    ) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://\(credentials.ip)\(path)")!)
        request.httpMethod = method
        request.setValue(credentials.applicationKey, forHTTPHeaderField: "hue-application-key")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// One call returns every resource, which is all the widget ever needs: the
    /// light/room join, the grouped_light ids for the toggles, and the state.
    private static func fetchResources(_ credentials: HueCredentials) async throws -> [HueResource] {
        let session = session(for: credentials)
        defer { session.finishTasksAndInvalidate() }

        let (data, response) = try await session.data(
            for: request(credentials, method: "GET", path: "/clip/v2/resource")
        )
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw HueBridgeError.badResponse(status) }
        return try JSONDecoder().decode(HueEnvelope.self, from: data).data
    }

    static func fetchSnapshot() async throws -> HueSnapshot {
        guard let credentials = HueCredentials.load() else { throw HueBridgeError.notPaired }
        return snapshot(from: try await fetchResources(credentials))
    }

    static func setRoomPower(roomId: String, on: Bool) async throws {
        guard let credentials = HueCredentials.load() else { throw HueBridgeError.notPaired }
        let resources = try await fetchResources(credentials)
        guard let room = resources.first(where: { $0.type == "room" && $0.id == roomId }),
              let groupedLight = groupedLightId(of: room)
        else { throw HueBridgeError.noGroupedLight }
        try await write(credentials, groupedLightIds: [groupedLight], on: on)
    }

    /// "Everything off" means every room's grouped_light — one request per room
    /// rather than per bulb, matching what the app does in HueApi.setRoomPower.
    static func setAllPower(on: Bool) async throws {
        guard let credentials = HueCredentials.load() else { throw HueBridgeError.notPaired }
        let resources = try await fetchResources(credentials)
        let ids = resources.filter { $0.type == "room" }.compactMap(groupedLightId(of:))
        guard !ids.isEmpty else { throw HueBridgeError.noGroupedLight }
        try await write(credentials, groupedLightIds: ids, on: on)
    }

    private static func write(
        _ credentials: HueCredentials,
        groupedLightIds: [String],
        on: Bool
    ) async throws {
        let session = session(for: credentials)
        defer { session.finishTasksAndInvalidate() }
        let body = try JSONSerialization.data(withJSONObject: ["on": ["on": on]])

        for id in groupedLightIds {
            let (_, response) = try await session.data(
                for: request(
                    credentials,
                    method: "PUT",
                    path: "/clip/v2/resource/grouped_light/\(id)",
                    body: body
                )
            )
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else { throw HueBridgeError.badResponse(status) }
        }
    }

    private static func groupedLightId(of room: HueResource) -> String? {
        room.services?.first { $0.rtype == "grouped_light" }?.rid
    }

    // MARK: Mapping
    //
    // Mirrors toRoom() in src/main/hue/HueMapper.ts: grouped_light is
    // authoritative for a room's power and brightness, and the average over the
    // lit bulbs is the fallback for rooms that do not expose one.

    fileprivate static func snapshot(from resources: [HueResource]) -> HueSnapshot {
        let lights = resources.filter { $0.type == "light" }
        let groupedLights = Dictionary(
            uniqueKeysWithValues: resources.filter { $0.type == "grouped_light" }.map { ($0.id, $0) }
        )

        // device rid -> room id, so each light can be attributed to a room.
        var roomOfDevice: [String: String] = [:]
        let rooms = resources.filter { $0.type == "room" }
        for room in rooms {
            for child in room.children ?? [] where child.rtype == "device" {
                roomOfDevice[child.rid] = room.id
            }
        }

        let roomSnapshots = rooms.map { room -> RoomSnapshot in
            let inRoom = lights.filter { roomOfDevice[$0.owner?.rid ?? ""] == room.id }
            let lit = inRoom.filter { $0.on?.on == true }
            let grouped = groupedLightId(of: room).flatMap { groupedLights[$0] }

            let averageBrightness = lit.isEmpty
                ? 0
                : Int((lit.map { $0.dimming?.brightness ?? 100 }.reduce(0, +) / Double(lit.count)).rounded())

            return RoomSnapshot(
                id: room.id,
                name: room.metadata?.name ?? "—",
                isOn: grouped?.on?.on ?? !lit.isEmpty,
                brightness: grouped?.dimming.map { Int($0.brightness.rounded()) } ?? averageBrightness,
                lightCount: inRoom.count
            )
        }

        return HueSnapshot(
            connected: true,
            rooms: roomSnapshots.sorted { $0.name.localizedCompare($1.name) == .orderedAscending },
            lightsOn: lights.filter { $0.on?.on == true }.count,
            lightsTotal: lights.count
        )
    }
}
