import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(root, 'build'), { recursive: true });
const result = process.platform === 'darwin'
  ? spawnSync('swiftc', [join(root, 'main.swift'), join(root, 'WindowIdentity.swift'), '-O', '-framework', 'Cocoa', '-framework', 'ApplicationServices', '-o', join(root, 'build/desktop-helper')], { stdio: 'inherit' })
  : process.platform === 'win32'
    ? spawnSync(join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/r:System.Web.Extensions.dll', '/r:System.Drawing.dll', `/out:${join(root, 'build/desktop-helper.exe')}`, join(root, 'Main.cs')], { stdio: 'inherit' })
    : { status: 1, error: new Error('Desktop helper supports macOS and Windows') };
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
