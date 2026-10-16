# Contributing to LOLPingYourAI

[中文](CONTRIBUTING.zh-CN.md)

Start with a bug report or small proposal for broad behavior changes. Fork the repository, branch from current `main`, and submit a focused PR. Credit reused code and assets. AI-assisted contributions are welcome; the author must understand and verify the final diff.

## Local setup

Use Node 22 and pnpm 10. macOS needs Xcode Command Line Tools; Windows needs the C++ desktop build tools / Windows SDK and .NET SDK used by `native/desktop/build.mjs`. See [Windows development](docs/windows.md).

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

Native desktop experiments require OS permissions and a disposable target. Do not grant an agent unrelated desktop access to make a test pass. [Acceptance tools](tools/acceptance/README.md) document the real bridge probes. Development Electron and the installed application have separate permission identities.

## Evidence appropriate to the change

| Change | Required evidence |
| --- | --- |
| UI | Typecheck, renderer regression, screenshot or fixture reproduction |
| Service / routing / skill | Protocol and behavior cases, cancellation and repeated-signal regression when affected |
| Native input | Helper tests and a disposable real-app reproduction on the changed OS |
| Packaging / release | Packaged-runtime smoke test and installer CI |
| Real model claims | Harness/provider/model, exact steps, sanitized observations, limitations |

Do not claim real desktop/model coverage from mocks. If you cannot test an OS, say so; maintainers can reproduce it before merging. Keep evidence summaries small. Recordings, screenshots of personal work, account keys, local state, `node_modules`, and installers do not belong in source commits.

## PR and review

Use the PR template. Explain the user-visible problem, solution and verification, not the conversation with your AI. Review the final diff for accidental files and unsupported claims. Fix blocking findings and rerun affected checks. Rebase/merge current main when necessary; test the final revision.

CI runs on PRs, main pushes and explicit dispatch: macOS/Node 22, Windows 2022/Node 22, Windows 2025/Node 24. It covers types, unit/protocol/acceptance tests, native helpers, renderer fixtures, synthetic performance and packaging. Windows also exercises install/restart/uninstall and DSH protocol discovery without API credentials. The stable aggregate check is **Required checks**. Fork PRs run without provider keys or write tokens; first-time contributors may need a maintainer to approve the CI run.

Maintainers should configure the main branch ruleset to require PRs and **Required checks**, dismiss stale approvals, and disallow force pushes. Workflow files cannot enable a repository ruleset; inspect GitHub Settings before claiming enforcement. Reviewers distinguish blocking bugs from suggestions. Squash merge only after the current revision passes; GitHub does not allow authors to approve their own PRs, so a maintainer merge is not an independent approval.

## Release

See [release procedure](docs/releasing.md). Merging a PR does not update installed apps. Official downloads are the assets of a tagged GitHub Release, not a contributor fork or an arbitrary workflow artifact.
