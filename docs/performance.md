# Local latency regression

`pnpm test:performance` runs production image processing, conversation updates and service streaming code in Electron. It uses synthetic images and a mock harness: **no API keys, network calls, real desktop capture or account quota**. The main build workflow runs it for macOS and both Windows runners on pushes and pull requests, before packaging. A failing budget fails that job. JSON measurements are uploaded as `performance-*` artifacts even when a budget fails (30-day retention).

## Budgets and method

Each benchmark uses 12 samples after image-path warmup. Image paths alternate order and compare against the frozen pre-optimization implementation on the same machine. Relative gates reduce runner-speed sensitivity; generous absolute p95 budgets catch severe stalls. The report records runtime versions, platform, sample counts, medians and p95. It contains no user content.

| Workload | Gate |
| --- | --- |
| 3840×2160 synthetic opaque bitmap → 512×512 focus PNG | Median <80% of whole-window PNG reference; p95 <1500 ms |
| 1000 reply updates with 50,000 retained chat rows | Median <50% of linear-scan reference; p95 <250 ms |
| 1000 text events through the actual teammate service, 50,000 retained rows | p95 <500 ms; exact final text and retained chat required |

Image correctness checks compare decoded output pixel-for-pixel against the reference for 2× and 1.5× scaling, edge padding, translucent input and unknown bitmap layout. An additional check rejects whole-window PNG encoding on the opaque fast path. The existing desktop tests retain window identity, moved-window rejection and coordinate checks. UI tests verify diagnostics is absent and no permission/connection probe runs until explicitly requested.

These budgets cover local processing, not OS window enumeration, screenshot permissions, IPC/rendering, disk persistence or provider latency. They do not certify a maximum end-to-end ping time. For real harness measurements, use the opt-in `tools/diagnostics/latency.mjs` probe described in [the latency audit](model-refresh-and-latency.md), or inspect request timings after an actual ping. Do not add credentials to PR CI.

## Changes and measurements

The image path now reads native bitmap pixels, copies only the focus region, resizes it and encodes the final PNG once. Bitmap channel order is checked using a known pixel; unsupported formats or translucent regions use the PNG fallback rather than guessing channel order or alpha premultiplication. Source resolution and all target identity/movement checks are retained. NativeImage bitmap layout is documented as platform-dependent in [Electron's API](https://www.electronjs.org/docs/latest/api/native-image).

Conversation IDs have an in-memory index rebuilt from the existing history file at startup. Streaming updates and pagination no longer scan all old messages. No chat records are discarded and the harness remains responsible for its own context. Disk snapshots still use the existing atomic persistence path.

Local Apple Silicon measurements (Electron 44.5.1, 12 samples): image processing median **88.53 → 26.99 ms**; 1000 history updates **86.05 → 0.022 ms**; 1000 service text events median **0.128 ms**. These are synthetic component measurements, not an end-to-end speedup claim. An initial NativeImage crop-before-PNG attempt took 114 ms versus an 88 ms reference and was rejected by this same performance gate.

## Diagnostics default

`diagnosticsEnabled` defaults to `false`, including migration of configurations without the field. Enable it manually in Settings → AI Teammate. While off, the connection/diagnostics panel is not mounted and raw protocol events are not collected. Disabling it clears the in-memory protocol history. Ordinary chat, signal records, errors, explicit setup permission checks and inexpensive per-request timing counters continue to work. The setting is local; enabling it does not upload telemetry. Acceptance event watchers require opting in if protocol events are needed.

The CI jobs must run on GitHub before claiming hosted macOS/Windows measurements. Local passing results alone do not establish Windows performance.
