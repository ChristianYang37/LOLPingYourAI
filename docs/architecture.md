# Architecture and protocol

`native input → Electron overlay → confirmed local ping → capture → Teammate → HarnessAdapter → MCP → scoped desktop helper`

The inherited C++ helper implements press–drag–release, cancellation and input passthrough. Each display has an inactive overlay. Confirmed pings use display-local logical coordinates converted once into global logical coordinates. Agent replies use `spawnRemote` and cannot re-enter the user queue. Network room transports and the upstream updater are not instantiated.

## Capture and target identity

A ping selects a window ID plus owning PID, window bounds and a normalized anchor within that window. The focus is a configurable 512×512 logical-pixel square. Images captured by exact window ID are resampled to one image pixel per logical pixel. Negative display coordinates and edge padding are explicit in `region.valid`, `region.padding`, `region.scaleFactor` and `imageScale`. Pixels outside the selected window are padded, even when another window covers the ping point. Window identity and bounds are checked again after capture. Overlay windows are hidden during capture and restored inactive.

Each action resolves the window identity again. Coordinate actions are rejected after a bounds change until a new screenshot. Closing a window fails the visit rather than using stale coordinates. Type/key actions require the selected window to acquire foreground control. The focus square does not restrict relevant controls elsewhere in that same window.

## Sessions and cancellation

Each harness has one persistent teammate identity. The app resumes that native identity regardless of idle duration and across app restarts. The harness manages context and compaction; the app imposes no session lifetime or timed reset. Old `sessionHours` settings and expiry flags are ignored. Existing unrelated chats use explicit task handoff; the demo never claims to own an external session.

Codex uses App Server JSON-RPC: initialize, thread/start, thread/resume, turn/start, turn/steer and turn/interrupt. Loaded thread IDs are cached per child process: resuming a freshly created thread can fail because its rollout does not exist yet. A process restart clears this cache. Skill input is explicit, and a copy is installed under the runtime workspace's `.agents/skills`.

Claude uses the Agent SDK async message stream with sessionId/resume, image blocks, project MCP and interrupt. Programmatic native Claude Computer Use is not assumed: its documented macOS interactive feature is not available in `-p` mode. The current implementation uses project MCP on both platforms.

Claude's built-in tool set is limited to read-only `Read`, `Grep` and `Glob`, so the skill can recover intent from session history, project files and memory. A `PreToolUse` hook — evaluated before any allow-rule in the user's Claude settings — refuses every other tool, MCP tools of other servers, credential folders and key files, and searches over the whole home directory. Claude has no mid-turn steering here: an emote reaction that arrives during a turn is streamed as the next user message of the same session once the current turn's result arrives, instead of interrupting the work. A session ID that Claude never persisted (for example after a failed first turn) is restarted once under the same ID rather than failing every later ping. `LOLPINGAI_CLAUDE` selects a different Claude Code executable.

If Codex App Server exits, its active turns are reported as failed, so interruption and ward follow-ups do not wait for a completion that can no longer arrive; the next ping starts a fresh server. Concurrent callers share one initialization, so no request is sent before `initialized`.

One action gate serializes desktop operations. Warning/retreat invalidate the generation immediately, revoke new actions, request harness interruption and wait for confirmation and in-flight compatible actions. A timeout reports an unconfirmed stop. An old queued capture/session creation cannot re-enable the gate. A regular observe ping cannot click/type. This protects the cooperating project backend; it is not an OS sandbox around arbitrary tools a user adds to a harness.

## Local bridge and state

MCP is stdio; its child receives a random per-launch capability token for a loopback HTTP broker. Browser Origin requests and unauthenticated calls are rejected. Settings IPC validates its sender. MCP exposes only context/screenshot/action/reply/ward/handoff/icon tools, while the local CLI also has configuration and session operations. User text travels as JSON and process argument arrays, never interpolated shell commands.

State lives in the application data directory, with atomic JSON replacement and restrictive POSIX permissions. Captures, tokens, session IDs and local icons never belong in Git. Event receipts survive restart. A separate `ai-conversation.json` display log retains user messages/signals, assistant replies and displayed reverse pings; it does not replace or replay native harness history. The UI loads recent entries and can page backwards. Text streaming is checkpointed every 500 ms; abrupt process termination may lose the last unflushed fragment. Screenshot/tool payloads are excluded. Wards persist independently: pending visits survive restart/sleep, lock waits, completed/failed/cancelled visits are not repeated. An interrupted `visiting` record becomes `uncertain` for review instead of silently repeating an operation.

## Extending

- `ai/config.mjs`: defaults and mappings; the skill reads effective runtime config.
- `ai/service.mjs`: routing, task ownership, interruption and session handoff.
- `ai/harness/`: Codex/Claude adapters.
- `ai/desktop.mjs`, `native/desktop/`: captures and platform input.
- `ai/server.mjs`, `ai/mcp.mjs`: broker and MCP schema.
- `src/main/teammate.ts`: Electron lifecycle and settings integration.
- `skills/lolping-your-ai/SKILL.md`: teammate behavior.

Official references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude Computer Use](https://code.claude.com/docs/en/computer-use). Native Codex Computer Use is detected, but the demo selects the project backend so coordinate mapping and cancellation share one gate. This is an intentional compatibility choice; native backend cancellation integration remains future work.

## Explicit icon generation

The Generate button starts a separate harness adapter with a short-lived local bridge exposing only `submit_icon`. Ordinary teammate MCP sessions do not list or accept that operation. Completion, cancellation and a 15-minute deadline revoke the generation connection. Candidate metadata distinguishes output format from whether a reference image was supplied; it does not assert that the model used the reference.
