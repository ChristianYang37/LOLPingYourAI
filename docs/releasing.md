# Release procedure / 发布流程

A merged commit, a CI artifact and a public installer are different deliverables. / 合并提交、CI 构建产物和正式安装包是三个不同交付物。

1. Prepare a release PR: update `package.json` version and `docs/releases/vX.Y.Z.md`, both README download links if versioned, and the compatibility/verification notes. Do not imply unsigned builds are notarized.
2. Pass current PR CI and review the final diff; squash merge. Confirm main includes the intended features.
3. Tag the merged commit: `git tag vX.Y.Z <commit>` then `git push origin vX.Y.Z`. Do not move a published tag.
4. `Release desktop installers` checks tag/version/notes, calls the full CI matrix, and publishes the exact tested Windows x64 NSIS and macOS arm64 DMG artifacts. Only the publish job receives contents-write permission. A failed platform prevents publication.
5. Inspect the release, download filenames and workflow commit. Test the installed application on the systems actually available. Record permission prompts, version/build commit, and limitations; CI cannot certify every user's desktop permissions.
6. A failed publish can be rerun after inspecting the reason. If a release already exists, reconcile its assets deliberately; never blindly overwrite a released installer. A defective published version gets a new patch version or is marked prerelease with explanation.

The macOS build currently uses ad-hoc signing and is not notarized. Existing permissions can need re-association after an update; keep the bundle ID stable. Developer ID signing/notarization requires the maintainer's Apple credentials and is a separate infrastructure step. Windows signing likewise requires signing credentials.

版本与 release notes 必须匹配；只有全平台构建和检查成功才同时发布 Mac/Windows 安装包。CI 自动写入 `buildCommit`，便于区分同版本开发构建。不要反复重装调试版本要求用户重复授权；完成验证后再替换安装版。发布后核查下载资产，记录真实验证范围。不要求用户进行 SHA256 校验。

GitHub Actions trust boundary: PR checks have read-only repository access and no model keys. Never check out untrusted PR code in `pull_request_target` with write tokens. Sources: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use).
