// Gera twa-manifest.json (formato Bubblewrap) a partir de android/app-config.json.
// Uso: node make-twa-manifest.mjs <outDir> [iconBaseUrl]
// iconBaseUrl: de onde baixar os ícones no build (padrão = site publicado).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'app-config.json'), 'utf8'));
const outDir = process.argv[2];
if (!outDir) { console.error('uso: node make-twa-manifest.mjs <outDir> [iconBaseUrl]'); process.exit(1); }
const base = cfg.basePath.endsWith('/') ? cfg.basePath : cfg.basePath + '/';
const site = `https://${cfg.host}${base}`;
const iconBase = (process.argv[3] || site).replace(/\/?$/, '/');

const m = {
  packageId: cfg.packageId,
  host: cfg.host,
  name: cfg.name,
  launcherName: cfg.launcherName,
  display: 'standalone',
  orientation: 'portrait',
  themeColor: cfg.themeColor,
  themeColorDark: cfg.backgroundColor,
  navigationColor: cfg.navigationColor,
  navigationColorDark: cfg.navigationColor,
  navigationDividerColor: cfg.navigationColor,
  navigationDividerColorDark: cfg.navigationColor,
  backgroundColor: cfg.backgroundColor,
  enableNotifications: true,
  startUrl: `${base}index.html?utm_source=twa`,
  iconUrl: `${iconBase}android/icons/icon-app-512.png`,
  maskableIconUrl: `${iconBase}icon-maskable-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: cfg.keystorePath, alias: cfg.keyAlias },
  appVersion: cfg.appVersionName,
  appVersionCode: cfg.appVersionCode,
  shortcuts: [],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: `${site}manifest.webmanifest`,
  fallbackType: 'customtabs',
  features: { locationDelegation: { enabled: true } },
  alphaDependencies: { enabled: false },
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  fullScopeUrl: `${site}`,
  minSdkVersion: 21,
  fingerprints: [],
  additionalTrustedOrigins: [],
  retainedBundles: []
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'twa-manifest.json'), JSON.stringify(m, null, 2));
console.log('twa-manifest.json ->', outDir, '| start:', `https://${cfg.host}${m.startUrl}`);
