// Imprime o assetlinks.json (Digital Asset Links) para o TWA.
// Uso: node make-assetlinks.mjs <SHA256 do certificado AA:BB:...> [<SHA256 da chave do Play App Signing>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-config.json'), 'utf8'));
const fps = process.argv.slice(2).filter(Boolean).map((s) => s.toUpperCase());
if (!fps.length) { console.error('informe ao menos 1 fingerprint SHA-256'); process.exit(1); }
console.log(JSON.stringify([{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: cfg.packageId, sha256_cert_fingerprints: fps }
}], null, 2));
