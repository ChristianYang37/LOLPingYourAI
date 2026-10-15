# Windows build and verification — 2026-10-16

This release starts from official main `aae1f581af9eece9113637263672dc078701b27a` (PR #11). It does not merge the divergent portable fork. The supported installer target is Windows x64; no ARM64 or portable installer is claimed.

## Build

Use Node 22 or 24, pnpm 10, Visual Studio 2022 or newer with Desktop development with C++, and the Windows .NET Framework C# compiler. C++20 is retained. `/utf-8` avoids system-code-page-dependent compilation and `/Zc:preprocessor` fixes MSVC's legacy raw-string macro stringification. The build rejects pre-2022 toolchains instead of silently ignoring `/std:c++20`.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm typecheck
pnpm test:helper
pnpm build:desktop
pnpm test
pnpm test:acceptance
pnpm test:windows
pnpm build
pnpm exec electron tools/check-chat-ui.cjs
pnpm exec electron tools/check-agent-pings.cjs
pnpm exec electron-builder --win --publish never
node tools/check-packaged-runtime.cjs release
pnpm test:packaged
./tools/windows/check-installer.ps1 -Installer release/LOLPingYourAI-Setup-0.1.2.exe
```

Run each command separately and check its exit status. Native regressions require an unlocked, interactive desktop and operate only on disposable fixture windows. The installer regression requires an account without a registered LOLPingYourAI install; it refuses to replace an existing installation. It installs to a temporary path containing spaces and removes only that test installation.

`LOLPINGAI_DATA_DIR` now selects both application data and Chromium userData/instance-lock storage. Use an absolute private test directory to isolate acceptance from normal `%APPDATA%\LOLPingYourAI`. Only run one input-hook instance at a time even with different profiles. Keep `.local/` evidence private; it contains session metadata and can contain model output or captures.

## Repairs and native verification

Local hardware: Windows 10 Home x64, build 19045; Node 24.15.0; Electron 44.5.1; Visual Studio Build Tools 2022 17.14.41; Codex CLI 0.162.0-alpha.17.2. Dependencies remain locked, with no SDK upgrade.

- Native window identities carry process creation time and a random HWND property. The property is removed by Windows when the window is destroyed, allowing subsequent helper processes to reject reused HWNDs within the same process. Existing Windows contexts without these markers must be selected again. This is lifecycle tracking, not a security boundary against the target application.
- Click/scroll validate bounds before and after activation and check the top-level window at the actual input point. Native pixel bounds survive DIP rounding and are retained for restore.
- Text revalidates foreground, focused control, desktop availability and identity between complete key strokes. Cancellation writes a private per-operation marker; the child releases held input before exiting, and the action gate waits for that exit. A hung helper is not represented as confirmed cancellation.
- Resize reads actual geometry and rolls back constrained requests; only a successful first maximize saves restore state.
- Codex launch discovers native Windows executables or runs the known npm JS entry as an argument to Node/Electron. It never evaluates `.cmd` content or interpolates prompts into a shell.

Ten native regression groups passed locally: 20 alternating edits to identical overlapping windows; Unicode/Ctrl+A; wrong process/lifetime markers; moved bounds; topmost obstruction; disabled modal owner; constrained resize/readback/rollback; focus theft during 10,000-character text; cooperative cancellation; close/recreate invalidation. The cancellation run stopped after 10 actual characters (1.16 seconds total including helper startup), with no held Ctrl/Alt/Shift or mouse buttons. Total duration is not a measured cancellation latency bound.

The first fixture run failed because .NET Framework multiline TextBox has no default Ctrl+A handler. The fixture now implements that shortcut and independently reads both textboxes; production input code was not changed to disguise that fixture difference.

Local automated evidence: 411 C++ checks; TypeScript checking; 712 Vitest tests; 76 AI tests and 21 acceptance protocol tests; real production renderer smoke; two reverse pings visible at 4.2 seconds and ending around 6.15 seconds; packaged SDK/Claude CLI/sharp; actual packaged renderer, copied skill, isolated profile, persisted config, clean quit and restart. Full NSIS install/start/restart/uninstall also passed locally in a temporary path containing spaces.

Real packaged-app Codex acceptance passed with the locally authenticated `gpt-6.1-sol`, effort `low`, fast mode off: observe the Test Board and reverse-ping, replace its note with `Ping received.`, then use Danger to restore `Ready for a ping.`. Each completed step independently read the actual fixture text. The app then exited cleanly and restarted. This establishes completed correction, not mid-turn model cancellation or model session resumption after restart.

Failure history is retained: the first real edit was refused when Windows did not grant foreground control, and the model requested the user focus the board. The fixture now requests focus before each test step. A subsequent attempt typed `Ping received` without the period because the unquoted instruction was ambiguous; the test now quotes the exact string including punctuation. Neither failure is counted as a successful run. The first CI attempt also read the edit control before queued input was delivered; independent readback now waits up to two seconds without resending input.

## CI and release

The matrix covers macOS/Node 22, Windows Server 2022/Node 22 and Windows Server 2025/Node 24. Windows jobs compile C++20 under code page 936, run real native fixtures against both source-built and packaged helpers, build NSIS and test install/start/restart/uninstall. These are interactive CI desktop tests, not model calls. Each successful Windows job uploads its installer.

The tag workflow reuses the complete matrix. Only after all jobs pass does it publish the Windows 2022/Node 22 installer. The tag must equal the package version; the packaged `package.json` includes the exact build commit. No new checksum artifact is added.

## Remaining validation boundaries

The `doctor` desktop flags indicate input-desktop availability, not proof of recording permission or target input compatibility; `captureVerified` and `inputVerified` explicitly remain false until an actual operation is exercised. [Microsoft documents foreground restrictions](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) and [SendInput's integrity-level limits](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). Checks reduce race windows but do not make global input an atomic window-bound transaction.

Not established by the automated suite: physical mixed-DPI/multiple displays, negative-coordinate hardware, UAC/elevated targets, lock/sleep recovery, manual wheel gestures and sound perception, maximized-state restoration across displays, or a real 30-minute ward. Synthetic fractional-DPI unit coverage does not replace those hardware cases. Claude and DSH authenticated Windows desktop acceptance remains unverified.

Optional real Codex acceptance (requires local login, can consume account usage):

```powershell
node tools/windows/check-app.mjs release/win-unpacked/LOLPingYourAI.exe --live-codex
```

It uses only an isolated Electron Test Board, checks actual note values for observe/edit/restore, and saves private evidence under `.local/`. Completed correction is distinct from mid-turn model cancellation.
