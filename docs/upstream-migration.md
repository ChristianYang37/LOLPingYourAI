# Selected lolPing improvements

The baseline remains upstream v0.5.1 (`f24a51e5`). This migration selectively adapts later commits from [darrenprx/lolPing](https://github.com/darrenprx/lolPing), inspected at `b947aab8`. It does not merge upstream main wholesale.

| Selected feature | Upstream commits | Adaptation |
| --- | --- | --- |
| Custom trigger tap-through | [`386506f`](https://github.com/darrenprx/lolPing/commit/386506f) | Keep our trigger-release cancellation. Do not take upstream `33d1a4c`. |
| Windows overlay bounds and z-order | [`a2bc72f`](https://github.com/darrenprx/lolPing/commit/a2bc72f), [`265ddb1`](https://github.com/darrenprx/lolPing/commit/265ddb1) | Include `agent:ping`; keep global reply serialization and coordinate origins. |
| macOS callbacks, Mission Control and Dock | [`fa00486`](https://github.com/darrenprx/lolPing/commit/fa00486), `a4f3a01`, [`83c1d97`](https://github.com/darrenprx/lolPing/commit/83c1d97), `d2d3c46`, [`2c826f9`](https://github.com/darrenprx/lolPing/commit/2c826f9), `a03a638` | Target our `.settings-side` and theme variables; isolate temporary CSS by window and handle restore before insertion finishes. Require macOS 13 in build and package metadata. |
| Wheel size | [`5613064`](https://github.com/darrenprx/lolPing/commit/5613064) | Shared 300–900 DIP control in the current settings page; independent of the AI region. |
| Custom emote audio | [`c1ee1df`](https://github.com/darrenprx/lolPing/commit/c1ee1df) | Preserve Promise-based playback completion and local asset protocol; no room sound transfer. |
| Upside-down question / red vision icon | [`6253a1b`](https://github.com/darrenprx/lolPing/commit/6253a1b), [`8a5f0ea`](https://github.com/darrenprx/lolPing/commit/8a5f0ea) | Optional `missingflip` routes to the existing `missing` AI instruction. Default slots stay unchanged. |

Upstream contributors include darrenprx, SJYssr, toolsfox and 1cgy1cj. See upstream commit history for individual authors and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for artwork attribution.

Out of scope: keeping a wheel open after trigger release, persistent last-ping markers, room/network changes and Linux. Native Windows desktop identity/input fixes and the Codex/Claude/DSH adapters are preserved.

## Checks

Run from the repository root after installing dependencies:

```sh
pnpm typecheck
pnpm test:helper
pnpm test
pnpm test:acceptance
pnpm build:desktop
pnpm build
pnpm exec electron tools/check-upstream-interactions.cjs
pnpm exec electron tools/check-chat-ui.cjs
pnpm exec electron tools/check-agent-pings.cjs
pnpm exec electron tools/check-agent-queue.cjs
pnpm exec electron-builder --mac --dir --publish never
node tools/check-packaged-runtime.cjs release
```

`check-upstream-interactions.cjs` uses the production overlay, real Chromium WAV decoding/playback, temporary emote files and the local asset protocol. It tests sound replacement, rejection above five seconds, removal, actual wheel bounds after animation at 300/600/900 DIP and the flipped texture. It uses silent PCM, no API key, no global input hook and no personal settings. CI runs it on macOS and both Windows jobs.

The helper callback tests intercept native posting; they test production callbacks and click counts without sending real input to another app. Unit tests also cover scaled hit-testing, settings persistence, queued agent re-raising and late Dock CSS insertion. Existing queue smoke tests check that five agent reactions never display concurrently.

### Local evidence, 2026-10-16

- macOS Apple Silicon: type check, helper state-machine/callback tests, Vitest and AI/acceptance tests passed.
- Actual Electron: custom sound completion/replacement/removal, wheel sizing and flipped asset, chat/settings navigation and five-item agent queue passed (maximum concurrent reactions: 1).
- macOS directory packaging and packaged SDK/native CLI/sharp runtime imports passed. Agent ping and emote visibility also passed the six-second lifetime check.
- Windows behavior is covered by mocks and the Windows CI matrix. This migration has not been manually checked with a physical Windows taskbar, multiple DPI displays, or every application's focus behavior.
- Mission Control and Dock animation appearance still need visual OS-level confirmation; callback and settings-lifecycle tests do not establish that appearance.

No release is published and no installed application or macOS permissions are changed by these checks.
