# 贡献指南

[English](CONTRIBUTING.md)

较大的行为变化先开 issue 讨论；从最新 main 建立分支或 fork，保持每个 PR 解决一个完整问题。欢迎 AI 辅助贡献，但提交者必须理解最终代码并验证结果，保留复用代码与素材的署名。

## 开发与检查

使用 Node 22、pnpm 10。macOS 安装 Xcode Command Line Tools；Windows 工具链见 [Windows 文档](docs/windows.md)。

```sh
pnpm install --frozen-lockfile --ignore-scripts
node node_modules/electron/install.js
pnpm typecheck
pnpm test
pnpm test:acceptance
pnpm test:helper
pnpm build:desktop
pnpm build
pnpm exec electron tools/check-chat-ui.cjs
pnpm test:performance
```

桌面输入测试使用可丢弃窗口；开发 Electron 与安装版的权限相互独立。[验收工具](tools/acceptance/README.md) 提供真实桥接测试入口。不要用扩大无关权限的方式掩盖测试失败。

## 什么样的证据有用

- UI：类型检查、渲染回归、可复现步骤或截图。
- 路由、skill、服务：正常与异常协议用例；涉及停止、连发时补回归。
- 原生输入：helper 测试与对应系统的真实测试窗口结果。
- 安装发布：打包运行检查、安装器 CI。
- 真实模型：注明系统、harness、模型、步骤、结果和未覆盖范围。

模拟协议通过不等于真实推理，CI 打包通过不等于所有实机兼容。没有某个平台就明确写未验证，维护者可协助。源码只保留有用脚本和简短证据说明；大型录像用外链，不提交账号凭据、个人截图、session、构建产物和安装包。

## PR 流程

填写模板，说明修改前后行为、测试命令、测试提交和剩余限制。检查最终 diff，修复阻塞问题，再测试变更后的提交。普通修复不自行发布新版本。

CI 覆盖 macOS/Node 22、Windows 2022/Node 22、Windows 2025/Node 24，执行类型、单元/协议/验收、原生、UI、合成性能与打包检查；Windows 还验证安装、重启、卸载及无密钥 DSH 协议发现。统一汇总检查名为 **Required checks**。外部 PR 不接触服务商密钥和写权限 token；新贡献者的 CI 可能需维护者批准运行。

维护者应在 GitHub 主分支 ruleset 中要求 PR、Required checks、重新审核已修改提交并禁止强推。仓库配置文件不会自动开启这些网站设置，不能未经核实就声称已强制执行。修复阻塞问题且最终提交检查通过后 squash merge。GitHub 不允许作者批准自己的 PR；维护者自行合并不等于独立审核批准。

## 发布与安装

参见[发布流程](docs/releasing.md)。PR 合并后，已安装应用不会自动变化；正式安装包来自打 tag 后的 GitHub Release。英文指南包含更详细的证据对照表。
