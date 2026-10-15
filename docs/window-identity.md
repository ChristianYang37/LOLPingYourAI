# macOS window identity / 窗口定位设计

## What was wrong / 原因

A ping already selected a Core Graphics window ID and owner PID in front-to-back order. The old action helper then discarded that distinction when finding the Accessibility window: it compared only position and size. Two windows from one application could therefore be ambiguous even when the original ID was correct. Checking only the foreground PID also failed to establish which window would receive keyboard input.

原来的问题发生在“已选中窗口 → 找到可操作的无障碍窗口”这一段。同一进程可以有多个同位置、同尺寸窗口；进程正确不等于输入窗口正确。

## Current source implementation / 本次实现

- Preserve `CGWindowID`, PID and, when available, the process launch timestamp through capture, queued pings, wards and action dispatch. Reject a mismatching launch timestamp. Old saved contexts lacking this field retain ID/PID checks.
- Dynamically resolve `_AXUIElementGetWindow` to match the Accessibility window by its exact Core Graphics ID. This is a **private macOS SPI**, not an Apple-supported public API. Reject missing symbols, errors, zero IDs and non-unique matches. Do not fall back to choosing by title or bounds.
- Activate/raise only when the target is not already focused, then require 120 ms of stable foreground process and exact AX window identity. Keyboard input also requires an owned focused control. Recheck focus before each text chunk.
- Reject native modal surfaces before raising the parent: attached sheets, Safari tab-modal groups, and visible Chromium sibling windows with unknown subroles. Scan native chrome with bounded traversal, excluding web content. A visible unknown sibling conservatively blocks the whole app; this may refuse legitimate panels.
- For `cmd+a` in supported editable AX controls, set and read back the UTF-16 selection range through public Accessibility APIs. Other controls retain the keyboard path; an event being posted is not proof that the app applied it.
- Apply resize before position, then verify the resulting window bounds. If an app enforces minimum dimensions, return an error with a request to observe again, rather than report a successful resize. A rejected resize may have partially changed the window.
- For coordinate actions, pass observed bounds into the helper and revalidate them before and after activation. Use system-wide AX hit testing immediately before input; reject a covering window or an unidentified hit.
- Re-resolve a window after movement. Closing/recreating it never transfers an old action to a new same-title window. Saved restore bounds also include the process launch timestamp.
- Keep these rules in the desktop helper; the skill and model do not have to infer window identity.

`doctor.exactWindowIdentity` reports symbol availability only. It does **not** establish permission, support for every app, or successful matching of any particular window.

## Alternatives / 是否有更鲁棒的方案

| Approach | Advantage | Limitation | Decision |
| --- | --- | --- | --- |
| PID + title + rectangle | Small implementation | Identical windows remain ambiguous; mutable metadata | Reject as an identity authority |
| Exact ID bridge + public focus/hit checks | Fits the single-shot helper; distinguishes identical windows | Private SPI may change or be absent | Current guarded implementation; fail closed |
| Public AX hit test at ping + retained AX object in a native broker | Avoids the private ID bridge; tracks the same object as it moves | Needs a long-lived process, authenticated handle registry, restart invalidation and a carefully verified CG screenshot association | Candidate for a later native-backend revision; not implemented/tested |
| App/DOM API or direct AX control action | Targets a semantic control; can avoid global mouse/keyboard races | Coverage and semantics differ by app/control | Prefer when the harness already supports it; not a universal window backend |

No method dominates every dimension. A retained public-AX broker is preferable for reducing private-API compatibility risk, but adds lifecycle state and does not make global input atomic. Exact matching plus conservative refusal is the smallest fix for the demonstrated bug.

## Boundaries / 不能保证的情况

- Global input is not an atomic “send to this window” transaction. A focus or layout change in the narrow interval after verification can still race the event. Revalidation reduces that interval; it does not mathematically eliminate it.
- This revision keeps the existing layer-0 ping window selection. System menus, floating panels, other Spaces, minimized windows, secure fields and apps with incomplete Accessibility support may be refused. It does not claim universal control of those surfaces.
- Unsupported or indeterminate state stops the action and requests a fresh observation. It must not silently choose a similarly named/sized window.
- Process birth markers defend against PID reuse when supplied; they do not identify a document/tab inside an unchanged window. A new tab or page still requires the agent to observe current content.

## Repeatable tests / 复测

Build and run the isolated fixture using the repository's installed Node and Electron:

```sh
node native/desktop/build.mjs
node --test ai/test/desktop.test.mjs
open -n node_modules/electron/dist/Electron.app --args "$PWD/tools/window-identity-test/main.cjs"
```

The fixture has a permission button and a **Run tests** button. macOS must grant Accessibility to **Electron**, separately from the installed LOLPingYourAI app. It does not start the global ping input helper. It creates/edits only its own disposable windows and closes them after each run. Results are written to ignored `.local/window-identity-test/report.json`. No API key or model call is needed.

The suite checks overlapping equal-title windows, topmost selection, repeated exact-window typing while the other window is focused, stale/fresh coordinates after movement, resize constraints, a wrong process birth marker, a floating obstruction, a modal dialog and a closed/recreated window. Read the actual report; the presence of a test is not evidence that it passed.

### Live results, 2026-10-15 / 本机实测

Environment: Apple Silicon, macOS 26.4 (25E246), Safari 26.4, Chrome 155.0.8059.41, Electron 44.5.1. The production helper performed real CG/AX actions. The tests used disposable windows, independent textarea-content checks, and no model/API calls.

| Application | Completed regression |
| --- | --- |
| Electron | **10/10 cases**: identical PID/title/rectangle, frontmost ping selection, explicit background-window targeting, 10 alternating input rounds, stale/fresh coordinates, constrained resize, forged process marker, floating obstruction, modal dialog, closed/recreated window |
| Chrome | **30 alternating edits** between same-title, same-position, same-size windows; each edit checked both the target value and that the other value was unchanged. Moved-window stale clicks rejected; refreshed clicks succeeded; original text restored. Modal typing/Return rejected before activation; closing the dialog revealed no queued text. Closed-window ID rejected. |
| Safari | **10 alternating edits on the final helper**, checking both windows after every edit; AX selection backend asserted. Stale/fresh movement checks and text restoration passed. Tab-modal typing/Return rejected; text unchanged after dialog closure. Closed-window ID rejected. An earlier run also checked a newly created replacement window. |

Real-app testing found and addressed three additional issues: resize could silently miss the requested position, browser modal dialogs were not always AX sheets, and synthetic `cmd+a` could intermittently leave old text selected incorrectly or unselected. Selection now uses verified AX ranges when supported. Raising an already focused window is also avoided to preserve control state.

Not every attempted run passed. Earlier runs exposed the issues above; other attempts stopped on a changed foreground process. One final Safari attempt safely refused input on a changed focus before a complete 10-round rerun passed. Its exact focus-transition cause was not established; a successful rerun does not establish zero transient refusals. No check was disabled to obtain the successful runs. A refusal requires re-observation; the helper does not automatically retry input.

本轮已覆盖 Electron、Safari 和 Chrome 的真实窗口，重点验证“同应用、同标题、同尺寸、同位置仍然不串窗”。测试期间也出现过焦点变化导致的拒绝；这是需要重新观察的情况，不能宣传为所有应用永不失败。测试后恢复了浏览器文本并关闭临时窗口。

### Reproduce browser checks / 浏览器复测

`tools/window-identity-test/real-app.cjs` is an opt-in test host. Launch it with the same Electron command above, replacing `main.cjs` with `real-app.cjs`. It serves disposable textarea/alert pages at `http://127.0.0.1:8766/A` and `/B`. Open them in **two new windows** of the browser under test. It never starts the ping hook or calls an AI provider.

The host accepts jobs only through ignored `.local/real-app-test/job.json`: `{ "id": "unique-job-id", "op": "bind", "args": { "id": "CGWindowID", "pid": 123 } }`. Obtain IDs with the read-only `windows` operation and independently identify the disposable windows. Binding is an explicit test-operator responsibility; do not bind personal windows. Subsequent jobs use native operation names (`resolve`, `resize`, `click`, `key`, `type`) and the same window identity. Wait for the matching job ID in `result.json` before submitting another. The HTTP endpoint accepts fixture telemetry only, never desktop commands.

Make the two windows' actual bounds identical; alternate click → `cmd+a` → type and compare **both** textarea values in the UI and `events.jsonl`. Move a window and verify stale bounds are rejected; resolve fresh bounds and verify input. Open each browser's alert, attempt type/Return, then close it manually and verify that no delayed input appears. Close a window and verify its old ID is refused. Restore the initial textarea values, close only test windows, and quit the host. Private reports and local window identifiers remain under `.local/` and are not committed.

### Scope of evidence / 证据边界

- In the isolated PR checkout: 34 AI tests passed, including five desktop tests; TypeScript checking passed. Vitest had 702 passes and one skip before the hook helper was built; the seven prerequisite-dependent cases then all passed after building it (709 passed total, one skipped). Swift/C++ builds, the production Electron build, Apple Silicon DMG packaging and strict deep app-signature verification passed. No installed app was launched from the new package and no SHA-256 check was performed.
- Live tests did not need screenshots; the test host had Accessibility enabled and Screen Recording disabled. Screenshot/Retina/negative-coordinate coverage here comes from the existing automated tests, not new multi-display hardware testing.
- The process-restart guard used a deliberately wrong birth marker, not an actual OS PID-reuse event.
- Other apps, macOS releases, Spaces transitions, secure fields, Windows, and the remaining global-input race are not covered by this live matrix. The optional private SPI remains a compatibility dependency.
- The installed app and existing DMG were not replaced or re-signed during this verification.

## References

- [Apple: system-wide AX hit testing uses window z-order](https://developer.apple.com/documentation/applicationservices/1462077-axuielementcopyelementatposition)
- [Apple: the application's focused window](https://developer.apple.com/documentation/applicationservices/kaxfocusedwindowattribute)
- [Apple: AXRaise action](https://developer.apple.com/documentation/applicationservices/kaxraiseaction)
- [Apple: CGWindowID](https://developer.apple.com/documentation/coregraphics/cgwindowid)

The SPI is deliberately not represented as part of that documented public contract.
