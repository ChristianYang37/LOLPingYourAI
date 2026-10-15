# Verification record — 2026-10-12

The macOS + Codex desktop-control loop was exercised with a real model and an isolated editable Test Board. This is a local demo, not a claim that every platform and manual acceptance case has passed.

## Teammate UX and DSH preview — 2026-10-15

- Added a small inactive reply card with expand/copy/follow-up, task status and LoL status icons; settings now group teammate, signals, emotes and wards and offer a first-run connection/permission check. Ordinary pings queue, urgent corrections revoke desktop actions before cancellation, and ward operations leave the active turn intact.
- Reasoning uses an ordinal index: 0 selects the model's lowest advertised level, 1 the next, and out-of-range values clamp to the highest. A real Codex turn resolved the default to `low`. Tests cover models with different available levels and the actual App Server request field.
- Real macOS + Codex testing used the development Electron app and an isolated local Safari test board: a screenshot ping read `PENGUIN`, sent a reverse ping, displayed its answer in the card, and answered a card follow-up with `企鹅。` without changing the page. The subsequent final-answer display adjustment was built and typechecked; a full model-driven editing/interruption scenario was not repeated for this revision.
- Downloaded official DeepSeek Harness and installed `@deepseek-ai/dsh@0.2.0-rc.2`. Real ACP initialization, session creation/resume and MCP discovery passed, including the example SiliconFlow profile. No provider key was available, so no Chinese API inference or DSH desktop-control success is claimed. The configured free trial model is text-only.
- TypeScript checking passed; Vitest passed 709 tests with 1 skipped; all 44 AI bridge tests passed. The skill validator passed. Tests include cancellation during a late turn start, arrival-order preservation during asynchronous window lookup, ward actions while locked and text-only model admission.
- Built the Apple Silicon DMG and installed the app. Strict deep code-signature verification passed. No new SHA-256 verification or checksum artifact was performed. The new installed app's connection checks passed, but its own helper reported both desktop permissions unavailable after replacement; renewed macOS authorization is pending. Earlier permission evidence below applies to earlier builds.
- No authenticated Claude run or Windows hardware test was performed. This preview is local; it has not replaced the published v0.1.0 release.

The sections below retain historical evidence for their dated builds.

### Bailian API follow-up — 2026-10-15

- Configured a user-owned, model-restricted Bailian key in DSH's private credential store and used the workspace-specific OpenAI-compatible endpoint. The selected `qwen3.8-flash` model had free quota; its stop-when-exhausted control was enabled and verified before requests. No credential or workspace endpoint is included in source.
- Real DSH inference returned `BAILIAN DSH OK`. A synthetic 512×512 image was recognized as `ORBIT42` and red/blue circles with reasoning `off`. The initial image answer named only the colors; a fresh session with an explicit two-field request returned both fields. This establishes API image input, not desktop-control accuracy.
- Restarted the installed app with DSH selected. Its ACP capability check reported image support. The app's helper now reports Screen Recording enabled and Accessibility unavailable; DSH desktop actions remain unverified. No rebuild or resigning was needed for this provider configuration.

### Installed DSH desktop follow-up — 2026-10-15

- After the user renewed Accessibility, the installed helper reported both Accessibility and Screen Recording enabled. No reinstall or signature change was required.
- A real assist ping through the installed app and DSH/Bailian read `PENGUIN` from a local Safari fixture, called `get_context`, sent an `onmyway` reply ping, clicked its textarea, selected all and typed `DSH desktop OK`, verified a fresh screenshot, restored `Original note.`, verified another screenshot and saved a handoff. The app finished with `busy: false`, phase `done`, reasoning `off` and the model's Chinese result in its reply card.
- The fixture independently recorded both actual input values, and a separate accessibility-tree read confirmed the final restored text. Only this disposable note was authorized for edits. Test captures, local session IDs and input-event logs remain outside Git.
- The first attempt was blocked by `Target window is missing or ambiguous`: two Safari windows shared identical bounds, and that installed native helper matched accessibility windows by bounds. Stopping that active DSH turn succeeded. Resizing only the disposable window made its bounds unique and the retry passed. This was a limitation of that installed build. The subsequent source repair and independent native-helper regression are recorded below; a complete DSH model-driven run with the new helper has not been repeated.

## Upstream installation

- Upstream: lolPing v0.5.1; source commit `f24a51e5a11c2b31dab72d89a571cc4025ad3c98`.
- Official Apple Silicon DMG installed separately as `/Applications/lolPing.app`.
- SHA-256 matched the release asset digest: `98dbe35ab428de9a8c59d1f6bdd97b1e46e08e818e627c122087b338a2521a88`.
- Original settings and ping preview were observed; original was quit before running the fork.

## Platform matrix

| Combination | Implementation | Evidence |
| --- | --- | --- |
| macOS arm64 + Codex | App Server, project MCP, Swift/CG/AX helper | Real screenshot, model interpretation, reverse-ping calls, text editing, interruption, restoration and window resize |
| macOS + Claude | Agent SDK, project MCP, same helper | Source and protocol tests; no accepted authenticated Claude desktop run |
| Windows + Codex | Same App Server adapter; Win32 helper and DPI conversions | Source and CI configuration only; Windows helper not compiled or run here |
| Windows + Claude | Agent SDK + Win32 project backend | Source only; no Windows/Claude run |

Environment: Apple Silicon, macOS 26.4, Electron 44.5.1, Codex CLI 0.162.0-alpha.2. Native Codex Computer Use was detected; this demo executes through its project MCP backend for scoped cancellation. Native CUA integration is not claimed.

## Live desktop evidence

- The installed application reports Accessibility and Screen Recording enabled. Both privileges were checked from the app's own helper, not inferred from System Settings labels.
- A question ping supplied a 512×512 logical-pixel screenshot and window identity. The real Codex model correctly read `Ready for a ping.` without editing it. Retina scale factor 2 and square padding were inspected.
- Repeated pings and application restarts resumed the same teammate thread. Private thread IDs, screenshots and logs remain outside Git.
- An assist ping made the real model click the textarea, issue `cmd+a`, and type `Ping received.`. The Test Board independently recorded the actual value.
- A danger ping arrived while the old turn was busy. App Server reported the old turn `interrupted`; a deliberate request with the old context was rejected with `Stale ping context`. The new turn observed the changed text, used real select-and-type input to restore `Ready for a ping.`, checked a fresh screenshot, saved a handoff and sent a retreat reply. No Reset button was needed in the successful run.
- The model maximized the board to `x0 y33 width1512 height888`, then restored exactly `x100 y100 width680 height520`. Both bounds were confirmed by fresh screenshot metadata; note contents were unchanged.
- A real default 30-minute ward was registered at 19:26:13 Asia/Shanghai and due at 19:56:13. It survived application restarts. Permissions were unavailable at the deadline; it began after they were restored at approximately 19:57:49, completed an observation-only model turn and remained `completed` after further restarts. The model reported the correct unchanged note. This is a delayed catch-up run, not an exact-deadline timing claim.
- A real model generated a `Ping Buddy` SVG through `submit_icon`. The settings preview identified the method as `vector-generated`; the candidate remains available for user review.
- A separate retreat ping interrupted an active observation turn. The broker returned `stopped: true` only after App Server confirmed interruption; status became idle.
- After the final asset fix and reinstall, the real model typed `Final package OK.`, verified a screenshot, restored `Ready for a ping.`, verified again and sent a celebrate reply.
- Reply events use the agent source and did not create additional user turns. The persisted ward did not run twice.

## Automated and build checks

- TypeScript: `pnpm typecheck` passed.
- Vitest: 705 passed, 1 skipped across 43 files. The skipped case concerns Windows rename/EPERM behavior.
- AI bridge tests: 22 passed, including stale action rejection, cancellation races, session lifecycle, deduplication, read-only mode, scheduler persistence/lock/cancel and overlapping ticks.
- C++ input helper: 411 passed, 0 failed.
- Skill validator passed; Swift desktop helper compiled.
- A real Electron asset smoke test loaded all 20 signal textures and decoded all 12 WAV sounds under the production overlay Content Security Policy. Run `pnpm build` then `pnpm exec electron tools/check-assets.cjs`.
- Final installed settings showed no missing-asset diagnostics.
- Apple Silicon DMG built. The installed bundle passed `codesign --verify --deep --strict`; the DMG passed `hdiutil verify`. Release checksum is in `release/SHA256SUMS` (local artifact, excluded from Git).

## Problems found and fixed during live testing

1. Partially unpacked native image dependencies failed to resolve `detect-libc`: package production dependencies together.
2. Resuming an already loaded/new Codex thread caused writer/rollout errors: track loaded threads and create the first thread lazily.
3. Keyboard tools returned successfully without changing the note: explicitly post/release modifiers, clear inherited Unicode-event flags, mark self-generated events and allow delivery before helper exit.
4. Concurrent scheduler ticks could overlap after an awaited availability check: acquire the scheduler guard before awaiting.
5. The new local asset host was blocked by overlay CSP and custom-scheme CORS: permit only the needed asset host in CSP, enable custom-scheme CORS, and return static-resource CORS headers. The real Electron smoke test reproduces this boundary.

## Remaining manual coverage

- Physical hold-drag-release/cancel gestures for both wheels, audible sound output and focus preservation need user observation. An automation-generated Option click did not establish a physical gesture result.
- No physical secondary/mixed-DPI monitor, negative-coordinate display, sleep/wake or lock/unlock transition was exercised. Geometry and scheduler simulations cover relevant logic only.
- Import/crop/background-removal UI and custom-map persistence are implemented but their complete manual workflow has not yet been accepted. The generated emote preview was observed; adding it remains a user review step.
- Session expiry/handoff and harness switching are covered by tests, not by waiting two real hours or a live authenticated Claude switch.
- Application-specific reading-mode/zoom optimization depends on the agent and target app; maximize/restore is the part verified here.
- Builds use ad-hoc signing and are not notarized. Replacing a build can invalidate macOS grants; there is no available Developer ID identity on this machine.

At the time of the first local verification, no GitHub repository had been created or pushed. The original verification above describes that first build. The later LoL asset/queue revision is recorded below. Personal runtime data remains excluded.


## LoL assets and serialized agent replies — later revision, 2026-10-12

- Removed the original geometric pack, its SVG sources and synthesizer script. Replaced application/tray icons with upstream versions. Removed the locally generated Ping Buddy test candidate.
- Bundled 44 upstream LoL emotes with PNG stills, WebP animations and OGG sounds. All 182 bundled asset files match pinned upstream bytes, including two explicitly named texture aliases. Attribution now excludes game assets from MIT.
- Agent replies have one FIFO queue across displays. A renderer acknowledges only after both its icon/animation and its actual Web Audio source end (including reported output latency). Stale or wrong-display acknowledgements cannot advance the queue. User pings/previews remain immediate. Agent weak/nice/celebrate replies use original animated emotes and their own OGG sounds.
- Typecheck passed; Vitest 709 passed / 1 skipped in 44 files; AI tests 22 passed. New regression coverage includes cross-display queue ordering, renderer readiness, stale acknowledgements, removed displays and long audio completion.
- Real Electron asset decoding passed: 28 textures, 22 WAV sounds and 132 emote files.
- Real Electron five-reply test exercised the actual OverlayManager, preload, overlay and Web Audio. Maximum concurrent visuals: 1. With a deliberately short 100 ms icon duration, the 980.77 ms sound still governed progression; observed start gaps were about 1009, 1009, 1011 and 3149 ms, with the last gap waiting for the animated emote to disappear. This tests both audio-longer and visual-longer cases.
- Rebuilt and installed the Mac DMG. Both desktop permissions were confirmed true in the installed application. No Windows execution or subjective sound-quality assessment is claimed.
- The installed app received real wheel pings after the update. These superseded the optional model-driven diagnostic; the five-item timing evidence above comes from the independent real Electron playback test, not that interrupted model turn.

## Public release preparation — 2026-10-13

- Bundled the updated skill that uses existing harness history/session search, project files and memory to recover unclear intent. No separate retrieval service was added. Claude's current programmatic tool policy still limits it to project MCP; the README states this limitation.
- Updated English and Chinese installation/feature documentation, including platform status, permissions, source builds and release downloads.
- Re-ran TypeScript checking, 709 Vitest cases (1 skipped), and 22 AI bridge tests successfully. The test runner emitted EventEmitter listener-count warnings; no tests failed.
- Built and installed the Apple Silicon package. The source, packaged, installed and runtime skill files have identical SHA-256 hashes. The installed helper reports Accessibility and Screen Recording enabled.
- The application passed strict deep code-signature verification; the DMG passed disk-image verification. SHA-256 is supplied alongside the release download.
- Scanned tracked history for personal workstation paths and common credential patterns with no matches. Runtime captures, credentials, session records and build output remain excluded from Git.
- Earlier live desktop evidence above remains the relevant behavioral test record; this documentation/skill packaging update did not repeat a full model-driven editing scenario.


## Teammate robustness revision — 2026-10-14

- Claude adapter: built-in tools restricted to read-only `Read`/`Grep`/`Glob` with a `PreToolUse` policy hook; emote reactions queued after the current turn in the same streamed session instead of interrupting it; unpersisted session IDs restarted once; `LOLPINGAI_CLAUDE` executable override.
- Codex adapter: shared initialization for concurrent callers; active turns fail on App Server exit, and the next call starts a fresh server.
- Teammate history drops base64 screenshot payloads before the settings window polls it. Teammate replies show only assistant text. The settings panel checks desktop permissions when it opens.
- CLI: `help`, command validation before contacting the app, and the "start the app" hint only when the app is actually unreachable.
- Typecheck passed; Vitest 709 passed / 1 skipped; AI bridge tests 31 passed (9 new). New tests drive a stand-in App Server over real stdio JSON-RPC (the concurrency and crash tests fail against the previous adapter), a stand-in Agent SDK that consumes streamed input per turn, the tool policy, and the CLI against a real local bridge. Real Electron asset and five-reply queue checks passed again. C++ helper: 411 passed.
- Not verified live: no Claude credentials were available on the test machine (the SDK reported "Not logged in"), and Codex CLI was not installed there, so no model-driven turn was repeated for this revision. Earlier live Codex evidence above still describes the desktop loop.


## macOS window identity regression — 2026-10-15

- Exact CG window ID to AX identity replaces the rectangle-only match. Focus, hit-test and observed-bounds checks reject stale or ambiguous input; process launch markers remain attached to window identities.
- Live Electron suite: 10/10 cases. Chrome: 30 alternating edits between identical overlapping windows. Safari: 10 alternating edits on the final helper. Both browsers passed stale/fresh movement, modal-input rejection with no deferred text after dismissal, original-text restoration and closed-window rejection. Some attempted runs safely stopped on focus changes; no zero-refusal or universal app-compatibility claim is made.
- Independent PR checkout: 34 AI tests; 709 Vitest passes and one skip (seven helper cases passed after their missing build prerequisite was compiled); typecheck, native builds, production build, Apple Silicon DMG packaging and strict deep signature verification passed. No new SHA-256 check. The installed app was not replaced.
- See [window identity design and test evidence](window-identity.md) for reproduction, discovered browser issues, private-SPI dependency, conservative refusals and untested boundaries.


## Owner-supplied logo — 2026-10-15

- Preserved the supplied 1254×1254 PNG as `build/icon.png`; both language READMEs display it. Generated Windows ICO frames at 16, 24, 32, 48, 64, 128 and 256 pixels and decoded every frame successfully.
- Packaged the same logo for the settings/window icon on both platforms; Windows tray branding uses it too. macOS retains the existing monochrome menu-bar status glyphs. Updated artwork attribution.
- Typecheck, 26 existing window/tray tests and production build passed after the change. Rebuilt the Apple Silicon DMG, passed strict deep signature verification, and visually inspected the icon extracted from the final app's ICNS. The installed app was not replaced.


## Integration review — 2026-10-15

- PR #2 was reverted at the owner's request. Its SDK 0.3 upgrade, strict MCP setting, stream-close implementation and contributor-reported authenticated verification are excluded from this integration. The SDK and lockfile remain on the pre-PR version (0.2.141 resolved).
- This branch retains its own model/effort readiness barrier and input-lifecycle tracking. A waiting follow-up checks the cancelled turn record before submitting a new prompt; it does not restore PR #2's cancellation-epoch implementation. Regression tests cover cancellation and eager input consumption before model settings are ready.
- DSH reserves in-flight session setup and discards a prompt cancelled before submission; ACP approvals require an offered one-time option. Thinking defaults to enabled, independently of the ordinal effort index. DSH indices count only enabled native levels; the off switch is separate. No prompt-based imitation of native effort is added. Earlier Bailian inference at `off` is historical, not a test of the new default.
- The settings picker loads the selected harness's live catalog, preserves independent choices, and defaults fast mode to false. Codex sends the chosen model and explicit `serviceTier: default` when fast is off; Claude applies session-scoped `fastMode: false`; DSH uses ACP model selection and does not invent a fast-mode feature.
- Real metadata-only probes returned GPT-6.1 Sol and GPT-6 Astra from the installed Codex App Server and the Bailian ACP model list. A fresh DSH process passed initialization, creation, MCP mount, close and resume without inference.
- CI checks that the shipped SDK imports, its bundled CLI starts with `--version`, and packaged sharp produces a PNG. It never authenticates or submits a model request.
- Authenticated Claude desktop work, a DSH model-driven loop with this integrated helper and default thinking, and Windows hardware remain unverified. Earlier installed-app evidence is dated above; the installed application was not replaced during PR review.
- After the revert: 56 AI tests and 709 Vitest cases passed (one existing skip); typecheck and production build passed. A real SDK 0.2.141 metadata-only probe returned default, Sonnet, Sonnet 1M and Haiku; this session advertised no fast-capable Claude model. The UI follows the returned capability rather than inventing support.
- The reverted-dependency Apple Silicon package passed SDK import, bundled native Claude Code 2.1.141 startup, packaged sharp image generation, and strict deep code-signature verification.
