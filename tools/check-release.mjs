import { readFileSync, existsSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag ?? '') || tag !== `v${version}`) throw new Error('Release tag must equal v + package.json version');
if (!existsSync(new URL(`../docs/releases/${tag}.md`, import.meta.url))) throw new Error('Release notes are missing');
console.log(`Release metadata verified: ${tag}`);
