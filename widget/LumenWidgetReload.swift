import Foundation
import WidgetKit

/// Tiny helper shipped inside the app bundle: the Electron main process cannot
/// call WidgetKit, so it spawns this to tell the system that new state is
/// available. Living in Contents/MacOS means the call is attributed to the app.
///
/// The reload request is delivered asynchronously over XPC, so the process has to
/// outlive the call — exiting immediately drops it on the floor and the widget
/// silently keeps showing stale data.
let done = DispatchSemaphore(value: 0)
WidgetCenter.shared.reloadAllTimelines()
DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { done.signal() }
done.wait()
