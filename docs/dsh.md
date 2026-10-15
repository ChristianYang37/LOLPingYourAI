# DeepSeek Harness (DSH)

[English](#english) · [中文](#中文)

## English

LOLPingYourAI connects to the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through **ACP**, not through a replacement agent loop. DSH owns models, credentials, history and tools. The adapter starts a local stdio process, attaches the same desktop MCP, creates/resumes dedicated sessions, forwards results and waits for cancellation confirmation. Reactions are delivered after the current turn because ACP does not offer mid-turn steering.

Tested CLI: **`@deepseek-ai/dsh@0.2.0-rc.2`**. This is a developer preview; pin the version. With Node.js 22.19+ or 24+, install it separately from the app:

```sh
npm install --prefix "$HOME/.local/share/lolpingyourai-dsh" @deepseek-ai/dsh@0.2.0-rc.2
```

On macOS the app discovers that installation automatically. For another location (including Windows), set `LOLPINGAI_DSH` to the absolute path of `@deepseek-ai/dsh/lib/bin.js` before launching the app. This variable names the JavaScript entry, not the shell launcher. DSH remains optional; Codex and Claude do not load its dependencies.

### Free text trial

The [SiliconFlow pricing page](https://www.siliconflow.cn/pricing) listed `Qwen/Qwen3-8B` at zero cost when checked on 2026-10-15. It needs your own provider account/key. Re-check pricing before use. This is a **text-only** model: the trial verifies API responses, not screenshot understanding. There is no fallback to a paid model.

1. Store `SILICONFLOW_API_KEY` locally through DSH's credential configuration or your shell environment. Never put a real key in this repo or chat.
2. Copy [the example patch](../examples/dsh-siliconflow.patch.yml) to `~/Library/Application Support/LOLPingYourAI/dsh.patch.yml`. Alternatively set `LOLPINGAI_DSH_PATCH` to its absolute path. The app reads the patch at startup; restart after changing it.
3. Select **DeepSeek Harness** in teammate settings and check the connection. For a text-only route, emotion pings work; screenshot requests explain that a vision model is needed.

From a source checkout:

```sh
node tools/try-dsh.mjs         # real ACP process, no model API call
node tools/try-dsh.mjs --live  # requires SILICONFLOW_API_KEY in this shell
```

The live test sends a tiny text prompt to the configured free route. Credentials stay in DSH, outside runtime status, screenshots and source files. A desktop app started from Finder does not automatically inherit terminal environment variables; use DSH's own credential store or launch the app from the configured shell.

Reasoning is a **relative index**: `0` selects the lowest advertised level; `1` selects the next; values above the available range select the highest. For the example route the two advertised choices are `off` and `high` (thinking off/on). A route without a reasoning selector ignores the index.

### Bailian vision trial

The [Bailian example](../examples/dsh-bailian.patch.yml) uses `qwen3.8-flash` with text, image and tool support. Check your own Beijing-region quota and enable **free quota only / stop when exhausted** for this model before testing. A signup allowance is account-specific and expires; this is not an indefinitely free model. Store `DASHSCOPE_API_KEY` through DSH's credential settings. For new keys, replace the example `baseURL` with the OpenAI-compatible workspace URL displayed when the key is created. Copy the patch to the same runtime path above and restart the app.

`node tools/try-dsh.mjs --bailian` checks ACP without a model request; adding `--live` uses `DASHSCOPE_API_KEY` from the shell for a small text request. The source example uses the generic endpoint; the desktop runtime patch can use your workspace endpoint. Never commit either a real key or an account-specific runtime file.

**Evidence (2026-10-15):** the real DSH process passed ACP initialization, session creation, MCP discovery, close and resume on macOS. With a user-owned Bailian key and workspace endpoint, DSH returned the expected text and read `ORBIT42` plus red/blue circles from a synthetic image; effective reasoning was `off`. The first image answer omitted the text; an explicit two-field request passed. After desktop permissions were granted, the installed app completed a real assist ping: read a local test page, reverse-ping, click/type, screenshot verification and restoration of the original note. Independent input events confirmed both edits. That installed build required a uniquely sized window. The source now includes the exact-window identity repair and independent Electron/Chrome/Safari regressions in [window-identity.md](window-identity.md); a full DSH model-driven run with the new helper has not been repeated. SiliconFlow model inference and Windows hardware remain untested. Unit tests cover effort mapping, text/image admission and cancellation.

## Thinking controls

Thinking is enabled by default. The numeric effort setting selects among the model’s advertised **enabled** levels: `0` means the lowest enabled level, `1` the next. A separate DSH checkbox disables thinking only when the provider offers an off option. The example Qwen routes advertise only `off` and `high`, so every enabled index resolves to `high`; this does not mean DSH itself has only two levels. DeepSeek’s native adapter advertises `off`, `low`, `high`, and `max`. These are native ACP/API settings, not invented prompt presets. Customize task wording separately under **Signals**. Models without an advertised selector retain their provider defaults; the app does not claim to control their effort. Earlier live evidence using `off` below predates this default change.

## 中文

通过 DeepSeek 官方 **ACP** 接口接入。模型、凭据、历史和工具仍由 DSH 自己管理；我们只传递 ping、skill、截图和桌面 MCP。ACP 不支持途中追加，因此表情在当前轮结束后继续发送。撤退必须等原请求确认取消。

使用上方安装命令下载固定版本 **0.2.0-rc.2**。macOS 安装目录会自动发现；自定义路径或 Windows 可用 `LOLPINGAI_DSH` 指定 `@deepseek-ai/dsh/lib/bin.js` 的绝对路径。

免费试用配置选用硅基流动 `Qwen/Qwen3-8B`，2026-10-15 官方价格页标为免费。需要你自己的账户和 key，不会自动切换付费模型。它只支持文本：适合验证连接、表情对话，不能证明截图理解或桌面执行成功。

将示例 YAML 复制到 `~/Library/Application Support/LOLPingYourAI/dsh.patch.yml`，通过 DSH 自己的凭据配置保存 key，或者从设置了 `SILICONFLOW_API_KEY` 的终端启动应用。不要把 key 写进仓库或发到聊天里。更改 patch 后重启，在队友设置里选择 DSH。命令行 `node tools/try-dsh.mjs` 只验证协议；加 `--live` 才调用模型，缺少 key 时会直接说明原因。

思考强度按序号选档：`0` 最低、`1` 第二低，超出数量取最高。示例模型只有关/开两个档位；不支持调节的模型忽略该设置。

也可使用[百炼视觉配置](../examples/dsh-bailian.patch.yml)：模型为 `qwen3.8-flash`。先确认北京地域的账户免费额度，并为该模型开启“免费额度用完即停”。将 `DASHSCOPE_API_KEY` 保存到 DSH 凭据库，把示例 `baseURL` 换成创建 Key 时显示的业务空间 OpenAI 兼容地址，再复制到应用运行配置并重启。免费额度有期限，不代表模型长期免费。`node tools/try-dsh.mjs --bailian` 验证协议，加 `--live` 后从终端环境读取 Key 并发送文字测试。

2026-10-15 已通过 DSH＋百炼真实文字回答和合成图片识别：读取 `ORBIT42` 与红、蓝圆形，最低思考档为 `off`。第一次图片回答漏掉文字，明确要求两个字段后通过。桌面权限生效后，安装版完成真实求助 ping：读取测试页面、反 ping、点击输入、截图核验并恢复原文，页面独立记录了两次实际输入。那次安装版测试使用了尺寸不同的独立窗口。当前源码已包含窗口 ID 修复及 Electron／Chrome／Safari 独立回归，详见 [window-identity.md](window-identity.md)；新 helper 与 DSH 模型的完整闭环尚未重跑。硅基流动真实推理、Windows 实机尚未验证。

思考默认开启。数字档位只计算后端提供的开启档：`0` 最低、`1` 次低；关闭思考使用独立开关。百炼示例只有 `off/high`，因此开启时都映射到 `high`，不是 DSH 只有两档。DeepSeek 原生适配器提供 `off/low/high/max`。原生强度通过 ACP/API 设置；任务提示词在「信号」里独立编辑。没有声明档位的模型保留提供商默认值。上文 `off` 的实测记录属于默认值修改之前的版本。
