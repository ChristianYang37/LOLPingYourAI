# Model refresh and latency audit — 2026-10-16

Base: `4f5e3c3` on `origin/main` (includes v0.1.2 / PR #12). Work is on `codex/model-refresh-latency`; the previous dirty worktrees were preserved.

## Model discovery

- Codex previously used the catalog's `isDefault` instead of the user's effective configured model. On this machine `config/read` returned `gpt-6-astra`, while `model/list` marked `gpt-6.1-sol` default. The picker and turn routing now honor the configured model, include a configured custom ID, and allow an explicit model ID. The backend validates access; listing is not an entitlement check. Unknown model capabilities are not invented: no guessed effort or fast tier is sent. Refresh restarts only the idle owned App Server and resumes the saved thread with the configured provider; history is not reset. Resume excludes the unneeded full transcript payload.
- DSH uses the `acp` profile plus the application's optional `dsh.patch.yml` / `LOLPINGAI_DSH_PATCH`. Editing another profile does not alter this effective configuration. `config_option_update` now updates loaded session metadata, and explicit refresh restarts the idle ACP process before querying a new temporary discovery session. Redundant effort-setting RPCs are skipped when the current option already matches.
- Claude `supportedModels()` is not an exhaustive list of custom gateway IDs. Discovery adds model names configured in Claude settings/environment, and explicit IDs are delegated to Claude rather than rejected locally. The installed SDK is 0.2.141; its declaration says omitted `settingSources` loads all sources, so missing `settingSources` is **not** established as the cause on this machine. The discovery process now uses `strictMcpConfig` too. Shell-only environment changes are not magically inherited by an already-running GUI application.
- Opening AI settings or choosing Refresh reloads native configuration while idle. Refresh cannot interrupt an active turn. Incoming pings queue during reload. Credentials remain in harness configuration; the UI takes model IDs only. Provider/profile routing must be configured in the relevant harness.

Sources: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [catalog versus access](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [Claude model configuration](https://code.claude.com/docs/en/model-config), and the installed DSH 0.2.0-rc.2 ACP implementation (`config_option_update`).

## Timing evidence

Text-only probe, isolated temporary workspace and session, literal “reply only OK” request, standard routing, ordinal effort 0. No screen capture, desktop actions or user documents. Model generation probes were Codex only; Claude and DSH were discovery-only.

| Measurement | Observed |
| --- | ---: |
| Native discovery, Codex before changes | 232 ms |
| Native discovery, Claude | 622 ms |
| Native discovery, DSH | 953 ms (835 ms initialize, 111 ms session/new) |
| Codex initial sample, first turn submission / first text / completion | 167 / 12,816 / 12,885 ms |
| Codex initial sample, warm turn submission / completion | 26 / 4,280 ms |
| Instrumented matched model gpt-6.1-sol, first turn submission / first text / completion | 168 / 15,051 / 15,141 ms |
| Instrumented matched model, warm turn submission / first text / completion | 32 / 4,800 / 4,878 ms |

The original warm-turn first-text probe accidentally observed the previous task's text and was discarded; the retained probe checks task identity. These few noisy samples are **not a speedup benchmark**. In these text samples the bulk of elapsed time occurred after handoff to the harness, which includes harness startup, MCP/tool exchanges, provider/network waits and generation; it is not a measurement of pure model latency. Screenshot capture was not part of these samples.

## Lightweight changes

- Claude now requests partial messages and forwards text deltas immediately, reconciling the completed message so text is not duplicated. Previously the UI waited for the complete assistant message. Protocol tests cover this; no real Claude streaming-inference claim is made.
- Codex catalog discovery is cached between turns and invalidated on explicit refresh / process restart.
- UI change notifications are coalesced at 80 ms; ordinary renderer status excludes raw diagnostic history. Settings no longer list icon files for every streamed delta or poll every three seconds.
- Pings no longer repeat the entire user mappings/config object in the prompt. `get_context` remains the authoritative effective configuration source.
- Task timings expose queue, capture, native session setup, adapter submission, first visible text and total duration in Settings → AI Teammate → Connection & diagnostics. `submitMs` measures the adapter method returning, not provider acceptance; Claude/DSH finish startup asynchronously. Timings are also retained with conversation entries. No prompts, credentials or screenshots are added to timing data.

## Reproduce

```sh
node tools/diagnostics/latency.mjs codex
node tools/diagnostics/latency.mjs claude
node tools/diagnostics/latency.mjs dsh
# Explicit --turns invokes the chosen model and can use account quota; default is discovery only.
node tools/diagnostics/latency.mjs codex --turns 2 --model gpt-6.1-sol
node ai/cli.mjs models '{"harness":"codex","refresh":true}'
```

The probe keeps its isolated local state in a temporary directory and prints only model names, operation names and durations. It does not replace personal harness settings or the app's teammate session.

## Installed macOS verification

The built application was installed at `/Applications/LOLPingYourAI.app`. Its existing Accessibility and Screen Recording grants were re-associated with the updated signed bundle; the installed `doctor` reports both true. The previous bundle was retained as a local backup. No GitHub release was published by this audit.

An actual read-only Question ping targeted only the disposable Electron Test Board. The installed app used the configured `gpt-6-astra`, correctly described the board, completed, and displayed a reply ping. The practice note was unchanged. The chat retained the earlier entries and the new diagnostic exchange. The settings UI displayed the configured default model, refresh/custom-ID controls and timings.

| Installed screenshot-ping stage | Observed |
| --- | ---: |
| Queue | 7 ms |
| Screenshot capture pipeline | 1,750 ms |
| Session preparation | 312 ms |
| Adapter submission | 12 ms |
| Ping to first text | 10,649 ms |
| Ping to completion | 16,957 ms |

This is a different model and workload from the text-only probe, not a before/after comparison. The local capture pipeline is a material contributor. Code inspection shows it enumerates window thumbnails with Electron `desktopCapturer.getSources`, then resolves the target again and crops/encodes the image. These internal stages were not individually profiled, so the 1,750 ms must not be attributed entirely to enumeration. A target-specific capture path is a candidate for further measurement; the window identity and movement checks must remain intact.

Installed native refresh also succeeded for Codex (268 ms, 7 models, configured default `gpt-6-astra`), Claude (787 ms, 4 aliases) and DSH (1,112 ms, 3 provider/model choices including Bailian). This verifies native discovery on the current configuration; it does not prove every third-party provider configuration or real inference with Claude/DSH. Config changes and custom names are covered by automated fixtures; no fake provider credentials were added to the user's configuration.

Validation: 711 Vitest tests passed with 1 skipped; 102 AI/acceptance tests passed with 2 skipped; TypeScript, production build, chat UI fixture, native helper builds, macOS arm64 directory packaging, packaged SDK/runtime checks and strict bundle signature checks passed. Windows hardware and Claude/DSH real inference were not retested in this audit.
