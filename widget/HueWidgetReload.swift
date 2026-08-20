import WidgetKit

/// Tiny helper shipped inside the app bundle: the Electron main process cannot
/// call WidgetKit, so it spawns this to tell the system that new state is
/// available. Living in Contents/MacOS means the call is attributed to the app.
WidgetCenter.shared.reloadAllTimelines()
