# Desktop acceptance tools / 桌面验收工具

Small Node 22+ tools adapted from [csxq0605's PR #8](https://github.com/ChristianYang37/LOLPingYourAI/pull/8), reviewed at `1d94a25`. The original scripts, recordings and tester reports remain in that PR. Only reusable code, example configuration and tests are included here; no recordings, screenshots, personal state or checksums.

## Compatibility

| Surface | Support and evidence |
| --- | --- |
| macOS / Windows | Node filesystem/HTTP APIs, native app data paths, optional `desktop-helper doctor`; no zsh, pgrep, osascript or fixed coordinates |
| Codex / Claude / DSH | Common bridge task/context state determines completion; event summaries recognize each adapter's emitted event formats |
| Automated tests | Local macOS protocol, loopback HTTP, CLI and Test Board manifest tests; the CI matrix runs them on both operating systems |
| Real model / desktop | Not rerun by this refactor. Neither protocol tests nor a successful watch demonstrate a working native input path |

中文：默认日志放在应用数据目录，仓库保持干净。脚本兼容三个 harness 的状态协议，不代表已经重新完成三者的真实桌面验收。Windows 实机仍需测试。所有测试仅面向一次性 Test Board，不操作你的其他窗口。

## Commands

Run from the repo root, or use an absolute path to `run.mjs` from any directory. JSON plans avoid shell quoting differences between PowerShell and zsh.

```sh
node tools/acceptance/run.mjs status
node tools/acceptance/run.mjs watch --seconds 60
pnpm exec electron tools/test-board.cjs
```

With the board still open, select/sign in to the desired harness in the app and run from another terminal:

```sh
node tools/acceptance/run.mjs drive --plan tools/acceptance/observe.example.json
```

Change `harness` in a copied plan to `claude` or `dsh` as appropriate. A DSH observation requires an image-capable model. Test plans do not change the selected harness, account, skill, model, effort or user configuration. They use the installed app's existing adapter and tools. Each live run can consume the configured provider's quota.

`LOLPINGAI_DATA_DIR` or `--data-dir` overrides the app data path. `LOLPINGAI_TEST_BOARD_FILE` selects a separate board manifest; pass the same path through `--board` on the runner. The default board file is `lolping-test-board.json` in the system temp directory, preserving the earlier note-value API.

The updated board publishes its PID, native window ID, unique instance, logical bounds and heartbeat. The runner refuses stale/restarted manifests and sends a tracked window target instead of a desktop point. The app resolves that target and applies its ordinary screenshot and action protections. Window captures are intentionally used: this tool does **not** test cursor hit-testing, wheel input or full-desktop capture. Those remain manual cases. Do not enable accessibility explicitly on the board during a cold-start regression test: that would mask issue #9.

## Editing, correction and stopping

Non-observation steps require `--allow-actions`. For example, save this locally as a plan, then use `drive --plan <path> --allow-actions`:

```json
{
  "harness": "claude",
  "steps": [
    { "signal": "assist", "message": "Only edit this disposable Test Board. Replace its note with Ping received.", "after": "done", "expectText": "Ping received" },
    { "signal": "danger", "message": "Restore the Test Board note to Ready for a ping.", "after": "done", "expectText": "Ready for a ping." }
  ]
}
```

Use `after: "working"` followed by `danger` or `retreat` to exercise interruption while the test is active. Allowed waits: `received`, `working`, `waiting`, `done`, `stopped`. A `done` wait requires the matching context and task phase plus idle state; `expectText` compares the board's own independently reported value. A model can honestly say it was unable to edit and still complete a turn, so always use `expectText` for edit assertions. `working` can be brief and missed by polling; a timeout is not proof that work never started.

Wrong harness, active unrelated work, unknown signals, queueing, changed targets, a failed turn, mismatched note value and timeout all fail the command. On a failed run, the runner requests stop only if the still-active context belongs to its own test; it logs whether cancellation was confirmed. If the bridge is unreachable, use the app's Retreat or emergency-stop shortcut. Final steps using `received`/`working` intentionally leave the turn running; normally finish a plan with `done` or `retreat`.

## Wards, restarts, lock state and stale contexts

Place/cancel wards manually using the Test Board and inspect the ward ID locally in settings/CLI. The runner does not change your ward delay.

```sh
node tools/acceptance/run.mjs ward --id WARD_ID --expect completed --timeout-ms 2100000
node tools/acceptance/run.mjs stale --context OLD_CONTEXT_ID --allow-actions
```

Ward watching reloads bridge credentials after app restarts, rejects failed/uncertain/disappeared wards, and distinguishes cancellation from completion. `--expect cancelled` checks the cancelled state; it does not establish that no visit ever happened. Neither terminal-state polling nor the bridge's bounded history proves exactly-once delivery: that needs scheduler regression tests plus a correlated event trace. The stale probe is a Shift-key request against an old context while the current target is the idle Test Board; only the precise stale-context refusal counts, not network or authentication errors.

For lock observations, `watch --helper <absolute-path-to-desktop-helper>` additionally polls the helper's read-only `doctor` output (use `desktop-helper.exe` on Windows). No harness is launched by that optional probe. Sleep suspends the watcher; timing gaps alone are not evidence of system sleep. Attach OS power-log excerpts separately when claiming exact sleep/wake times.

## Local output and transcript summaries

Each run writes a new timestamp-and-UUID JSONL file under `<app-data>/acceptance/`, with restricted permissions where supported. `--output` can choose a path outside the checkout or under ignored `.local/`; existing files are never overwritten. Generated output is not committed.

`status` and `watch` save structural state and event types, not prompts, replies, tool arguments, screenshots, session IDs, window titles or paths. Duplicate events at the same millisecond are counted separately. The app's 150-entry history and polling can still lose events; this is a diagnostic observer, not an exhaustive recorder. Provider-reported model names and adapter-reported effort are kept as separate evidence levels.

```sh
node tools/acceptance/run.mjs timeline --input /path/to/private-transcript.jsonl
```

`timeline` accepts Claude JSONL transcripts or a JSON object with the bridge's `history` array (all harnesses). It writes structural summaries only. It intentionally does not copy/redact an entire raw transcript: keep raw transcripts private, and manually review any report before attaching it publicly. DSH/Codex native transcript formats are not parsed directly; use their bridge history.

## Verification

```sh
pnpm test:acceptance
```

The tests use synthetic targets and local mock bridges; they do not operate your desktop or call a model. They cover path conventions, changed bridge credentials, failure/timeout exit codes, stale targets, context ownership, all three harnesses, ward outcomes, duplicate timestamps and output minimization. Full native input, clipboard, rendering, multi-display/DPI and signed-in model checks remain separate acceptance work.

Local validation for this refactor: all 21 new tool tests and 40 existing focused core/Claude/service/desktop tests passed (61 total), plus TypeScript checking and JavaScript syntax checking. Windows CI is configured but has not yet been run for this branch; no Windows hardware or live model results are implied.

See [the issue audit and repair plan](../../docs/claude-acceptance-audit.md) for the unresolved findings in #8 and #9.

### macOS native identity regression

After `pnpm build:desktop`, run `pnpm exec electron tools/window-identity-test/main.cjs` and click **Run tests**. On macOS, if the helper reports a different permission state from Electron's System Settings entry, launch Electron through Launch Services with the absolute test script path (`open -n -a /path/to/Electron.app --args /absolute/path/to/tools/window-identity-test/main.cjs`). This preserves Electron's own authorization context; it does not grant permissions. The controller waits three seconds before starting. Avoid keyboard/mouse use while it runs. It creates a separate cold Electron process, checks actual textarea values and restoration, then exercises identical windows, four-corner resize/restore and rejected stale/modal/covered targets. Do not inspect the cold process with accessibility tools beforehand. Reports remain under ignored `.local/`.
