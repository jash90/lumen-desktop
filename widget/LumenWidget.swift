import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Shared snapshot
//
// The widget reads live state straight from the bridge (see HueBridgeClient).
// This file, written by the Electron app whenever light state changes, is the
// fallback for when the bridge cannot be reached — a stale reading beats an
// empty box.

struct RoomSnapshot: Codable, Identifiable {
    let id: String
    /// Which hub owns it — a tap has to reach the right one.
    let providerId: String
    let name: String
    let isOn: Bool
    let brightness: Int
    let lightCount: Int
    /// False when no credential was exported for that hub; the row is a reading.
    let controllable: Bool
}

struct StateSnapshot: Codable {
    let connected: Bool
    let rooms: [RoomSnapshot]
    let lightsOn: Int
    let lightsTotal: Int

    static let empty = StateSnapshot(connected: false, rooms: [], lightsOn: 0, lightsTotal: 0)
}

enum SnapshotStore {
    /// From `identity.json` via the generated `Identity.swift`, so this cannot
    /// drift from what the Electron side writes.
    static let appGroup = AppIdentity.appGroup
    static let fileName = "widget-state.json"

    /// The App Group container is the only place a sandboxed widget can read from —
    /// the extension's own Application Support points inside its private container,
    /// not at the app's. Verified: the entitlement alone is enough on Developer ID,
    /// no provisioning profile required.
    static var candidates: [URL] {
        guard let group = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroup
        ) else { return [] }
        return [group.appendingPathComponent(fileName)]
    }

    static func load() -> StateSnapshot {
        for url in candidates {
            guard let data = try? Data(contentsOf: url),
                  let snapshot = try? JSONDecoder().decode(StateSnapshot.self, from: data)
            else { continue }
            return snapshot
        }
        return .empty
    }
}

// MARK: - Timeline

struct StateEntry: TimelineEntry {
    let date: Date
    let snapshot: StateSnapshot
}

struct StateProvider: TimelineProvider {
    private static let preview = StateSnapshot(
        connected: true,
        rooms: [
            RoomSnapshot(
                id: "1", providerId: "preview", name: "Living Room",
                isOn: true, brightness: 72, lightCount: 4, controllable: true
            ),
            RoomSnapshot(
                id: "2", providerId: "preview", name: "Office",
                isOn: true, brightness: 45, lightCount: 1, controllable: true
            ),
            RoomSnapshot(
                id: "3", providerId: "preview", name: "Bedroom",
                isOn: false, brightness: 0, lightCount: 2, controllable: true
            ),
        ],
        lightsOn: 5,
        lightsTotal: 7
    )

    func placeholder(in context: Context) -> StateEntry {
        StateEntry(date: .now, snapshot: Self.preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (StateEntry) -> Void) {
        // The widget gallery shows a representative preview rather than an empty box.
        let snapshot = context.isPreview ? Self.preview : SnapshotStore.load()
        completion(StateEntry(date: .now, snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StateEntry>) -> Void) {
        Task {
            // Asking the bridge directly is what keeps the widget honest while the
            // app is closed; the app's snapshot is the fallback when it is not.
            let snapshot = await LightingClients.fetchSnapshot()
            let entry = StateEntry(date: .now, snapshot: snapshot)
            // WidgetKit throttles refreshes to its own budget, so asking for a
            // minute yields a few. Tapping a toggle reloads immediately regardless.
            let next = Calendar.current.date(byAdding: .minute, value: 1, to: .now) ?? .now
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Intents
//
// The system reloads the timeline once perform() returns, so the widget picks up
// the real post-command state from the bridge instead of guessing at it.

struct ToggleRoomIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle room"

    // The defaults matter: without them AppIntents cannot rebuild the parameter
    // from the archived widget view and perform() is never reached.
    @Parameter(title: "Room", default: "") var roomId: String
    @Parameter(title: "Hub", default: "") var providerId: String
    @Parameter(title: "On", default: false) var on: Bool

    init() {}

    init(providerId: String, roomId: String, on: Bool) {
        self.providerId = providerId
        self.roomId = roomId
        self.on = on
    }

    func perform() async throws -> some IntentResult {
        try await LightingClients.setRoomPower(providerId: providerId, roomId: roomId, on: on)
        return .result()
    }
}

struct ToggleAllIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle all lights"

    @Parameter(title: "On", default: false) var on: Bool

    init() {}

    init(on: Bool) { self.on = on }

    func perform() async throws -> some IntentResult {
        try await LightingClients.setAllPower(on: on)
        return .result()
    }
}

// MARK: - Views

private let accent = Color(red: 1.0, green: 0.58, blue: 0.20)

struct DisconnectedView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "lightbulb.slash")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(.secondary)
            Text("No connection")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SmallView: View {
    let snapshot: StateSnapshot

    var body: some View {
        // The whole tile is the master switch: anything lit means the tap turns
        // everything off, otherwise it turns everything on.
        Button(intent: ToggleAllIntent(on: snapshot.lightsOn == 0)) {
            content
        }
        .buttonStyle(.plain)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: snapshot.lightsOn > 0 ? "lightbulb.fill" : "lightbulb")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(snapshot.lightsOn > 0 ? accent : Color.secondary)
            Spacer(minLength: 6)
            Text("\(snapshot.lightsOn)")
                .font(.system(size: 40, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
                + Text("/\(snapshot.lightsTotal)")
                .font(.system(size: 20, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
            Text(snapshot.lightsOn == 1 ? "light on" : "lights on")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct RoomRow: View {
    let room: RoomSnapshot

    var body: some View {
        HStack(spacing: 8) {
            Text(room.name)
                .font(.system(size: 12, weight: .medium))
                .lineLimit(1)

            Spacer(minLength: 4)

            if room.isOn {
                // A compact bar reads faster than a number at widget size.
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.2))
                        Capsule()
                            .fill(accent)
                            .frame(width: max(3, geo.size.width * CGFloat(room.brightness) / 100))
                    }
                }
                .frame(width: 38, height: 4)

                Text("\(room.brightness)%")
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, alignment: .trailing)
            } else {
                Spacer().frame(width: 74)
            }

            // The dot doubles as the switch — a full Toggle does not fit four
            // rooms into a medium widget, and the tap target is still 22pt.
            // Without a credential for that hub it is only an indicator: a
            // button that could not possibly work is worse than none.
            if room.controllable {
                Button(
                    intent: ToggleRoomIntent(
                        providerId: room.providerId, roomId: room.id, on: !room.isOn
                    )
                ) {
                    bulb
                }
                .buttonStyle(.plain)
            } else {
                bulb.opacity(0.55)
            }
        }
    }
}

extension RoomRow {
    private var bulb: some View {
        Image(systemName: room.isOn ? "lightbulb.fill" : "lightbulb")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(room.isOn ? accent : Color.secondary)
            .frame(width: 22, height: 22)
            .background(Circle().fill(Color.secondary.opacity(room.isOn ? 0.18 : 0.10)))
    }
}

struct MediumView: View {
    let snapshot: StateSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(accent)
                Text(AppIdentity.productName)
                    .font(.system(size: 11, weight: .semibold))
                Spacer()
                Text("\(snapshot.lightsOn)/\(snapshot.lightsTotal)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if snapshot.rooms.isEmpty {
                Spacer()
                Text("No rooms")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(snapshot.rooms.prefix(4)) { RoomRow(room: $0) }
                if snapshot.rooms.count > 4 {
                    Text("+\(snapshot.rooms.count - 4) more")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct LumenWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: StateEntry

    var body: some View {
        Group {
            if !entry.snapshot.connected {
                DisconnectedView()
            } else if family == .systemSmall {
                SmallView(snapshot: entry.snapshot)
            } else {
                MediumView(snapshot: entry.snapshot)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

// MARK: - Widget

struct LumenWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: AppIdentity.widgetKind, provider: StateProvider()) { entry in
            LumenWidgetView(entry: entry)
        }
        .configurationDisplayName(AppIdentity.productName)
        .description("The state of the lighting in your home.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct LumenWidgetBundle: WidgetBundle {
    var body: some Widget { LumenWidget() }
}
