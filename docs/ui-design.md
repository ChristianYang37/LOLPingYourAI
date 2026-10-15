# Chat-first desktop UI

## Implemented locally (2026-10-15)

The default window is a teammate conversation surface. The top-right Settings button opens categorized configuration and returns to the same draft. The tray's Settings action opens configuration directly; its AI Teammate action opens chat. Model selection remains in teammate settings, reachable from the home model chip.

The main conversation uses the available current-task reply, without the three-line truncation used by the floating card. Its composer stays at the bottom and supports starting a text-only session without a prior ping or desktop permissions. A later ping adds window context to that teammate session. Enter sends, Shift+Enter inserts a newline, and IME composition does not send. Streaming follows the bottom unless the reader scrolls up. The empty state explains the configured trigger and three common signals. Missing helper access and unfinished setup use a compact actionable banner. The floating card remains a lightweight desktop companion.

Settings show one category at a time. The duplicate conversation and duplicate harness/model controls were removed from setup. A neutral light/dark palette, restrained green accent, monochrome navigation, consistent spacing and original LoL signal artwork replace the mixed visual styles.

## Next improvements, in priority order

1. **Group conversation records by task.** User text/signals, assistant replies and reverse pings are now retained in a local presentation log with pagination. Further group these records by task; do not fabricate historical messages that were never stored.
2. **Context summary.** Show the target application/window and a small expandable capture beside each ping. Make window changes and an unavailable target obvious. Keep screenshots in local user data with bounded retention.
3. **Readable rich replies.** Add safe Markdown rendering for headings, lists, code blocks and links. Keep raw HTML disabled; open external links through the existing checked main-process path. Paper explanations would benefit from equations later.
4. **Attention without interruption.** Unread badges for completed replies and questions, an obvious waiting state, and click-to-open behavior. Do not steal focus or bring every streaming token to the foreground.
5. **Smaller operational controls.** A compact ward countdown/cancel area and clearer pause/stop feedback. Model selection can later become a small popover, while connection diagnostics stay in settings.

## Verification

`pnpm build && pnpm exec electron tools/check-chat-ui.cjs` runs the production renderer against local IPC fixtures, without model calls or desktop control. It checks the default route, settings navigation, full replies, draft retention, context-aware follow-up submission, stop requests, IME behavior and a 720×520 dark layout. It writes preview images into the system temporary directory. These are UI regression checks, not a new live agent acceptance run.
