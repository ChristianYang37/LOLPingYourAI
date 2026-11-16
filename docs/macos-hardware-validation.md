# macOS physical display verification

On 2026-11-11, LOLPingYourAI v0.1.4 (commit `a79a9b4`) identified the disposable Test Board and captured its marker at the expected global position in all 12 placements. The largest difference between the renderer's geometry and the captured marker was 0.094 logical points. This exercise measured window targeting and capture geometry on two physical displays.

## Hardware and layout

macOS 27.0, Apple Silicon, Electron 44.5.1. Both displays used extended desktop mode. The figures below use macOS global logical points with the origin at the upper left of the primary display.

| Display | Origin | Logical size | Original backing scale | Mixed-DPI run |
| --- | --- | --- | --- | --- |
| External Mi Monitor, primary | (0, 0) | 2614 × 1094 | 2× | 1× |
| Built-in Retina, below primary | (535, 1094) | 1512 × 982 | 2× | 2× |

The external display provided a 1× mode with the same logical bounds. Electron's display scale and the board renderer's `devicePixelRatio` agreed for each case. The original display modes and bounds were restored and verified.

## Measured captures

Each row represents two independent captures of the same 680 × 520 point board, first centered in the display work area and then aligned to its bottom-right corner. Both placements returned an 88 × 40 point marker. Positions below are the measured marker's global top-left coordinates. Error is the largest absolute difference in x, y, width or height versus the board's DOM and native content bounds.

| Display configuration | Display | Button position in board | Centered board | Bottom-right board | Max. error (pt) |
| --- | --- | --- | --- | --- | --- |
| Original | External 2× | Normal document flow | (1007, 694) | (1974, 966) | 0.086 |
| Original | Built-in 2× | Normal document flow | (991, 1688) | (1407, 1858) | 0.086 |
| Mixed | External 1× | Normal document flow | (1007, 693) | (1974, 965) | 0.094 |
| Mixed | Built-in 2× | Normal document flow | (991, 1688) | (1407, 1858) | 0.086 |
| Mixed | External 1× | 6 pt from bottom and right | (1553, 776) | (2520, 1048) | 0 |
| Mixed | Built-in 2× | 6 pt from bottom and right | (1537, 1770) | (1953, 1940) | 0 |

In the mixed-DPI bottom-right placements, the requested 160 × 160 point square extended past the right edge of each display. The returned valid area was 152 × 106 points. On the external monitor its right and bottom edges were exactly the monitor's right and bottom edges. On the built-in display the bottom edge was the board's edge above the Dock.

## Reproducing the measurement

1. Build the native desktop helper and run the repository's disposable [Test Board](../tools/test-board.cjs) in Electron. Use a separate Electron main process for the controller. The project's native helper excludes its own process from window targeting.
2. Move the board with `BrowserWindow.setBounds`, first to the center of each display's work area, then flush to its lower-right corner. Re-read `getBounds()`, `getContentBounds()` and the board renderer's `devicePixelRatio` after each move. Configure mixed scaling in macOS and verify it in Electron before recording mixed-DPI cases.
3. In the fixture only, style its Reset button with `background: #10bd70; border: 0; border-radius: 0; width: 88px; height: 40px; padding: 0; box-shadow: none`. Use normal flow for the first pass. For the edge pass also set `position: fixed; right: 6px; bottom: 6px`. Measure the button with `getBoundingClientRect()` and add the content origin to obtain its expected global rectangle.
4. Use the point 22 points right and 20 points below the button's top-left. Call [Desktop.locate](../ai/desktop.mjs) and verify its PID and native window ID match the board manifest. Call `Desktop.capture(target, 160, true)` with the tracked board identity and the point expressed relative to its native bounds. The controller used the repository's capture and image code, Electron's real window source and the packaged helper from the same build. The fixture's overlay wrapper invoked the capture callback directly.
5. In the returned PNG select green pixels with `G >= 145 && G - R >= 65 && G - B >= 40`. This tolerates the two displays' different color profiles. Add the returned region origin to the green pixels' bounding box and compare it with the independently measured DOM rectangle. For example, the edge-marker run on the external 1× display detected the top-left at (2520, 1048), width 88, height 40.

## Native clicks through the installed app

After Screen Recording and Accessibility were both enabled for the installed v0.1.4 app, the same Test Board received one trusted left click on each physical display. The external display used 1× and the built-in display used 2×. Positions are in global logical points.

| Display | Requested point | Board event screenX, screenY | Trusted clicks | Note after click |
| --- | --- | --- | --- | --- |
| External Mi Monitor, 1× | (1597, 796) | (1597, 796) | 1 | Ready for a ping. |
| Built-in Retina, 2× | (1581, 1790) | (1581, 1790) | 1 | Ready for a ping. |

Each case started with the note set to “Pending hardware click” and a zero click count. A separate profile of the installed app accepted an Assist ping targeting the board’s window ID and PID and captured at the expected display scale. A test client sent one `desktop_action` through the installed MCP server, using the new ping context and the measured center of the Reset note button. Both renderer events reported `isTrusted=true`, button 0 and board-local position (630, 462). The button’s normal handler reset the note. A local provider fixture held the turn open while the client issued the action. This measured native input delivery; model selection of coordinates and the branch’s experimental Codex tool were outside this run.

The Test Board and disposable app instance exited. A before/after comparison confirmed the original display modes, positions, refresh rates and mirroring were restored. Physical wheel gestures, maximize/restore and displays with negative coordinates remain [manual acceptance cases](acceptance.md).

## Session lock and wake

The v0.1.4 installed desktop helper reported the session locked at 14:02:29 HKT. A disposable ward made due during the lock remained pending with zero visits. The macOS power log recorded clamshell sleep (DarkWake) at 14:02:38 and full wake at 14:02:50. The helper reported unlock at 14:03:05. At 14:03:06 the ward ran once. A second scheduler tick and a new scheduler instance reading the same store still reported one visit and a completed ward at 14:03:08.

This run exercised the installed `Desktop.available()`, `Wards.tick()`, and persisted store against a real session transition. The visit callback counted executions. It did not contact a model or inject desktop input. The ward was made due immediately to test recovery; this did not exercise the 30-minute timer.

## Cancelling in-flight typing

A disposable Test Board received real macOS typing from the installed v0.1.4 project helper. Its Codex App Server used a local provider fixture. The test requested 9,600 neutral characters, queued a second input, then sent Retreat after observing a strict prefix in the focused text area.

The board contained 600 characters at the last sample before Retreat and 800 when the stop request returned 77 ms later. After another 1.5 seconds it still contained 800 characters and the same eight trusted input events. The active action returned a cancellation error. The queued action and an action sent after confirmation were both rejected. Codex reported the turn interrupted and the service was idle. These measurements cover the project's macOS input helper.

## Bundled Codex Computer Use cancellation

A separate opt-in test used the real `cua_repl` backend advertised by Codex CLI 0.167.0-alpha.3.2. A disposable AppKit application owned a single window with a focused text field. The tester approved Computer Use for that application. A client on an ephemeral App Server thread sent one native `app.typeText` call per character through the shared ActionGate. The AppKit field recorded each edit independently.

The client planned 36 characters. The board recorded the first character while its native call was still outstanding. Retreat revoked the gate and waited for the original call to return before the service reported stopped. This was also reproduced using the teammate service's normal Assist, desktop action and Retreat entry points. Only one character was dispatched. The queued and subsequent requests were rejected, and the board still contained exactly that character and one edit 1.5 seconds later.

This test exercises host-controlled cancellation at native action boundaries. An operation already sent can finish before Stop is acknowledged. The fixture guarantees its own window identity by construction. The tested macOS vendor API selects an app and types into its current focus, so this result does not establish window-scoped operation for general applications.

To reproduce, run `node tools/macos/check-native-cua-cancel.mjs` from the checkout in an interactive macOS terminal with Swift, Codex CLI and its Computer Use plugin available. The script builds a temporary single-window AppKit app, prompts for access to that app and observes its text independently. It uses a local fixture for the teammate conversation and the bundled backend for keyboard input.
