# Changes — 2026-10-15

本轮改动的说明，覆盖两块：队友回复行为、Windows 打包。

**English summary:** teammate replies are requested in Simplified Chinese, every finished reply is
archived to a text file next to the desktop, the Codex app-server no longer exposes the unrelated
`node_repl` MCP server, and the Windows build also produces a portable executable.

## 1. 队友回复改用简体中文（新增）

- `ai/service.mjs`：下发 ping 的首个 prompt 追加一条要求——所有面向用户的回复（含 `reply_ping` 文案）用简体中文，代码、命令、文件路径和窗口标题保持原样。
- `ai/service.mjs`：情绪（emote / steer）分支同样追加"用简体中文回复"。
- `skills/lolping-your-ai/SKILL.md`：技能文档写明同一要求。
- Codex / Claude / DSH 三个 harness 共用这段 prompt，行为一致。

## 2. 回复落盘（新增）

- `ai/service.mjs` 新增 `archiveReply(harness, text)`：每当一条 `agentMessage` 完成（`item/completed` 且 `type` 为 `agentMessage`）且正文非空时，把回复写成一个 txt。
- 目录：默认 `<桌面>/LOLPingYourAI-replies/`，可用环境变量 `LOLPINGAI_REPLY_DIR` 覆盖。
- 文件名：`YYYYMMDD-HHMMSS-<信号>.txt`，例如 `20261015-192456-missing.txt`。
- 正文开头是元信息头：Harness、时间、信号与模式、目标窗口（标题与 pid）、contextId。
- 技能里同步说明"落盘由应用负责，队友不要自己写文件"。

## 3. Codex 子进程不再暴露无关 MCP（修复）

- `ai/harness/codex.mjs`：启动 `codex app-server` 时增加 `-c mcp_servers.node_repl.enabled=false`。
- 原因：`node_repl` 与本项目无关，但它会出现在工具列表里，导致每次 ping 都卡在审批提示上。

## 4. Windows 打包（新增）

- `package.json`：Windows 目标由 `nsis` 扩展为 `nsis` + `portable`，便携版产物名为 `LOLPingYourAI-<版本>-portable.exe`。
- 国内网络下打包必须走镜像，否则 Electron 运行时压缩包或 NSIS 工具链会 `ETIMEDOUT`：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_CUSTOM_DIR="{{ version }}"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm dist
```

  两个变量各管一半，缺一不可：`ELECTRON_MIRROR` 管 Electron 运行时压缩包，`ELECTRON_BUILDER_BINARIES_MIRROR` 管 NSIS / winCodeSign 工具链。
- 若本机 pnpm 的 `minimumReleaseAge` 策略拦截了 `pnpm run`/`pnpm exec`，可直接调用 CLI：
  `node node_modules/electron-builder/out/cli/cli.js --win --publish never`。
- 产物（`release\`）：
  - `LOLPingYourAI-Setup-<版本>.exe` —— NSIS 安装版，可选安装目录，创建开始菜单/桌面快捷方式，支持应用内"开机自启"。
  - `LOLPingYourAI-<版本>-portable.exe` —— 免安装单文件版，双击即用（自动更新不可用）。
  - `win-unpacked\` —— 解包目录，便于替换图标重新打包或直接调试。
- 构建未做代码签名，首次运行会被 SmartScreen 拦一次，选择"更多信息 → 仍要运行"。
- 注意：应用没有主窗口，双击后只有托盘图标，总开关是 `Ctrl`+`Alt`+`P`。

## 验证

- `node --test ai/test/*.test.mjs` → 58 通过（新增 2 条：中文 prompt、回复落盘到指定目录）
- `npx vitest run` → 710 通过
- `npx tsc --noEmit` → 通过
