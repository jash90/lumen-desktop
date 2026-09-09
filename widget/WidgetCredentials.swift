import Foundation

// MARK: - Credentials
//
// Written by the Electron app into the shared App Group container. The widget
// needs them because it queries and controls the hubs itself rather than going
// through the app — that is what makes it work while the app is not running.
//
// The Swift side of WidgetCredential in src/main/widget/WidgetBridge.ts: one
// entry per hub the user allowed to be exported. A Home Assistant token is
// present only behind the explicit opt-in, so a hub can legitimately be missing
// here while still appearing in the snapshot — those rooms render read-only.

enum WidgetCredential {
    case hue(providerId: String, address: String, applicationKey: String)
    case homeAssistant(providerId: String, address: String, token: String)

    var providerId: String {
        switch self {
        case let .hue(providerId, _, _): return providerId
        case let .homeAssistant(providerId, _, _): return providerId
        }
    }
}

extension WidgetCredential: Decodable {
    private enum CodingKeys: String, CodingKey {
        case kind, providerId, address, applicationKey, token
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        let providerId = try container.decode(String.self, forKey: .providerId)
        let address = try container.decode(String.self, forKey: .address)

        switch kind {
        case "hue":
            self = .hue(
                providerId: providerId,
                address: address,
                applicationKey: try container.decode(String.self, forKey: .applicationKey)
            )
        case "homeassistant":
            self = .homeAssistant(
                providerId: providerId,
                address: address,
                token: try container.decode(String.self, forKey: .token)
            )
        default:
            // A newer app writing a hub kind this build does not know must not
            // take the whole file down with it.
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "unknown hub kind \(kind)"
            )
        }
    }
}

enum CredentialStore {
    static func load() -> [WidgetCredential] {
        guard let group = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: AppIdentity.appGroup
        ) else { return [] }
        let url = group.appendingPathComponent("widget-credentials.json")
        guard let data = try? Data(contentsOf: url) else { return [] }

        // Decoded one at a time so an entry this build cannot read costs only
        // that hub rather than every hub in the file.
        guard let raw = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return raw.compactMap { entry in
            guard let item = try? JSONSerialization.data(withJSONObject: entry) else { return nil }
            return try? JSONDecoder().decode(WidgetCredential.self, from: item)
        }
    }
}
