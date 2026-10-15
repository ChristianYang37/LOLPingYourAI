import Cocoa
import ApplicationServices

// SIGTERM cancels waits and the next input chunk; a key sequence already in
// flight finishes releasing its modifiers before checking again.
var cancellationRequested = false
signal(SIGTERM) { _ in cancellationRequested = true }

// Never inherit a user's held modifiers or re-trigger the ping input helper.
func postInput(_ event: CGEvent, flags: CGEventFlags = []) {
    event.flags = flags
    event.setIntegerValueField(.eventSourceUserData, value: 0x4C50494E)
    event.post(tap: .cghidEventTap)
    RunLoop.current.run(until: Date().addingTimeInterval(0.025))
}

func fail(_ message: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["error": message])
    print(String(data: data, encoding: .utf8)!); exit(1)
}
func number(_ d: [String: Any], _ key: String) -> Double { (d[key] as? NSNumber)?.doubleValue ?? 0 }
func windows(_ exclude: Int32) -> [[String: Any]] {
    let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return raw.compactMap { w in
        guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pid != exclude,
              (w[kCGWindowLayer as String] as? Int) == 0,
              let b = w[kCGWindowBounds as String] as? [String: Any], number(b, "Width") > 1, number(b, "Height") > 1,
              let id = w[kCGWindowNumber as String] as? NSNumber else { return nil }
        var result: [String: Any] = ["id": id.stringValue, "pid": pid, "app": w[kCGWindowOwnerName as String] ?? "", "title": w[kCGWindowName as String] ?? "", "bounds": ["x": number(b, "X"), "y": number(b, "Y"), "width": number(b, "Width"), "height": number(b, "Height")]]
        if let launched = NSRunningApplication(processIdentifier: pid)?.launchDate { result["processStartedAt"] = launched.timeIntervalSince1970 }
        return result
    }
}
let op = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "doctor"
let data = FileHandle.standardInput.readDataToEndOfFile()
let args = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
let exclude = Int32(number(args, "excludePid"))
var result: Any = ["ok": true]
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let locked = session?["CGSSessionScreenIsLocked"] as? Bool ?? false
if op == "doctor" {
    result = ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "locked": locked, "platform": "darwin", "exactWindowIdentity": exactWindowIdentityAvailable, "windowIdentityBackend": "macOS-AX-window-ID-SPI"]
} else if op == "cursor" {
    let p = CGEvent(source: nil)?.location ?? .zero; result = ["x": p.x, "y": p.y]
} else if op == "windows" { result = windows(exclude)
} else {
    guard !locked else { fail("Desktop is locked") }
    let all = windows(exclude)
    if op == "target" {
        let p = CGPoint(x: number(args, "x"), y: number(args, "y"))
        guard let w = all.first(where: { w in let b = w["bounds"] as! [String: Any]; return CGRect(x: number(b, "x"), y: number(b, "y"), width: number(b, "width"), height: number(b, "height")).contains(p) }) else { fail("No target window under this ping") }
        result = w
    } else {
        guard let id = args["id"] as? String, let w = all.first(where: { ($0["id"] as? String) == id && number($0, "pid") == number(args, "pid") }) else { fail("Target window closed or changed") }
        if let expected = args["processStartedAt"] as? NSNumber {
            guard let current = w["processStartedAt"] as? NSNumber, current == expected else { fail("Target process restarted; select the window again") }
        }
        if op == "resolve" { result = w }
        else {
            guard AXIsProcessTrusted() else { fail("Accessibility permission is required") }
            if op == "click" || op == "scroll" { requireExpectedBounds(w, args) }
            let ax = axWindow(w)
            guard !hasModalSurface(ax), !hasAppModalWindow(Int32(number(w, "pid"))) else { fail("Target window has a modal dialog; resolve it before continuing") }
            if !hasTargetFocus(ax, Int32(number(w, "pid"))) {
                let targetApp = NSRunningApplication(processIdentifier: Int32(number(w, "pid")))
                targetApp?.activate(options: [])
                guard AXUIElementPerformAction(ax, kAXRaiseAction as CFString) == .success else { fail("Cannot focus target window") }
            }
            // WebKit can publish the focused window before its input focus has settled.
            let needsInputFocus = op == "type" || op == "key"
            let requestedTree = needsInputFocus && requestInputAccessibility(ax, Int32(number(w, "pid")))
            let deadline = Date().addingTimeInterval(requestedTree ? 4.0 : 1.0)
            var stableSince: Date?
            repeat {
                guard !cancellationRequested else { fail("Desktop action cancelled") }
                if hasTargetFocus(ax, Int32(number(w, "pid")), requireInput: needsInputFocus) { if stableSince == nil { stableSince = Date() } }
                else { stableSince = nil }
                if let since = stableSince, Date().timeIntervalSince(since) >= 0.12 { break }
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
            } while Date() < deadline
            guard let since = stableSince, Date().timeIntervalSince(since) >= 0.12 else { fail("Target focus did not settle (\(lastFocusFailure)); click the intended control and observe again") }
            requireTargetFocus(ax, w, input: needsInputFocus)
            guard let fresh = windows(exclude).first(where: { ($0["id"] as? String) == w["id"] as? String && number($0, "pid") == number(w, "pid") }) else { fail("Target window closed or changed") }
            if op == "resize" {
                guard let b = args["bounds"] as? [String: Any] else { fail("Missing window bounds") }
                guard ["x", "y", "width", "height"].allSatisfy({ (b[$0] as? NSNumber)?.doubleValue.isFinite == true }),
                      number(b, "width") > 0, number(b, "height") > 0 else { fail("Invalid window bounds") }
                let original = fresh["bounds"] as! [String: Any]
                func actualBounds() -> [String: Any]? {
                    return windows(exclude).first(where: { ($0["id"] as? String) == id && number($0, "pid") == number(w, "pid") })?["bounds"] as? [String: Any]
                }
                func matches(_ a: [String: Any], _ b: [String: Any]) -> Bool {
                    return ["x", "y", "width", "height"].allSatisfy { abs(number(a, $0) - number(b, $0)) < 2 }
                }
                func reach(_ bounds: [String: Any]) -> Bool {
                    // Moving first avoids clipping a work-area-sized window at
                    // its old bottom/right position. Retry only a bounded number
                    // of times for apps that constrain a single AX resize.
                    for _ in 0..<3 {
                        requireTargetFocus(ax, w)
                        var point = CGPoint(x: number(bounds, "x"), y: number(bounds, "y"))
                        var size = CGSize(width: number(bounds, "width"), height: number(bounds, "height"))
                        let p = AXValueCreate(.cgPoint, &point)!, s = AXValueCreate(.cgSize, &size)!
                        // Restoring a large window to a bottom/right position
                        // needs the opposite first step: shrink in place, then
                        // move. Growing still happens only after the move.
                        guard let current = actualBounds() else { return false }
                        var intermediate = CGSize(width: min(number(current, "width"), size.width), height: min(number(current, "height"), size.height))
                        if intermediate.width < number(current, "width") || intermediate.height < number(current, "height") {
                            let small = AXValueCreate(.cgSize, &intermediate)!
                            if AXUIElementSetAttributeValue(ax, kAXSizeAttribute as CFString, small) != .success { return false }
                            RunLoop.current.run(until: Date().addingTimeInterval(0.08))
                            requireTargetFocus(ax, w)
                        }
                        if AXUIElementSetAttributeValue(ax, kAXPositionAttribute as CFString, p) != .success { return false }
                        RunLoop.current.run(until: Date().addingTimeInterval(0.08))
                        requireTargetFocus(ax, w)
                        if AXUIElementSetAttributeValue(ax, kAXSizeAttribute as CFString, s) != .success { return false }
                        let deadline = Date().addingTimeInterval(0.35)
                        var stable: Date?
                        repeat {
                            requireTargetFocus(ax, w)
                            guard let actual = actualBounds() else { return false }
                            if matches(actual, bounds) { if stable == nil { stable = Date() } } else { stable = nil }
                            if let stable = stable, Date().timeIntervalSince(stable) >= 0.08 { return true }
                            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
                        } while Date() < deadline
                    }
                    return false
                }
                if reach(b) { result = ["ok": true, "bounds": actualBounds() ?? b] }
                else {
                    let constrained = actualBounds() ?? [:]
                    // Do not continue moving a window after cancellation or loss
                    // of focus. The app retains the saved Restore bounds.
                    let restored = reach(original)
                    let detail: [String: Any] = ["requested": b, "constrained": constrained, "actual": actualBounds() ?? [:], "restored": restored]
                    let json = String(data: try! JSONSerialization.data(withJSONObject: detail, options: [.sortedKeys]), encoding: .utf8)!
                    fail("Window did not reach requested bounds (application constraint). \(json)")
                }
            } else if op == "click" || op == "scroll" {
                requireExpectedBounds(fresh, args)
                let p = CGPoint(x: number(args, "x"), y: number(args, "y")); let b = fresh["bounds"] as! [String: Any]
                guard CGRect(x: number(b, "x"), y: number(b, "y"), width: number(b, "width"), height: number(b, "height")).contains(p) else { fail("Action is outside the target window") }
                requireTargetAtPoint(ax, p)
                requireTargetFocus(ax, w, input: needsInputFocus)
                if op == "click" {
                    let right = (args["button"] as? String) == "right"
                    CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseDown : .leftMouseDown, mouseCursorPosition: p, mouseButton: right ? .right : .left)?.post(tap: .cghidEventTap)
                    CGEvent(mouseEventSource: nil, mouseType: right ? .rightMouseUp : .leftMouseUp, mouseCursorPosition: p, mouseButton: right ? .right : .left)?.post(tap: .cghidEventTap)
                } else {
                    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
                    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: Int32(max(-2000, min(2000, number(args, "delta")))), wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
                }
            } else if op == "type" {
                let text = Array((args["text"] as? String ?? "").utf16)
                guard text.count <= 10000 else { fail("Text is too long") }
                for start in stride(from: 0, to: text.count, by: 100) {
                    requireTargetFocus(ax, w, input: needsInputFocus)
                    let chunk = Array(text[start..<min(start + 100, text.count)])
                    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)!, up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)!
                    chunk.withUnsafeBufferPointer { down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress!); up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress!) }
                    postInput(down); postInput(up)
                }
            } else if op == "key" {
                let keys: [String: CGKeyCode] = ["a": 0, "c": 8, "v": 9, "z": 6, "s": 1, "f": 3, "return": 36, "escape": 53, "tab": 48, "backspace": 51, "left": 123, "right": 124, "down": 125, "up": 126, "plus": 24, "=": 24, "-": 27, "0": 29]
                let parts = (args["key"] as? String ?? "").lowercased().split(separator: "+").map(String.init)
                guard let last = parts.last, let code = keys[last] else { fail("Unsupported key") }
                let modifiers: [String: (CGKeyCode, CGEventFlags)] = ["cmd": (55, .maskCommand), "command": (55, .maskCommand), "super": (55, .maskCommand), "ctrl": (59, .maskControl), "control": (59, .maskControl), "shift": (56, .maskShift), "alt": (58, .maskAlternate), "option": (58, .maskAlternate)]
                var flags: CGEventFlags = []
                var held: [(CGKeyCode, CGEventFlags)] = []
                for name in parts.dropLast() {
                    guard let modifier = modifiers[name] else { fail("Unsupported key modifier") }
                    held.append(modifier)
                }
                requireTargetFocus(ax, w, input: needsInputFocus)
                let selectedWithAX = last == "a" && held.count == 1 && held[0].1 == .maskCommand && selectAllEditableText(ax, Int32(number(w, "pid")))
                result = ["ok": true, "inputBackend": selectedWithAX ? "accessibility" : "keyboard"]
                if !selectedWithAX {
                    for (key, flag) in held { flags.insert(flag); postInput(CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true)!, flags: flags) }
                    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)!
                    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)!
                    postInput(down, flags: flags)
                    postInput(up, flags: flags)
                    for (key, flag) in held.reversed() { flags.remove(flag); postInput(CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)!, flags: flags) }
                }

            } else { fail("Unknown desktop operation") }
        }
    }
}
RunLoop.current.run(until: Date().addingTimeInterval(0.08))
let output = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: output, encoding: .utf8)!)
