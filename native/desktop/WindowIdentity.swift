import Cocoa
import ApplicationServices

// Optional macOS SPI: never infer an AX window's identity from its title or bounds.
// Resolve dynamically so unavailable/changed implementations fail closed.
private typealias WindowIDFunction = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError
private let windowIDFunction: WindowIDFunction? = {
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "_AXUIElementGetWindow") else { return nil }
    return unsafeBitCast(symbol, to: WindowIDFunction.self)
}()
let exactWindowIdentityAvailable = windowIDFunction != nil

func windowID(_ element: AXUIElement) -> CGWindowID? {
    var id: CGWindowID = 0
    guard let function = windowIDFunction, function(element, &id) == .success, id != 0 else { return nil }
    return id
}
func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
          let value = value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func enclosingWindow(_ element: AXUIElement) -> AXUIElement? {
    var role: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role) == .success,
       role as? String == kAXWindowRole { return element }
    return axElement(element, kAXWindowAttribute)
}
func axWindow(_ w: [String: Any]) -> AXUIElement {
    guard exactWindowIdentityAvailable else { fail("Exact window identity is unavailable on this macOS version; desktop actions are disabled") }
    let app = AXUIElementCreateApplication(Int32(number(w, "pid")))
    AXUIElementSetMessagingTimeout(app, 0.5)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let items = value as? [AXUIElement], let id = UInt32(w["id"] as? String ?? "") else { fail("Cannot access target window; grant Accessibility") }
    let matches = items.filter { windowID($0) == id }
    guard matches.count == 1 else { fail("Cannot establish exact target window identity; take a fresh screenshot") }
    AXUIElementSetMessagingTimeout(matches[0], 0.5)
    return matches[0]
}
var lastFocusFailure = "unknown"
func hasTargetFocus(_ ax: AXUIElement, _ pid: Int32, requireInput: Bool = false) -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { lastFocusFailure = "foreground process differs"; return false }
    let app = AXUIElementCreateApplication(pid)
    guard let focused = axElement(app, kAXFocusedWindowAttribute), CFEqual(focused, ax) else { lastFocusFailure = "focused window differs"; return false }
    // Sheets and other separate input surfaces must not receive the parent window's text.
    if let element = axElement(app, kAXFocusedUIElementAttribute) {
        guard let owner = enclosingWindow(element), CFEqual(owner, ax) else { lastFocusFailure = "focused control belongs to another or unknown window"; return false }
        if requireInput {
            var isFocused: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXFocusedAttribute as CFString, &isFocused) == .success,
               let focused = isFocused as? Bool, !focused { lastFocusFailure = "control is not focused"; return false }
        }
    } else if requireInput { lastFocusFailure = "no focused control"; return false }
    var sheets: CFTypeRef?
    if AXUIElementCopyAttributeValue(ax, kAXChildrenAttribute as CFString, &sheets) == .success,
       let items = sheets as? [AXUIElement], items.contains(where: { child in
           var role: CFTypeRef?
           return AXUIElementCopyAttributeValue(child, kAXRoleAttribute as CFString, &role) == .success && role as? String == kAXSheetRole
       }) { lastFocusFailure = "attached sheet"; return false }
    if hasModalSurface(ax) || hasAppModalWindow(pid) { lastFocusFailure = "modal surface"; return false }
    return true
}
func requireTargetFocus(_ ax: AXUIElement, _ w: [String: Any], input: Bool = false) {
    guard windowID(ax).map(String.init) == w["id"] as? String,
          hasTargetFocus(ax, Int32(number(w, "pid")), requireInput: input) else { fail("Target window lost keyboard focus or has a dialog (\(lastFocusFailure)); take a fresh screenshot") }
}
func requireTargetAtPoint(_ ax: AXUIElement, _ point: CGPoint) {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 0.5)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
          let hit = hit, let owner = enclosingWindow(hit), CFEqual(owner, ax) else {
        fail("Target point is covered or cannot be identified; take a fresh screenshot")
    }
}
func requireExpectedBounds(_ w: [String: Any], _ args: [String: Any]) {
    guard let expected = args["expectedBounds"] as? [String: Any], let bounds = w["bounds"] as? [String: Any] else {
        fail("Coordinate actions require the observed window bounds")
    }
    guard ["x", "y", "width", "height"].allSatisfy({ abs(number(bounds, $0) - number(expected, $0)) < 0.5 }) else {
        fail("Window moved. Take a fresh screenshot before acting.")
    }
}

// Some apps expose tab-modal dialogs as groups, not AXSheet/AXWindow objects.
// Inspect native chrome only; do not walk the page's potentially huge DOM tree.
func hasModalSurface(_ window: AXUIElement) -> Bool {
    var pending: [(AXUIElement, Int)] = [(window, 0)]
    var count = 0
    while let (element, depth) = pending.popLast() {
        count += 1
        if count > 512 { return true }
        var role: CFTypeRef?, subrole: CFTypeRef?, modal: CFTypeRef?, identifier: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
        AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole)
        AXUIElementCopyAttributeValue(element, kAXModalAttribute as CFString, &modal)
        AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identifier)
        if role as? String == kAXSheetRole || subrole as? String == kAXDialogSubrole ||
           modal as? Bool == true || identifier as? String == "AXSafariModalDialog" { return true }
        if role as? String == "AXWebArea" || depth >= 6 { continue }
        var children: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
           let items = children as? [AXUIElement] { pending += items.map { ($0, depth + 1) } }
    }
    return false
}

// Chromium may expose its tab-modal dialog as a sibling AX window. Raising the
// parent first can hide that evidence, so inspect sibling roots before activation.
func hasAppModalWindow(_ pid: Int32) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let items = value as? [AXUIElement] else { return true }
    let visible = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let visibleIDs = Set(visible.compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value })
    for item in items {
        if let id = windowID(item), !visibleIDs.contains(id) { continue }
        var modal: CFTypeRef?, role: CFTypeRef?, subrole: CFTypeRef?
        AXUIElementCopyAttributeValue(item, kAXModalAttribute as CFString, &modal)
        AXUIElementCopyAttributeValue(item, kAXRoleAttribute as CFString, &role)
        AXUIElementCopyAttributeValue(item, kAXSubroleAttribute as CFString, &subrole)
        // Chrome's web-modal host is AXUnknown with AXModal=false. Its titlebar
        // controls are separate, non-modal AXDialog windows and must not block.
        if modal as? Bool == true || role as? String == kAXSheetRole || subrole as? String == kAXUnknownSubrole { return true }
    }
    return false
}

// Prefer the public text-selection API for cmd+a in editable controls. A
// successful event post alone does not prove that an app selected any text.
func selectAllEditableText(_ window: AXUIElement, _ pid: Int32) -> Bool {
    guard let element = axElement(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute),
          let owner = enclosingWindow(element), CFEqual(owner, window) else { return false }
    var role: CFTypeRef?, value: CFTypeRef?, settable: DarwinBoolean = false
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    guard [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole].contains(role as? String ?? ""),
          AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
          let text = value as? String,
          AXUIElementIsAttributeSettable(element, kAXSelectedTextRangeAttribute as CFString, &settable) == .success,
          settable.boolValue else { return false }
    var range = CFRange(location: 0, length: text.utf16.count)
    guard let selection = AXValueCreate(.cfRange, &range),
          AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, selection) == .success else {
        fail("Cannot select the target text; observe the control again")
    }
    let deadline = Date().addingTimeInterval(0.3)
    repeat {
        var result: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &result) == .success,
           let result = result, CFGetTypeID(result) == AXValueGetTypeID() {
            var actual = CFRange(location: -1, length: -1)
            if AXValueGetValue(result as! AXValue, .cfRange, &actual), actual.location == 0, actual.length == range.length { return true }
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    } while Date() < deadline
    fail("Text selection was not confirmed; observe the control again")
}
