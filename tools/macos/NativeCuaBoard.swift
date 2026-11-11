import AppKit

final class Board: NSObject, NSApplicationDelegate, NSTextViewDelegate {
    let stateFile: URL
    let title: String
    var window: NSWindow!
    var editor: NSTextView!
    var events = 0

    init(_ path: String, _ title: String) {
        self.stateFile = URL(fileURLWithPath: path)
        self.title = title
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 400, height: 140),
                          styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = title
        editor = NSTextView(frame: NSRect(x: 20, y: 20, width: 360, height: 100))
        editor.delegate = self
        editor.isRichText = false
        editor.isAutomaticQuoteSubstitutionEnabled = false
        editor.isAutomaticTextCompletionEnabled = false
        editor.setAccessibilityLabel(title + " note")
        editor.font = NSFont.systemFont(ofSize: 22)
        window.contentView?.addSubview(editor)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(editor)
        NSApp.activate(ignoringOtherApps: true)
        save()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func textDidChange(_ notification: Notification) {
        events += 1
        save()
    }

    func save() {
        let data: [String: Any] = [
            "title": title, "pid": ProcessInfo.processInfo.processIdentifier,
            "bundle": Bundle.main.bundleIdentifier ?? "", "window": window.windowNumber,
            "windows": NSApp.windows.filter { $0.isVisible && $0.canBecomeKey }.count,
            "events": events, "text": editor.string
        ]
        guard let encoded = try? JSONSerialization.data(withJSONObject: data) else { return }
        try? encoded.write(to: stateFile, options: .atomic)
    }
}

guard CommandLine.arguments.count == 3 else { exit(2) }
let board = Board(CommandLine.arguments[1], CommandLine.arguments[2])
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.delegate = board
app.run()
