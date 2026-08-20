import SwiftUI
import WidgetKit

// MARK: - Shared snapshot
//
// The Electron app writes this file whenever light state changes; the widget only
// ever reads it. Keeping the widget out of the network path means it never needs
// the Hue application key, which stays in the app's Keychain-backed storage.

struct RoomSnapshot: Codable, Identifiable {
    let id: String
    let name: String
    let isOn: Bool
    let brightness: Int
    let lightCount: Int
}

struct HueSnapshot: Codable {
    let connected: Bool
    let rooms: [RoomSnapshot]
    let lightsOn: Int
    let lightsTotal: Int

    static let empty = HueSnapshot(connected: false, rooms: [], lightsOn: 0, lightsTotal: 0)
}

enum SnapshotStore {
    /// macOS App Groups are prefixed with the Team ID (iOS uses "group."). Change
    /// this alongside the Team ID in build-widget.sh when forking.
    static let appGroup = "H2X8YGN869.com.bartlomiejzimny.huedesktop"
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

    static func load() -> HueSnapshot {
        for url in candidates {
            guard let data = try? Data(contentsOf: url),
                  let snapshot = try? JSONDecoder().decode(HueSnapshot.self, from: data)
            else { continue }
            return snapshot
        }
        return .empty
    }
}

// MARK: - Timeline

struct HueEntry: TimelineEntry {
    let date: Date
    let snapshot: HueSnapshot
}

struct HueProvider: TimelineProvider {
    private static let preview = HueSnapshot(
        connected: true,
        rooms: [
            RoomSnapshot(id: "1", name: "Salon", isOn: true, brightness: 72, lightCount: 4),
            RoomSnapshot(id: "2", name: "Biuro", isOn: true, brightness: 45, lightCount: 1),
            RoomSnapshot(id: "3", name: "Sypialnia", isOn: false, brightness: 0, lightCount: 2),
        ],
        lightsOn: 5,
        lightsTotal: 7
    )

    func placeholder(in context: Context) -> HueEntry {
        HueEntry(date: .now, snapshot: Self.preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (HueEntry) -> Void) {
        // The widget gallery shows a representative preview rather than an empty box.
        let snapshot = context.isPreview ? Self.preview : SnapshotStore.load()
        completion(HueEntry(date: .now, snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HueEntry>) -> Void) {
        let entry = HueEntry(date: .now, snapshot: SnapshotStore.load())
        // The timeline is the only reliable refresh path. WidgetCenter.reloadAllTimelines()
        // is ignored when called from the bundled helper process rather than from the app
        // itself, so a short interval is what actually keeps the widget current. WidgetKit
        // throttles this to its own budget; asking for a minute yields a few minutes.
        let next = Calendar.current.date(byAdding: .minute, value: 1, to: .now) ?? .now
        completion(Timeline(entries: [entry], policy: .after(next)))
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
            Text("Brak połączenia")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SmallView: View {
    let snapshot: HueSnapshot

    var body: some View {
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
            Text(snapshot.lightsOn == 1 ? "lampa włączona" : "lamp włączonych")
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
            Circle()
                .fill(room.isOn ? accent : Color.secondary.opacity(0.35))
                .frame(width: 7, height: 7)

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
                .frame(width: 42, height: 4)

                Text("\(room.brightness)%")
                    .font(.system(size: 10, weight: .regular, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(width: 30, alignment: .trailing)
            } else {
                Text("Wył.")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .frame(width: 76, alignment: .trailing)
            }
        }
    }
}

struct MediumView: View {
    let snapshot: HueSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(accent)
                Text("Hue Desktop")
                    .font(.system(size: 11, weight: .semibold))
                Spacer()
                Text("\(snapshot.lightsOn)/\(snapshot.lightsTotal)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            if snapshot.rooms.isEmpty {
                Spacer()
                Text("Brak pokoi")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                Spacer()
            } else {
                ForEach(snapshot.rooms.prefix(4)) { RoomRow(room: $0) }
                if snapshot.rooms.count > 4 {
                    Text("+\(snapshot.rooms.count - 4) więcej")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct HueWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: HueEntry

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

struct HueWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "HueDesktopStatus", provider: HueProvider()) { entry in
            HueWidgetView(entry: entry)
        }
        .configurationDisplayName("Hue Desktop")
        .description("Stan oświetlenia Philips Hue w Twoim domu.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct HueWidgetBundle: WidgetBundle {
    var body: some Widget { HueWidget() }
}
