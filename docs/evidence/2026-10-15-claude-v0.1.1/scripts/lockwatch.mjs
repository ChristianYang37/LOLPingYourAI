// Logs screen-lock transitions once a second (CGSSessionScreenIsLocked in the IORegistry console-user entry; the key
// appears only while locked), until the deadline.  Usage: node lockwatch.mjs <deadline>
import { execFileSync } from 'node:child_process';
const deadline = Date.parse(process.argv[2]), t = () => new Date().toLocaleTimeString('en-GB');
let last = null;
while (Date.now() < deadline) {
  const locked = /"CGSSessionScreenIsLocked"=Yes/.test(execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' }));
  if (locked !== last) { console.log(t(), locked ? 'LOCKED' : 'unlocked'); last = locked; }
  await new Promise(r => setTimeout(r, 1000));
}
