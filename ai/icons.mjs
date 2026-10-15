import sharp from 'sharp';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function validateSvg(svg) {
  if (typeof svg !== 'string' || svg.length > 100000 || !svg.trim().startsWith('<svg')) throw new Error('Expected a standalone SVG under 100 KB');
  if (/<!|<\?|\bon\w+\s*=|href\s*=|url\s*\(|@import|data:|file:|https?:|<\s*(script|foreignObject|image|use|style|animate|set)\b/i.test(svg.replace('http://www.w3.org/2000/svg', ''))) throw new Error('SVG contains external or active content');
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc']);
  for (const tag of svg.matchAll(/<\/?\s*([\w:-]+)/g)) if (!allowed.has(tag[1])) throw new Error(`Unsupported SVG element: ${tag[1]}`);
  return svg;
}

export class IconCandidates {
  constructor(directory) { this.directory = directory; }
  async submit({ name, svg, pngBase64 }, source = 'image-tool', metadata = {}) {
    if (typeof name !== 'string' || name.length > 80) throw new Error('Invalid icon name');
    let bytes, method;
    if (svg) { bytes = Buffer.from(validateSvg(svg)); method = 'vector-generated'; }
    else { if (typeof pngBase64 !== 'string' || pngBase64.length > 10000000) throw new Error('Invalid PNG'); bytes = Buffer.from(pngBase64, 'base64'); if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG'); method = source; }
    const png = await sharp(bytes, { limitInputPixels: 8192 * 8192 }).resize(512, 512, { fit: 'contain', background: '#00000000' }).png().toBuffer();
    const id = randomUUID(); await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, `${id}.png`), png, { mode: 0o600 });
    const candidate = { id, name, method, referenceProvided: metadata.referenceProvided === true }; await writeFile(join(this.directory, `${id}.json`), JSON.stringify(candidate), { mode: 0o600 });
    return { ...candidate, awaitingUserPreview: true };
  }
  async reference(pngBase64) {
    if (typeof pngBase64 !== 'string' || pngBase64.length > 10000000) throw new Error('Invalid reference image');
    const bytes = await sharp(Buffer.from(pngBase64, 'base64'), { limitInputPixels: 4096 * 4096 }).resize(512, 512, { fit: 'inside' }).png().toBuffer();
    const dir = join(this.directory, 'references'); await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${randomUUID()}.png`); await writeFile(path, bytes, { mode: 0o600 }); return path;
  }
  async list() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const files = (await readdir(this.directory)).filter(x => x.endsWith('.json'));
    return Promise.all(files.map(async file => { const c = JSON.parse(await readFile(join(this.directory, file), 'utf8')); return { ...c, preview: `data:image/png;base64,${(await readFile(join(this.directory, `${c.id}.png`))).toString('base64')}` }; }));
  }
  async prepare(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid candidate');
    const c = JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8'));
    const still = await sharp(join(this.directory, `${id}.png`)).resize(160, 160).webp({ quality: 70 }).toBuffer();
    return { name: c.name, still: new Uint8Array(still) };
  }
}
