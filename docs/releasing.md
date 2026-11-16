# Release procedure / 发布流程

A merged commit, a CI artifact and a public installer are different deliverables. / 合并提交、CI 构建产物和正式安装包是三个不同交付物。

1. Prepare a release PR: update `package.json` version and `docs/releases/vX.Y.Z.md`, both README download links if versioned, and the compatibility/verification notes. Do not imply unsigned builds are notarized.
2. Pass current PR CI and review the final diff; squash merge. Confirm main includes the intended features.
3. Tag the merged commit: `git tag vX.Y.Z <commit>` then `git push origin vX.Y.Z`. Do not move a published tag.
4. `Release desktop installers` checks the tag/version/notes and runs the CI matrix. After it passes, the `sign-mac` job builds the tagged commit with Developer ID and Hardened Runtime, submits the signed DMG to Apple, and staples the accepted ticket. It checks Gatekeeper, both native helpers and the packaged runtime, then launches the app from that DMG. The publish job receives the verified DMG and the tested Windows x64 NSIS artifact; it alone has contents-write permission. A signing or notarization failure stops publication.
5. Inspect the release, download filenames and workflow commit. Test the installed application on the systems actually available. Record permission prompts, version/build commit, and limitations; CI cannot certify every user's desktop permissions.
6. A failed publish can be rerun after inspecting the reason. If a release already exists, reconcile its assets deliberately; never blindly overwrite a released installer. A defective published version gets a new patch version or is marked prerelease with explanation.

For official macOS releases, configure a GitHub Actions environment named `macos-release`. Restrict deployments to protected release tags and configure reviewers as appropriate for the signing team. Use the issuing Apple Developer team's credentials:

| Environment entry | Value |
| --- | --- |
| Variable `MACOS_TEAM_ID` | Ten-character team ID for the Developer ID Application certificate. |
| Secret `MACOS_CERTIFICATE_P12_BASE64` | Base64-encoded password-protected PKCS#12 export of the Developer ID Application certificate **with its private key**. |
| Secret `MACOS_CERTIFICATE_PASSWORD` | Export password. |
| Secrets `MACOS_NOTARY_KEY_BASE64`, `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER` | Base64-encoded App Store Connect **team** API key (.p8), its key ID and issuer UUID for notarization. |

The tag job requires these entries. PR builds and local `pnpm dist:mac` builds stay ad-hoc and need no signing secrets. Keep the bundle ID stable and test Accessibility and Screen Recording permissions on an actual installation, particularly when moving from an ad-hoc build. Mark a release notarized in its public notes only after verifying the released artifact. Windows signing requires its own credentials. [Apple's Developer ID and notarization guide](https://developer.apple.com/developer-id/).

版本与 release notes 必须匹配；只有全平台构建和检查成功才同时发布 Mac/Windows 安装包。CI 自动写入 `buildCommit`，便于区分同版本开发构建。不要反复重装调试版本要求用户重复授权；完成验证后再替换安装版。发布后核查下载资产，记录真实验证范围。不要求用户进行 SHA256 校验。

GitHub Actions trust boundary: PR checks have read-only repository access and no model keys. Never check out untrusted PR code in `pull_request_target` with write tokens. Sources: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use).
