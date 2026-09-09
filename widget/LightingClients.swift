import Foundation

// MARK: - Dispatch
//
// One screen, several hubs — the widget's half of what ProviderRegistry does in
// the app. Reads run against every exported hub at once and are concatenated;
// writes go to the hub that owns the room.
//
// A hub with no exported credential is not an error: its rooms still appear,
// taken from the snapshot the app writes, and render read-only. That is the
// normal state for Home Assistant, whose token is exported only when the user
// has explicitly allowed it.

enum LightingClients {
    /// Live state where a credential allows it, the app's snapshot for the rest.
    static func fetchSnapshot() async -> StateSnapshot {
        let credentials = CredentialStore.load()
        let cached = SnapshotStore.load()
        guard !credentials.isEmpty else { return cached }

        var rooms: [RoomSnapshot] = []
        var lightsOn = 0
        var lightsTotal = 0
        var reached: Set<String> = []

        // Sequential rather than concurrent: two or three hubs on a LAN, against
        // the complexity of a task group in a process that renders once.
        for credential in credentials {
            guard let result = try? await fetch(credential) else { continue }
            rooms.append(contentsOf: result.rooms)
            lightsOn += result.lightsOn
            lightsTotal += result.lightsTotal
            reached.insert(credential.providerId)
        }

        // Hubs we could not reach, or were never given the keys to, fall back to
        // whatever the app last knew — a stale reading beats an empty box.
        // Their `controllable` flag already says whether the app exported a
        // credential for that hub, so a momentarily unreachable one keeps its
        // button (the tap may well succeed) while one we hold no keys to does
        // not get a button that could only ever fail.
        let missing = cached.rooms.filter { !reached.contains($0.providerId) }
        rooms.append(contentsOf: missing)

        if rooms.isEmpty { return cached }

        return StateSnapshot(
            connected: !reached.isEmpty || cached.connected,
            rooms: rooms.sorted { $0.name.localizedCompare($1.name) == .orderedAscending },
            lightsOn: reached.isEmpty ? cached.lightsOn : lightsOn,
            lightsTotal: reached.isEmpty ? cached.lightsTotal : lightsTotal
        )
    }

    static func setRoomPower(providerId: String, roomId: String, on: Bool) async throws {
        guard let credential = CredentialStore.load().first(where: { $0.providerId == providerId })
        else { throw HueBridgeError.notPaired }

        switch credential {
        case let .hue(providerId, address, applicationKey):
            try await HueBridgeClient.setRoomPower(
                credentials: HueCredentials(bridgeId: providerId, address: address, applicationKey: applicationKey),
                roomId: roomId,
                on: on
            )
        case let .homeAssistant(_, address, token):
            try await HaClient.setAreaPower(
                address: address, token: token, areaId: roomId, on: on
            )
        }
    }

    /// "Everything" means every hub we hold the keys to, not just the first one.
    static func setAllPower(on: Bool) async throws {
        var lastError: Error?
        var any = false

        for credential in CredentialStore.load() {
            do {
                switch credential {
                case let .hue(providerId, address, applicationKey):
                    try await HueBridgeClient.setAllPower(
                        credentials: HueCredentials(
                            bridgeId: providerId, address: address, applicationKey: applicationKey
                        ),
                        on: on
                    )
                case let .homeAssistant(_, address, token):
                    try await HaClient.setAllPower(address: address, token: token, on: on)
                }
                any = true
            } catch {
                // One unreachable hub must not stop the others from switching.
                lastError = error
            }
        }

        if !any, let lastError { throw lastError }
    }

    private static func fetch(
        _ credential: WidgetCredential
    ) async throws -> (rooms: [RoomSnapshot], lightsOn: Int, lightsTotal: Int) {
        switch credential {
        case let .hue(providerId, address, applicationKey):
            return try await HueBridgeClient.fetchRooms(
                // For a Hue hub the provider id is the bridge id, which is what
                // the certificate's Common Name is checked against.
                credentials: HueCredentials(
                    bridgeId: providerId, address: address, applicationKey: applicationKey
                ),
                providerId: providerId
            )
        case let .homeAssistant(providerId, address, token):
            return try await HaClient.fetchRooms(
                providerId: providerId, address: address, token: token
            )
        }
    }
}
