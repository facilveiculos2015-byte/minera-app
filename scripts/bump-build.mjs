#!/usr/bin/env node
/**
 * Minera Pará — bump de build (hard reset PWA).
 * Uso: node scripts/bump-build.mjs 20260924c
 * Atualiza: pwa.js ASSET_V, sw.js CACHE/PRECACHE, version.json e TODAS as refs ?v=<antigo>
 * em *.html / *.js / *.css / *.webmanifest (exceto docs/, scripts/, .git, node_modules).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const novo = (process.argv[2] || '').trim();
if (!/^\d{8}[a-z]+$/.test(novo)) {
  console.error('Uso: node scripts/bump-build.mjs <AAAAMMDD + letras>  ex.: 20260924c');
  process.exit(1);
}
const pwa = fs.readFileSync(path.join(ROOT, 'pwa.js'), 'utf8');
const m = pwa.match(/ASSET_V\s*=\s*'([0-9a-z]+)'/);
if (!m) { console.error('ASSET_V não encontrado em pwa.js'); process.exit(1); }
const antigo = m[1];
if (antigo === novo) { console.error('Build já é ' + novo); process.exit(1); }

const SKIP = new Set(['.git', 'node_modules', 'docs', 'scripts']);
const EXT = new Set(['.html', '.js', '.css', '.webmanifest']);
const alterados = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXT.has(path.extname(name).toLowerCase())) continue;
    const t = fs.readFileSync(p, 'utf8');
    if (!t.includes(antigo)) continue;
    fs.writeFileSync(p, t.split(antigo).join(novo));
    alterados.push(path.relative(ROOT, p));
  }
})(ROOT);

fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({ build: novo }) + '\n');
alterados.push('version.json');

// Sanidade
const pwa2 = fs.readFileSync(path.join(ROOT, 'pwa.js'), 'utf8');
const sw2 = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const ok = pwa2.includes(`ASSET_V = '${novo}'`) && sw2.includes(`minera-shell-${novo}`);
console.log(`bump ${antigo} → ${novo}: ${alterados.length} arquivos`);
alterados.forEach((f) => console.log('  ' + f));
if (!ok) { console.error('FALHA: pwa.js/sw.js não ficaram com o novo build'); process.exit(2); }
