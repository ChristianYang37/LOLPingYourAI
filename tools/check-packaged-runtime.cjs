#!/usr/bin/env node
// Check the shipped dependency tree, not the development checkout. No model call or login.
const assert = require('node:assert/strict');
const { existsSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve, join, relative, isAbsolute, dirname } = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
(async () => {
  const release = resolve(process.argv[2] ?? 'release');
  const candidates = process.platform === 'darwin'
    ? [`mac-${process.arch}/LOLPingYourAI.app/Contents/Resources/app`, 'mac/LOLPingYourAI.app/Contents/Resources/app']
    : ['win-unpacked/resources/app', `win-${process.arch}-unpacked/resources/app`];
  const root = candidates.map(p => join(release, p)).find(p => existsSync(join(p, 'package.json')));
  assert.ok(root, 'Packaged application not found');
  const req = createRequire(join(root, 'package.json'));
  const internal = path => {
    const rel = relative(realpathSync(root), realpathSync(path));
    assert.ok(!rel.startsWith('..') && !isAbsolute(rel), 'Dependency resolved outside the packaged app');
    return path;
  };
  const sdk = internal(req.resolve('@anthropic-ai/claude-agent-sdk'));
  const cli = internal(join(dirname(sdk), 'cli.js'));
  const version = execFileSync(process.execPath, [cli, '--version'], { timeout: 20000, encoding: 'utf8', windowsHide: true }).trim();
  assert.match(version, /Claude Code/);
  assert.equal(typeof (await import(pathToFileURL(sdk).href)).query, 'function');
  internal(req.resolve('sharp'));
  const sharp = req('sharp');
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffffff' } }).png().toBuffer();
  assert.equal((await sharp(png).metadata()).width, 2);
  console.log(`Packaged SDK import, bundled CLI (${version}) and sharp passed`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
