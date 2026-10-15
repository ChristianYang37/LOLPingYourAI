# Windows portable build

The Windows build ships as a GitHub Release asset rather than a file in this repository: the
portable executable is 258 MB, over GitHub's 100 MiB per-file limit for git.

**Download:** https://github.com/fzh000543/LOLPingYourAI/releases/tag/v0.1.1-win.1

- `LOLPingYourAI-0.1.1-portable.exe` — 免安装便携版，双击即用，不写注册表。
- `SHA256SUMS` lists its SHA-256. The same file is committed here next to this note.

## Verify

```powershell
certutil -hashfile LOLPingYourAI-0.1.1-portable.exe SHA256
```

Expected `452a403d300f62e8b2cac46695345c3361264cc48c27868c64932ff21a40025e`.

## Run

1. Double-click the executable. The app has no main window and lives in the tray, so nothing appearing is normal.
2. Open settings from the tray and check that the teammate harness is `codex` and that the machine is signed in (`codex login`).
3. `Alt` + left-drag opens the signal wheel, `Ctrl` + drag opens the emote wheel.
4. `Ctrl`+`Alt`+`P` toggles the teammate, `Ctrl`+`Alt`+`Esc` takes control back.
5. The build is unsigned, so SmartScreen warns once: *More info* → *Run anyway*.

Every reply is also written to `<desktop>/LOLPingYourAI-replies/YYYYMMDD-HHMMSS-<signal>.txt`; set `LOLPINGAI_REPLY_DIR` to write them elsewhere.

## Known limits

- One global input helper at a time: quit a `pnpm dev` instance first, and note that both share `%APPDATA%\LOLPingYourAI`.
- The portable build has no auto-update.
- Low-level input hooks do not reach elevated windows; do not run it as administrator.
- Upstream still lists Windows as "adapters included, not validated on a machine yet".
- Built from `main` at `7c6edc1` plus the Simplified Chinese reply work; the release assets carry `CHANGES.md`.
