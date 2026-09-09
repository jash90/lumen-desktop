import Foundation

// MARK: - Home Assistant
//
// The Swift counterpart of src/main/homeassistant/. Only what a widget needs:
// read the areas and their lights, and switch one area or all of them.
//
// No WebSocket here — a widget renders once and exits, so the push channel the
// app keeps open would have nothing to push to. It reads the current state and
// is reloaded when the app says something changed.
//
// Ordinary TLS, exactly as on the app side: no trust overrides anywhere.

enum HaError: Error {
    case badResponse(Int)
    case badUrl
}

enum HaClient {
    // MARK: Wire format

    private struct EntityState: Decodable {
        let entity_id: String
        let state: String
        let attributes: Attributes

        struct Attributes: Decodable {
            let friendly_name: String?
            let brightness: Double?
        }
    }

    private struct AreaEntry {
        let area_id: String
        let name: String
    }

    // MARK: Requests

    private static func request(
        _ address: String,
        _ token: String,
        method: String,
        path: String,
        body: Data? = nil
    ) throws -> URLRequest {
        guard let url = URL(string: address + path) else { throw HaError.badUrl }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        request.timeoutInterval = 10
        return request
    }

    private static func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw HaError.badResponse(status) }
        return data
    }

    // MARK: Reads

    /// Rooms for one instance, mapped the same way HaMapper does on the app side.
    static func fetchRooms(
        providerId: String,
        address: String,
        token: String
    ) async throws -> (rooms: [RoomSnapshot], lightsOn: Int, lightsTotal: Int) {
        // Both at once: a widget has a few seconds to render, and these are two
        // independent round trips.
        async let statesData = send(try request(address, token, method: "GET", path: "/api/states"))
        async let areaMapResult = fetchAreaMap(address: address, token: token)

        let states = try JSONDecoder().decode([EntityState].self, from: try await statesData)
        let lights = states.filter { $0.entity_id.hasPrefix("light.") }
        let areaMap = try await areaMapResult

        var byArea: [String: [EntityState]] = [:]
        for light in lights {
            guard let areaId = areaMap.areaByEntity[light.entity_id] else { continue }
            byArea[areaId, default: []].append(light)
        }

        let rooms = areaMap.areas.compactMap { area -> RoomSnapshot? in
            guard let inArea = byArea[area.area_id], !inArea.isEmpty else { return nil }
            let lit = inArea.filter { $0.state == "on" }
            let brightness = lit.isEmpty
                ? 0
                : Int((lit.map { ($0.attributes.brightness ?? 255) / 255 * 100 }
                    .reduce(0, +) / Double(lit.count)).rounded())

            return RoomSnapshot(
                id: area.area_id,
                providerId: providerId,
                name: area.name,
                isOn: !lit.isEmpty,
                brightness: brightness,
                lightCount: inArea.count,
                controllable: true
            )
        }

        return (
            rooms.sorted { $0.name.localizedCompare($1.name) == .orderedAscending },
            lights.filter { $0.state == "on" }.count,
            lights.count
        )
    }

    /**
     * Areas and their entities.
     *
     * The registries live on the WebSocket API, which a widget has no business
     * opening for one render — the template engine exposes the same mapping
     * over plain HTTP, and `area_entities` already resolves an entity through
     * its device the way the app's registry walk does.
     */
    private static func fetchAreaMap(
        address: String,
        token: String
    ) async throws -> (areas: [AreaEntry], areaByEntity: [String: String]) {
        let template = """
        {%- set out = namespace(rows=[]) -%}
        {%- for a in areas() -%}
        {%- set out.rows = out.rows + [{'area_id': a, 'name': area_name(a), \
        'entities': area_entities(a)}] -%}
        {%- endfor -%}
        {{ out.rows | tojson }}
        """

        let data = try await send(
            try request(
                address, token,
                method: "POST",
                path: "/api/template",
                body: try JSONSerialization.data(withJSONObject: ["template": template])
            )
        )

        struct Row: Decodable {
            let area_id: String
            let name: String
            let entities: [String]
        }

        let rows = try JSONDecoder().decode([Row].self, from: data)
        var areaByEntity: [String: String] = [:]
        for row in rows {
            for entity in row.entities { areaByEntity[entity] = row.area_id }
        }
        return (rows.map { AreaEntry(area_id: $0.area_id, name: $0.name) }, areaByEntity)
    }

    // MARK: Writes

    static func setAreaPower(
        address: String,
        token: String,
        areaId: String,
        on: Bool
    ) async throws {
        // Targeting the area lets Home Assistant fan out itself — one request
        // rather than one per bulb, as HaApi does.
        _ = try await send(
            try request(
                address, token,
                method: "POST",
                path: "/api/services/light/\(on ? "turn_on" : "turn_off")",
                body: try JSONSerialization.data(withJSONObject: ["area_id": areaId])
            )
        )
    }

    static func setAllPower(address: String, token: String, on: Bool) async throws {
        _ = try await send(
            try request(
                address, token,
                method: "POST",
                path: "/api/services/light/\(on ? "turn_on" : "turn_off")",
                body: try JSONSerialization.data(withJSONObject: ["entity_id": "all"])
            )
        )
    }
}
