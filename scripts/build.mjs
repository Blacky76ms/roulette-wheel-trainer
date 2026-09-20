// Zero-dependency build: inlines src/*.js and styles.css into dist/index.html,
// stamps the service-worker cache name with a content hash, and draws the icons.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
// Dependency order. Modules use only named imports/exports, so stripping them is safe.
const MODULES = ['wheel', 'scheduler', 'items', 'questions', 'progress', 'storage', 'renderer', 'ui', 'app'];

function bundle() {
  const seen = new Map();
  const parts = MODULES.map((name) => {
    const source = readFileSync(join(ROOT, 'src', `${name}.js`), 'utf8')
      .replace(/^import[\s\S]*?from\s+'[^']+';\r?\n/gm, '')
      .replace(/^export\s+(?=(const|let|function|async|class)\b)/gm, '');
    if (/^\s*(import|export)\b/m.test(source)) throw new Error(`${name}.js: unsupported import/export form`);
    for (const [, id] of source.matchAll(/^(?:const|let|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(id)) throw new Error(`Top-level name "${id}" is declared in both ${seen.get(id)}.js and ${name}.js`);
      seen.set(id, name);
    }
    return `// ---- ${name}.js ----\n${source}`;
  });
  return `(() => {\n'use strict';\n${parts.join('\n')}\n})();`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

// Icon: a 37-pocket ring (one green, the rest alternating) on the app background.
function iconPng(size) {
  const shades = { bg: [11, 13, 16], red: [196, 32, 46], black: [24, 28, 33], green: [14, 138, 76], steel: [154, 164, 175], hub: [28, 33, 40] };
  const rows = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) / c;
      const turn = ((Math.atan2(x - c, c - y) / (2 * Math.PI)) + 1 + 0.5 / 37) % 1;
      const index = Math.floor(turn * 37);
      let shade = shades.bg;
      if (r < 0.8 && r >= 0.78) shade = shades.steel;
      else if (r < 0.78 && r >= 0.46) shade = index === 0 ? shades.green : index % 2 ? shades.red : shades.black;
      else if (r < 0.46 && r >= 0.44) shade = shades.steel;
      else if (r < 0.44) shade = shades.hub;
      rows.set(shade, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#0b0d10"/><circle cx="50" cy="50" r="31" fill="none" stroke="#c4202e" stroke-width="16" stroke-dasharray="5.27 5.27"/><circle cx="50" cy="50" r="39.5" fill="none" stroke="#9aa4af"/><circle cx="50" cy="50" r="22" fill="#1c2128" stroke="#9aa4af"/><path d="M47.4 11.2a39 39 0 0 1 5.2 0l-1.1 15.8a23 23 0 0 0-3 0z" fill="#0e8a4c"/></svg>';

mkdirSync(DIST, { recursive: true });
const html = readFileSync(join(ROOT, 'static', 'index.template.html'), 'utf8')
  .replace('/*__CSS__*/', () => readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8'))
  .replace('/*__JS__*/', () => bundle());
const hash = createHash('sha256').update(html).digest('hex').slice(0, 12);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'sw.js'), readFileSync(join(ROOT, 'static', 'sw.js'), 'utf8').replace('__BUILD_HASH__', hash));
copyFileSync(join(ROOT, 'static', 'manifest.webmanifest'), join(DIST, 'manifest.webmanifest'));
writeFileSync(join(DIST, 'icon.svg'), ICON_SVG);
writeFileSync(join(DIST, 'icon-180.png'), iconPng(180));
writeFileSync(join(DIST, 'icon-512.png'), iconPng(512));
writeFileSync(join(DIST, '.nojekyll'), '');
console.log(`Built dist/ (${(html.length / 1024).toFixed(1)} kB, cache ${hash})`);
