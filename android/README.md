# Minera Pará — app Android (TWA) e instalação no iPhone

**Abordagem:** Trusted Web Activity (TWA) gerada com o Bubblewrap CLI (`@bubblewrap/cli` 1.25).
O APK é uma "casca" de ~3,2 MB que abre o site no Chrome em tela cheia. Toda atualização do site
chega ao app na hora — só é preciso gerar um APK novo se mudar nome, ícone, cores, pacote ou domínio.

| Item | Valor |
|---|---|
| Pacote | `br.com.minerapara.app` |
| Versão | 1.0.1 (versionCode 2) — 1.0.0 (code 1) abria o github.io |
| Abre | `https://minerapara.com.br/index.html?utm_source=twa&apk=2` |
| Site x app | `/` (index.html) agora é o **site**; o app fica em `entrar.html`. O 1.0.1 abre `index.html?utm_source=twa…` e o site redireciona na hora para `entrar.html` (mesma query). APKs novos já usam `entrar.html` direto (`make-twa-manifest.mjs`). |
| minSdk / targetSdk | 21 (Android 5) / 36 |
| Permissões | `POST_NOTIFICATIONS`, `ACCESS_FINE/COARSE_LOCATION` (delegação de localização) |
| Certificado (SHA-256) | `5A:F6:5E:B5:5C:D5:80:0E:7A:68:27:AD:50:CE:26:4B:E8:E9:0D:4B:D7:D8:9A:49:A5:AB:F4:C5:6F:01:71:AE` |

## Arquivos

- `android/app-config.json` — **única fonte** de pacote, domínio, versão, cores e caminho da keystore.
- `android/make-twa-manifest.mjs` — gera o `twa-manifest.json` do Bubblewrap a partir do config.
- `android/build.sh` — gera, assina e copia: APK/AAB → `/workspace/minera-apk-out/`, APK → `download/minera-para.apk`,
  atualiza `download/app.json` e `android/assetlinks.json`.
- `android/make-assetlinks.mjs` — imprime o `assetlinks.json` para um ou mais fingerprints.
- `android/icons/` — ícone do launcher e ícone da Play Store (512×512). `icon-maskable-512.png` (raiz) = ícone adaptativo.
- `download/index.html` — página de download (Android: APK + passos; iPhone: Compartilhar → Tela de Início).
- **Keystore: `/workspace/minera-apk-keys/` (fora do repo, chmod 600). NUNCA comitar. Fazer backup em 2 lugares.**
  Sem ela não dá para atualizar o app já instalado nem publicar atualizações na Play.

## Gerar de novo

```bash
. /workspace/tools/env.sh           # JDK 17 + Android SDK
LOCAL_ICONS=1 bash android/build.sh # LOCAL_ICONS=1 pega os ícones deste worktree (antes de publicar)
```
Para uma versão nova: suba `appVersionName` e `appVersionCode` (+1) em `app-config.json`.

## Barra de endereço x Digital Asset Links

O TWA só abre **sem barra de URL** se o domínio provar que o app é dele com
`https://<host>/.well-known/assetlinks.json` **na raiz do domínio** (conteúdo em `android/assetlinks.json`).

- Hoje o site é um *project site* (`/minera-app/`). A raiz `facilveiculos2015-byte.github.io/` **não existe**
  (404) — não há repositório `facilveiculos2015-byte.github.io`. Sem isso o app funciona, mas mostra uma barra
  fina com a URL no topo (estilo Custom Tab).
- **Opção A (já, grátis):** criar o repositório público `facilveiculos2015-byte/facilveiculos2015-byte.github.io`
  com `.nojekyll` (vazio — sem ele o Jekyll ignora pastas com ponto) e `.well-known/assetlinks.json`.
  Não afeta `/minera-app/` (desde que esse repo não tenha uma pasta `minera-app`).
- **Opção B:** esperar o domínio `minerapara.com.br` e servir o assetlinks lá. Vai exigir APK novo de qualquer forma
  (o host fica gravado no APK), então os APKs instalados agora continuariam abrindo o github.io.

### Troca para minerapara.com.br (feita na 1.0.1 — branch `dominio`)

`APP_ROOT` agora é derivado em tempo de execução (config.js), `CNAME`, `.nojekyll` e `.well-known/assetlinks.json`
já estão no repo; `build.sh` regrava `.well-known/assetlinks.json`. O app 1.0.0 continua funcionando (o GitHub
redireciona) e, dentro dele, o site oferece o APK 1.0.1 (`?apk=` no start_url; ver `maybeOfferApkUpdate` em pwa.js).

Passos originais (referência):

1. DNS + GitHub Pages: domínio customizado no repo `minera-app` (cria `CNAME`). O site passa a ficar na **raiz** `/`.
2. Site: `APP_ROOT` em `config.js` (`'/minera-app/'` → `'/'`) e os ~29 caminhos fixos `/minera-app/` / URLs `og:` absolutas
   (`grep -rn minera-app --include=*.js --include=*.html .`). Supabase Auth → adicionar o novo Site URL / Redirect URLs.
3. assetlinks: com o site na raiz do domínio, basta comitar `.well-known/assetlinks.json` **no próprio repo minera-app**
   (+ `.nojekyll`). Teste: `https://minerapara.com.br/.well-known/assetlinks.json` deve responder 200 JSON.
4. App: em `android/app-config.json` troque `"host": "minerapara.com.br"`, `"basePath": "/"`, suba versão (1.0.1 / code 2) e
   rode `bash android/build.sh`. Mesmo pacote + mesma keystore ⇒ instala por cima e atualiza os usuários.
5. Se publicar na Play com *Play App Signing*, adicione também o SHA-256 da chave de assinatura do Play
   (Console → Integridade do app) ao assetlinks: `node android/make-assetlinks.mjs <SEU_SHA> <SHA_DO_PLAY>`.

## O que funciona no TWA (é o Chrome por baixo)

- Câmera/microfone (`getUserMedia`, áudio do chat), `<input type=file>` (fotos/anexos, câmera), geolocalização,
  Notification API e Web Push — todos com o diálogo de permissão do Chrome/Android. Notificações saem com o nome/ícone
  do app (delegação de notificação ativada, pede `POST_NOTIFICATIONS` no Android 13+).
- Service worker, offline e login Supabase são os mesmos do Chrome (cookies/storage compartilhados com o Chrome do aparelho).
- Requer Chrome (ou outro navegador com TWA) instalado; se não houver, abre em Custom Tab (`fallbackType: customtabs`).
- Capacitor só seria necessário para recursos nativos que a web não tem (ex.: Bluetooth clássico, contatos, NFC amplo,
  biometria nativa) ou para a App Store da Apple.

## iPhone

iOS não permite instalar app baixado do site. O botão **Baixar app** no iPhone mostra o guia
Compartilhar → Adicionar à Tela de Início (PWA em tela cheia, ícone próprio; Web Push funciona no iOS 16.4+ só a partir do
ícone da Tela de Início). App Store exige Apple Developer (US$ 99/ano), build em Mac (ou nuvem: Codemagic/EAS/GitHub
macOS runner) e um wrapper **Capacitor** com valor nativo (push nativo, câmera, compartilhamento etc.) — a Apple rejeita
"site embrulhado" (diretriz 4.2).

## Google Play (depois)

- Conta de desenvolvedor Google Play (US$ 25, taxa única) + verificação de identidade.
- Conta **pessoal** criada após nov/2023: teste fechado com **12 testadores por 14 dias seguidos** antes de liberar produção.
  (Conta de **organização** — exige CNPJ/D-U-N-S — não tem essa regra.)
- Enviar o **AAB** (`/workspace/minera-apk-out/minera-para-<ver>.aab`), não o APK. Ativar Play App Signing e adicionar o SHA-256
  do Play ao assetlinks.
- URL de **Política de Privacidade** pública, formulário **Segurança dos dados** (e-mail, nome, localização, fotos, mensagens,
  dados financeiros do Supabase), classificação de conteúdo, público-alvo, ícone 512×512 (`android/icons/play-store-icon-512.png`),
  feature graphic 1024×500, ≥2 screenshots de celular. Declarar permissão de localização.
- **Importante — mesma assinatura nos dois canais:** ao ativar o Play App Signing escolha *usar a sua própria chave*
  (exportar esta keystore com a ferramenta PEPK do Console). Assim o APK do site e o app da Play têm a mesma assinatura e um
  atualiza o outro. Se deixar o Google gerar uma chave nova, quem instalou o APK do site terá de desinstalar para instalar
  o da Play (e o assetlinks precisa dos dois SHA-256).
- O APK fica versionado no git (~3,4 MB por versão). Se as versões ficarem frequentes, mover para GitHub Releases
  e apontar o link do botão para o asset do release.
