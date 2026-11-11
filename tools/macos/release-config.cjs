// The normal package configuration stays ad-hoc for development and PRs.
const { build } = require('../../package.json');
const team = process.env.MACOS_TEAM_ID;
const commit = process.env.GITHUB_SHA;
if (!/^[A-Z0-9]{10}$/.test(team ?? '')) throw new Error('A valid MACOS_TEAM_ID is required');
if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('A full GITHUB_SHA is required');

module.exports = {
  ...build,
  forceCodeSigning: true,
  extraMetadata: { buildCommit: commit },
  mac: {
    ...build.mac,
    identity: team,
    type: 'distribution',
    hardenedRuntime: true,
    entitlements: 'tools/macos/entitlements.plist',
    entitlementsInherit: 'tools/macos/entitlements.plist',
    // This standalone executable has its own Developer ID signature and Bun entitlements.
    signIgnore: ['/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude$'],
    // The workflow submits the final signed DMG containing the signed app.
    notarize: false,
  },
  dmg: { ...build.dmg, sign: true },
};
