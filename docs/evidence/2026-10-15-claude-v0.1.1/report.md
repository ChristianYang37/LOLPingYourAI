# Signed-in Claude run on macOS, v0.1.1 (main 7c6edc1): test notes and evidence (2026-10-15)

These are the manual test notes from a signed-in Claude run of `docs/acceptance.md` steps 1–8 against the **official v0.1.1 macOS release**, built from main `7c6edc1`. Main has since moved on: ChristianYang37/LOLPingYourAI#6 merged at 21:28 as `e5475e9`, and that commit was not tested. They follow the evidence format requested in ChristianYang37/LOLPingYourAI#5 (11:07Z comment). The earlier run on the reverted SDK 0.3 build is a separate package and is not repeated here.

All times are local (Asia/Shanghai, UTC+8). Cases that were not tested are listed under **Not covered**; nothing here widens the overall acceptance status.

## Tested build

- **App:** `LOLPingYourAI-0.1.1-arm64.dmg` from the [v0.1.1 release](https://github.com/ChristianYang37/LOLPingYourAI/releases/tag/v0.1.1).
  - SHA-256 `f2269c3dbfcd542000d34725463b1a498243e61252bd4cf8eae349de3a3e1e4a`, matching the release asset digest.
  - Copied to `/Applications/LOLPingYourAI.app`. Version 0.1.1, bundle id `dev.lolpingyourai.desktop`, ad-hoc signature.
- **Source:** tag `v0.1.1` = main [`7c6edc1`](https://github.com/ChristianYang37/LOLPingYourAI/commit/7c6edc12d6f35804afa6795f4a2b9dfed2ab783d) (main HEAD when the run started at 20:00; ChristianYang37/LOLPingYourAI#6 merged at 21:28, during the run, as `e5475e9` and is **not** in this build). All 17 packaged files under `ai/` and `skills/` are byte-identical to `7c6edc1`.
- **Claude:** packaged `@anthropic-ai/claude-agent-sdk` 0.2.141, reporting Claude Code 2.1.141. Every init message reported model `claude-opus-4-7[1m]` (the SDK default; no model was selected in settings). claude.ai subscription login.
- **Machine:** Apple Silicon, macOS 27.0.1 (26A434), built-in display only (1470×956 points, scale factor 2). Electron 44.5.1 in the app and for the Test Board; Node 26.10 for the scripts.
- **Permissions:** Accessibility and Screen Recording were granted to the `/Applications` copy before the first launch.
- **Launch:** at 20:00:44 the app was started with a clean environment; its process had no `ANTHROPIC_*` or `CLAUDE*` variables. Both later restarts (21:12:19, 21:48:31) used the same command:

  ```sh
  env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh TMPDIR="$TMPDIR" PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/open /Applications/LOLPingYourAI.app
  ```

  The app was quit with `osascript -e 'quit app "LOLPingYourAI"'`.
- **Test Board:** `pnpm exec electron tools/test-board.cjs` from the repository (unchanged between the local checkout and `7c6edc1`). It writes its note to `$TMPDIR/lolping-test-board.json`; every `board=` value in the logs is read from that file, independently of the teammate.
- **App data:** the app shares its data directory with the earlier build, so `wards.json` and the emote library still list items from the earlier run (wards `8c819c10` and `bfc3784b`, the "小狗 (dog)" candidate). The new run's items are named below.

## How pings were sent

- **Scripted (steps 1–6).** [`scripts/drive.mjs`](scripts/drive.mjs) posts `ping` to the app's local bridge (the path `ai/cli.mjs` uses). Before each ping it uses the app's own `desktop-helper target` to confirm that the window under the point belongs to the Test Board process, and refuses otherwise. That check refused one ping at 20:25:48, when another window covered the board.
- **Point inside the board.** The first scripted pings used fixed points and their 512 px regions reached past the board into other windows. Those turns are redacted (see Redactions). From 20:16:26 every scripted point was chosen so that the region lies inside the board, except the deliberate display-edge case.
- **By hand (steps 7–8 and some of 6).** The tester used the ping wheel (⌥ Option + drag), the emote wheel (⌃ Control + drag), the settings window and the reply card.
- **Watchers.** [`scripts/round2.mjs`](scripts/round2.mjs) followed wards, emotes and restarts. [`scripts/lockwatch.mjs`](scripts/lockwatch.mjs) logged screen-lock transitions once a second. [`scripts/handwatch.mjs`](scripts/handwatch.mjs) logged hand pings in step 8. Each file in `watcher/` starts with the command that produced it.
- **Handoff.** At 20:10:25 a fresh task was handed off from the packaged CLI; it started session S1:

  ```sh
  node /Applications/LOLPingYourAI.app/Contents/Resources/app/ai/cli.mjs bind '{"harness":"claude","summary":"Goal: acceptance test of LOLPingYourAI v0.1.1. Only edit the LOLPingYourAI Test Board note; never touch other windows. Progress: none yet. Next: wait for pings."}'
  ```

## Sessions

| Label | Time | Started by |
| --- | --- | --- |
| S0 | 20:09:03–20:09:46 | First-run setup test pings. Omitted; see Redactions |
| S1 | 20:14:52–21:56:57 | The CLI handoff at 20:10:25; resumed by every later ping, ward visit and follow-up |
| S2 | 21:38:39–21:39:06 | Emote generation from a description (tester's text) |
| S3 | 21:39:19–21:39:45 | The same description, generated again |
| S4 | 21:45:31–21:46:17 | Emote generation from a description plus a reference image |

## Results

| # | Case (acceptance step) | Time | Observed | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Question over the note (1) | 20:16:26 | Signal `missing`, mode observe. The region was a 512×512 image of the board's centre. The reply read the clipped note text and quoted it as "…dy for a ping."; it sent an `onmyway` reverse ping and a handoff, and made no `desktop_action`. Note unchanged. 24 s. | `watcher/20-16-26_question-inside.txt`, `timelines/S1.txt`, `captures/20-16-27_step1-question-region.png` |
| 2 | Assist: "Replace the note with Ping received. Only edit this test board." (2) | 20:17:01 | **Failed.** `get_context`, `allin`, then 5 clicks (each `{"ok":true}`) and 10 key or type actions (`Cmd+A`, `Meta+A`, `Backspace`, `type`). The helper refused every key or type action: `Target focus did not settle (no focused control)`. The capture shows the caret in the textarea and its focused (orange) border. The turn ended with a `missing` (Question) reverse ping asking how to proceed. Note unchanged. See Finding A. | `watcher/20-17-01_assist.txt`, `timelines/S1.txt` 20:17:06–20:20:12, `captures/20-19-26_step2-caret-in-note-keys-refused.png` |
| 3 | Danger during an active Assist turn (3) | 20:20:45 → 20:21:12 | The Assist turn clicked once at 20:21:11. Danger was delivered at 20:21:12 (bridge reply after 1276 ms) and the old turn ended `error_during_execution` ("Request interrupted by user"). A new turn started with a fresh region image and a new context (`24599e74`). It stopped retrying keystrokes, said that no restore was needed because the note still read `Ready for a ping.`, and made no action. Restoration was **not** exercised, because step 2 had changed nothing. | `watcher/20-20-45_assist-then-danger.txt`, `timelines/S1.txt`, `captures/20-21-13_step3-danger-fresh-region.png` |
| 4 | Retreat during an active Assist turn (4) | 20:21:44 → 20:22:00 | The Assist turn's `key` action was in flight. The bridge returned `{"stopped":true}` after 1528 ms. The pending tool call was rejected, the turn ended `error_during_execution`, and status showed `busy=false`, task phase `stopped`. No later action followed; the board was unchanged 15 s later (20:22:17). | `watcher/20-21-44_assist-then-retreat.txt`, `timelines/S1.txt` |
| 5 | Stale contexts (3, 4) | 20:22:27 | `desktop_action` with the context superseded by Danger: HTTP 400 `Stale ping context. Stop using the previous target.` With the context superseded by Retreat: HTTP 400 `Desktop action cancelled or not authorized by this ping`. | `watcher/20-22-26_stale-contexts.txt`, `scripts/stale.mjs` |
| 6 | On my way, then an Assist asking to restore (5) | 20:22:35, 20:23:26 | `maximize` returned `Window did not reach requested bounds`, but the helper then reported the board at 1470×884 (0,33), up from 680×520 (0,72). `restore` returned `{"ok":true}` and the helper reported exactly 680×520 at (0,72). See Finding B. | `watcher/20-22-35_onmyway-then-restore.txt`, `watcher/20-23-26_restore.txt` |
| 7 | Board moved, new screenshot, display edge (5) | 20:24:40–20:25:29 | The tester dragged the board to (779,430), 11 px from the right and 6 px from the bottom screen edge. A Question at the board centre (1119,690) gave the same image as case 1 at the old position. A Question at (1430,925) gave a region whose valid area was clipped to 296×287 at the screen edge, with padding beyond it; the window corner sits where the bounds predict. The model reported the 296×287 valid area. | `watcher/20-24-48_moved-question.txt`, `captures/20-24-50_step5-moved-board-center.png`, `captures/20-25-09_step5-display-edge-clipped.png`, `captures/20-16-27_step1-question-region.png` |
| 8 | Ward, default 0.5 h, due during system sleep (6) | 20:26:05 → 21:10:06 | Ward `289bbb77` (Need Vision via the bridge, signal `vision`) was due 20:56:06. The bridge reply carried the ward; no model turn started. The Mac slept from 20:28:33 (lid closed) to 21:10:01 (from `pmset -g log`). At 21:10:06 the scheduler ran one observe-only visit (source `timer`) in S1, which sent a `vision` reverse ping and a handoff and made no `desktop_action`. The ward was then `completed`. Not planned: an unplanned sleep case, not the restart case. | `watcher/20-26-05_ward-a-place.txt`, `timelines/S1.txt` 21:10:07, `captures/21-10-06_ward-A-visit-after-sleep.png` |
| 9 | Ward across an app restart, default 0.5 h, wall clock (6) | 21:11:36 → 21:41:59 | Ward `f027db73` was due 21:41:37.<br>21:11:59: the app quit (no process, bridge unreachable).<br>21:12:19: relaunched with a clean environment; new pid, bridge up, ward still `pending`.<br>21:41:41: one visit, an observe-only turn (source `timer`) in S1. It sent a `vision` reverse ping and a handoff and made no `desktop_action`. It also noticed the board had moved 4 px.<br>21:41:59: the ward was `completed`, with exactly one timer context.<br>The board stayed open throughout. | `watcher/21-11-36_ward-b-place.txt`, `watcher/21-11-53_restart.txt`, `watcher/21-11-45_ward-b-watch.txt`, `app-state/wards-before-restart.json`, `app-state/wards-after-restart.json`, `app-state/wards-after-ward-b.json`, `captures/21-41-41_ward-B-visit-after-restart.png` |
| 10 | Ward visit, accelerated (6) | 21:12:40 → 21:16:06 | `wardHours` was set to 0.05 (3 min) via `ai/cli.mjs config`. Ward `5d484929` was due 21:15:40; one visit ran at 21:15:45 and the ward was `completed`. `wardHours` went back to 0.5 at 21:34:12. | `watcher/21-12-39_ward-c-cancel-place.txt`, `watcher/21-11-45_ward-b-watch.txt`, `watcher/21-34-12_ward-hours-restore.txt` |
| 11 | Ward cancel, accelerated (6) | 21:19:46 → 21:22:46 | Ward `9fbf699a` was due 21:22:46. The tester pressed Cancel under Settings → AI teammate → Wards ("一次性回访"). The ward was `cancelled` at 21:20:12, and no timer context appeared before the next ward's due time. | `watcher/21-19-45_ward-d-cancel-place.txt`, `watcher/21-11-45_ward-b-watch.txt` |
| 12 | Ward while the screen is locked, accelerated (6) | 21:27:04 → 21:33:52 | Ward `a9c240bf` was due 21:30:04. The screen was locked 21:27:29–21:33:24 (`CGSSessionScreenIsLocked`, polled each second). The ward list did not change while locked. At 21:33:28, 4 s after unlock, one observe-only visit ran; the ward was `completed` at 21:33:52.<br>An earlier attempt (ward `238d08d7`, due 21:23:26) is not counted: the lock had no recorded time and probably came after the due time. That visit ran normally at 21:23:33. | `watcher/21-26-55_lockwatch.txt`, `watcher/21-27-03_ward-f-lock-place.txt`, `watcher/21-11-45_ward-b-watch.txt`, `captures/21-33-26_ward-F-visit-after-unlock.png` |
| 13 | Crop/import a local image (7) | 21:37:23–21:37:49 | The tester imported the app's own `icon.png` on the Emotes page. Candidate `My emote`, method `local-crop`. Accepted as `c:d4b2…` and placed on the wheel. | `watcher/21-11-45_ward-b-watch.txt`, `emotes/21-37_local-crop-my-emote.png` |
| 14 | Generate from a description (7) | 21:38:38–21:39:51 | S2 and S3 (the tester's description). Each submitted SVGs through `submit_icon`, and the candidates were labelled `vector-generated`. The tester accepted one (`c:6243…`) onto the wheel. Its image is not included (it depicts a real public figure). | `timelines/S2.txt`, `timelines/S3.txt`, `watcher/21-11-45_ward-b-watch.txt` |
| 15 | Generate from a reference image (7) | 21:45:31–21:46:17 | The S4 prompt carried an attached JPEG reference. The first SVG was refused (`SVG contains external or active content`). The second became the candidate `thumbs_up_chibi`, labelled `vector-generated`; the label does not say that a reference was used. Accepted onto the wheel (`c:a6b4…`). | `timelines/S4.txt`, `emotes/21-46_reference-generated-thumbs-up.png` |
| 16 | Bind a custom reaction (7) | 21:44:10, 21:47:29 | Settings → AI teammate → Signals → Imported emote → "Map emote" → "Save signal" stored `mappings["c:6243…"]` with mode `emotion` (21:44:10). The first attempts did not persist because "Save signal" had not been pressed; the UI gave no confirmation either way. At 21:47:29 the tester sent that emote over the board. The turn's context had signal `c:6243…` and mode `emotion`, and the teammate answered with an `onmyway` reverse ping. | `app-state/mappings-after-restart.json`, `timelines/S1.txt` 21:47:32 |
| 17 | Persistence across a restart (7) | 21:48:17 → 21:48:31 | Before quitting and after relaunching: 4 custom emotes, the same wheel order and the same mapping. The four `.webp` files were still in the library. | `watcher/21-48-17_restart2-persistence.txt`, `app-state/emotes-after-restart.json`, `app-state/mappings-after-restart.json` |
| 18 | Effort setting | 20:10, 21:49:10–21:50:20 | With effort 0, status reported `effectiveEffort: "low"`. The tester set effort to 8 in Settings; after the next turn, status reported `effectiveEffort: "max"` (21:49:45). Effort went back to 0 via the CLI and the next turn reported `low` (21:50:20). This is the app's own report: the Claude Code transcript records no effort field, so the level actually sent to the model is not independently confirmed. `effectiveModel` was reported as `default` while init reported `claude-opus-4-7[1m]`. | `watcher/21-49-10_effort.txt` |
| 19 | Reply card and follow-up | 21:50:03–21:51:15 | After a Question, the card titled "LOLPingYourAI reply" showed the result with Expand, Copy and a follow-up field. The tester typed a follow-up into the card and sent it. It became a new turn in S1 (context `d3917fbd`), and the card showed the new answer. In the recording the card goes through "正在理解" (working, with a Retreat button) to "已完成" (done). The Copy button was pressed but its clipboard result was not checked. | `screenshots/21-50_reply-card-done.jpg`, `screenshots/21-51_reply-card-followup.jpg`, `watcher/21-50-32_card-followup.txt`, `recording/21-55-10_step8-hand-wheels.mov` |
| 20 | Ping wheel by hand (8) | 21:53:34–21:56:09 | Danger, On my way, and Question ×2. Each started a turn with the expected signal and mode. The tester's hand On my way (21:54:01) hit Finding B again: two `maximize` calls failed, and the window ended at 1470×529 (153,402), past the right screen edge. | `watcher/21-51-54_step8-hand.txt`, `timelines/S1.txt` |
| 21 | Wheel open, drag, release and cancel; click-through; tones (8) | 21:55:10–21:57:17 (recording) | **In the recording:**<br>– Option+drag opened the ping wheel; dragging back to the centre and releasing sent nothing.<br>– Two Questions were sent from the wheel.<br>– With a ping marker over the note, a click on the textarea focused it (the border turned orange).<br>– Control+drag opened the emote wheel, and a built-in emote was sent (`reaction`, mode `emotion`, 21:56:40).<br>– The reply card shows the turn states.<br>**Reported by the tester:** tones were heard. The recording has a microphone track. | `watcher/21-51-54_step8-hand.txt`, `recording/21-55-10_step8-hand-wheels.mov` |
| 22 | No reverse ping started a turn | all | Every prompt in the timelines comes from a ping, emote or follow-up by the tester, from the emote generator in Settings, or from the ward timer. | `timelines/` |
| 23 | Tools offered to the model | every turn | Each init message reported **18 tools** and two MCP servers: `lolpingyourai` and one claude.ai account connector. This build predates `strictMcpConfig` (ChristianYang37/LOLPingYourAI#6, merged during the run), so this is the pre-#6 runtime state only. Current main (`e5475e9`) was not run. | `watcher/` (SDK init lines) |

## Findings

**A. Keyboard input is refused on the Test Board (step 2 cannot pass).** On this build every `key` and `type` action against the Test Board failed with `Target focus did not settle (no focused control)`. Clicks succeeded, and the capture shows the caret in the textarea.

- **Where it comes from:** `native/desktop/WindowIdentity.swift:55` (`hasTargetFocus`). It returns this failure when the target app's `kAXFocusedUIElement` cannot be read. `main.swift` waits up to 1 s for it before failing.
- **Hypothesis, not verified:** Chromium-based windows (the Test Board is a plain Electron window) do not expose their accessibility tree to a client unless one is requested. So no focused element is ever published, even when the textarea has focus.
- **Reproduction:**
  1. Start the board with `pnpm exec electron tools/test-board.cjs`.
  2. Send an Assist ping asking to replace the note.
  3. Every `desktop_action` `key` or `type` returns this error.
- **No other app checked:** keyboard input was not tested against any other application, so I cannot say whether this affects only Electron/Chromium targets.

**B. `maximize` reports failure or overshoots the screen.**
- At 20:23:02 it returned `Window did not reach requested bounds`, although the window had grown to 1470×884 at (0,33). The work area is 1470×923 at (0,33), so the requested and reached heights differed.
- At 21:54 (a hand On my way with the board near the bottom-right corner), two `maximize` calls failed. The window ended at 1470×529 at (153,402), extending 153 px past the right edge of the only display.
- `restore` worked exactly in the scripted case (20:23:45).

**C. Smaller observations.**
- A ping with the unknown signal `question` is rejected (`Unknown signal: question`). The Question ping is `missing`.
- The first-run setup's test ping registered a different target window (Finder) from the region it captured.
- `setupComplete` stayed `false` throughout, although the tester finished the setup flow.
- "Save signal" gives no visible confirmation.
- The generation method label is `vector-generated` whether or not a reference image was attached.
- In an emote reaction turn (21:41:19) the model called `submit_icon`, which added an unrequested icon candidate (`wink-ward`).

## Not covered

- **Step 2 success path and step 3 restoration:** blocked by Finding A, so not observed.
- **Step 4, a stop timeout surfacing as an error:** not tested. I found no safe way to make the adapter miss its stop confirmation.
- **Step 6, closed target window on this build:** not tested. It was covered on the earlier build only.
- **Steps 5 and 8, multiple and mixed-DPI monitors:** not tested (built-in display only).
- **Step 8, the wheel in each of four directions:** the recording shows the wheel opening and a cancel. I did not check frame by frame that each of the four directions was held before cancelling.
- **Sound:** reported by the tester and audible only through the recording's microphone track. Not measured independently.
- **Reply card Copy button:** not verified.
- **Windows:** not tested.
- **Effort at the model:** only the app's own `effectiveEffort` report; see case 18.

## Redactions

- Session ids are replaced by S0–S4, and the home path by `~`. The claude.ai connector's name is replaced by `[account connector]`.
- **Turns whose image showed another app's window.** Their tool inputs, results and replies are removed. The `PING` line (time, signal, source, target app) is kept.
  - 20:14:52, the tester's setup test ping;
  - 20:15:28 and 20:15:55, scripted Question pings whose 512 px region reached past the board;
  - 21:41:10, an emote the tester sent over another app.
- **Phrases removed elsewhere:**
  - two phrases in later handoffs and replies that described those windows;
  - one remark about another window's title strip (21:56:19–20).
  - Matching lines in the watcher logs are replaced by `[line redacted: content of another window]`.
- **Session S0** (20:09, first-run setup) is omitted. Both of its turns captured the settings window and a Finder window.
- **Captures not included:** those whose region reached another window (including 21:41:07, 21:47:29 and 21:56:09), the description-generated emote, and the generated candidates the tester did not keep.
- **Private and not published:** the raw status dumps (they contain unredacted event history) and the app's full capture folder.

## Files

- `timelines/`: per-session tool timelines built by [`scripts/timeline.mjs`](scripts/timeline.mjs) from the Claude Code session transcripts (`~/.claude/projects/<app data dir>/<session>.jsonl`). Long text is clipped.
- `watcher/`: script output from the run, each headed by its command, redacted by [`scripts/scrub.mjs`](scripts/scrub.mjs).
- `captures/`: the app's own copies of the ping regions (512×512).
- `screenshots/`: the reply card, captured from that window only.
- `emotes/`, `app-state/`: supporting files.
- `scripts/`: every script used. `run.sh` heads each log with its command.
- `recording/21-55-10_step8-hand-wheels.mov`: the tester's screen recording of step 8, unedited.
  - Recorded 21:55:10–21:57:17 (127 s), 1570×1046, with a stereo microphone track.
  - SHA-256 `19ba537ea9ae2bb6828c208ba57ffdc411e17f0b9949fb05356c25d44cdd2aa9`.
  - It shows only the Test Board, the two wheels, ping markers, the reply card and once the system volume overlay. The tester reviewed the audio before it was added.
