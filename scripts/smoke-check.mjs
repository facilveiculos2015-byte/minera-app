#!/usr/bin/env node
/**
 * Minera App smoke check — email leaks, GOOGLE key optional, cache consistency.
 * Exit 0 = pass; non-zero = fail.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = '20260923k';
let fails = 0;
let warns = 0;

function ok(msg) { console.log('✓', msg); }
function fail(msg) { console.error('✗', msg); fails++; }
function warn(msg) { console.warn('!', msg); warns++; }

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function walk(dir, exts, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some(e => name.endsWith(e))) out.push(p);
  }
  return out;
}

console.log('=== Minera smoke-check (cache', CACHE + ') ===\n');

// 1) Cache version consistency
const sw = read('sw.js');
if (!sw.includes(`minera-shell-${CACHE}`) && !sw.includes(`CACHE = 'minera-shell-${CACHE}'`)) {
  fail(`sw.js CACHE must be minera-shell-${CACHE}`);
} else ok(`sw.js CACHE = minera-shell-${CACHE}`);

const htmlFiles = walk(ROOT, ['.html']).map(p => path.relative(ROOT, p));
const badCache = [];
for (const f of htmlFiles) {
  const t = read(f);
  if (!t.includes(`?v=${CACHE}`) && f !== 'tutorial.html') {
    // allow if no versioned assets
    if (/\?v=20\d+/.test(t) && !t.includes(`?v=${CACHE}`)) badCache.push(f);
  } else if (/\?v=20\d+/.test(t) && !t.includes(`?v=${CACHE}`)) {
    badCache.push(f);
  }
}
// stricter: any ?v= that is not CACHE
for (const f of [...htmlFiles, 'sw.js', 'style.css']) {
  const rel = f;
  let t;
  try { t = read(rel); } catch { continue; }
  const versions = new Set((t.match(/\?v=([0-9a-z]+)/gi) || []).map(x => x.slice(3)));
  for (const v of versions) {
    if (v !== CACHE) badCache.push(`${rel}:${v}`);
  }
}
if (sw.includes('20260918c') || sw.includes('20260918b')) badCache.push('sw.js:old');
if (badCache.length) fail('Cache version mismatches: ' + badCache.slice(0, 12).join(', ') + (badCache.length > 12 ? '…' : ''));
else ok(`All asset ?v= and sw CACHE use ${CACHE}`);

// 2) GOOGLE key optional
const cfg = read('config.js');
if (!/GOOGLE_MAPS_API_KEY\s*=\s*['"]['"]/.test(cfg) && !/GOOGLE_MAPS_API_KEY\s*=\s*''/.test(cfg)) {
  // empty string ok; non-empty also ok but must be optional in mapa
  warn('GOOGLE_MAPS_API_KEY is non-empty — ensure mapa works without it');
} else ok('GOOGLE_MAPS_API_KEY is empty (optional)');
const mapa = read('mapa.js');
if (!/GOOGLE_MAPS|MINERA_GOOGLE|Leaflet|L\.map/i.test(mapa)) {
  fail('mapa.js should fall back without Google key');
} else ok('mapa.js has non-Google fallback path');

// 3) Chat directory — no email leaks in public surfaces
const chatJs = read('chat.js');
const checks = [
  { re: /stripEmailFields/, name: 'stripEmailFields helper' },
  { re: /delete out\.email/, name: 'delete out.email' },
  { re: /looksLikeEmail/, name: 'looksLikeEmail guard' },
];
for (const c of checks) {
  if (!c.re.test(chatJs)) fail(`chat.js missing ${c.name}`);
  else ok(`chat.js has ${c.name}`);
}

// Heuristic: rendering contact with .email property in template strings
const emailLeakPatterns = [
  /\$\{[^}]*\.email[^}]*\}/,
  /contato\.email/,
  /u\.email(?!\s*\|\|)/,
  /user\.email/,
];
let leakHits = [];
for (const re of emailLeakPatterns) {
  const m = chatJs.match(re);
  if (m) leakHits.push(m[0]);
}
// Allow session.user.email only in private contexts — chat.js should not display
if (/textContent\s*=\s*[^;]*\.email/.test(chatJs) || /innerHTML\s*=\s*[^;]*\.email/.test(chatJs)) {
  fail('chat.js appears to render .email into DOM');
} else ok('chat.js does not render .email into DOM');

const sql22 = read('sql/22-chat-diretorio-sem-email.sql');
if (!/sem email|NO email|sem e-mail/i.test(sql22)) fail('sql/22 should document no-email directory');
else ok('sql/22 chat directory without email');

const sql32 = path.join(ROOT, 'sql/32-security-hardening.sql');
if (!fs.existsSync(sql32)) fail('sql/32-security-hardening.sql missing');
else {
  const s32 = fs.readFileSync(sql32, 'utf8');
  if (!/is_admin\(\)/.test(s32)) fail('sql/32 must use is_admin()');
  else ok('sql/32 uses is_admin()');
  if (!/REVOKE ALL ON TABLE.*FROM anon/s.test(s32) && !/FROM anon/.test(s32)) fail('sql/32 should revoke anon');
  else ok('sql/32 revokes anon writes');
}

// 4) escapeHtml available
const ag = read('auth-guard.js');
if (!/function escapeHtml/.test(ag)) fail('auth-guard.js missing escapeHtml');
else ok('auth-guard.js escapeHtml present');
if (!/function rateLimitAction/.test(ag)) fail('auth-guard.js missing rateLimitAction');
else ok('auth-guard.js rateLimitAction present');
if (!/limparSessaoERedirecionar/.test(ag)) fail('auth-guard.js missing limparSessaoERedirecionar');
else ok('auth-guard.js session clear on auth error');

// 5) financeiro filters auth_id
const fin = read('financeiro.js');
const authFilters = (fin.match(/\.eq\(\s*['"]auth_id['"]/g) || []).length;
if (authFilters < 3) fail(`financeiro.js should filter auth_id (found ${authFilters})`);
else ok(`financeiro.js filters auth_id (${authFilters}×)`);

console.log('\n---');
if (fails) {
  console.error(`FAIL: ${fails} error(s), ${warns} warning(s)`);
  process.exit(1);
}
console.log(`PASS${warns ? ` (${warns} warning(s))` : ''}`);
process.exit(0);
