# Ligação de voz no chat (fase 1 — só no TESTE)

## Como funciona
- Botão 📞 no topo da conversa (app `chat.html` e Chat Minera `/chat/`). Grupos e conversas bloqueadas: sem botão.
- **WebRTC 1:1 só de áudio.** Criptografado ponta a ponta (DTLS-SRTP), inclusive quando passa pelo TURN.
- **Estado oficial no banco** (`public.chamadas`, `sql/63-chamadas.sql`): `tocando → atendida → encerrada`,
  ou `recusada` / `perdida` (sem resposta em 45 s ou quem ligou desistiu) / `ocupado`.
  RLS: só os 2 participantes leem a linha; ninguém grava direto: só as funções `chamada_*` (SECURITY DEFINER),
  que conferem quem pode fazer o quê (só quem recebe atende/recusa, só quem ligou manda oferta, etc.).
- **Sinalização robusta:** mudanças chegam por Realtime (postgres_changes) **e** por consulta a cada 2 s enquanto conecta
  (se o Realtime cair a ligação continua). Oferta/resposta (SDP) ficam na linha (durável); candidatos ICE vão ao vivo
  pelo canal Realtime **privado** `chamada:<id>` (policy em `realtime.messages`: só os 2, só enquanto tocando/atendida)
  e a descrição completa é regravada no banco quando a coleta termina.
- **Privacidade de IP:** nada de SDP/candidato antes de atender (quem só liga não descobre o IP de quem não atendeu);
  SDP apagado do banco no fim; opção `MINERA_CHAMADA_CFG = { soRelay: true }` = só TURN (o outro lado nunca vê seu IP).
- **Queda de rede:** `disconnected` 2,5 s ou `failed` → ICE restart (quem ligou renegocia; quem recebeu pede pelo canal);
  volta da internet/app volta para a tela → reconecta. 25 s sem voltar → encerra ("Ligação caiu").
  Servidor fecha ligação esquecida (sem "ping" por 90 s) e toque velho (> 50 s).
- **Toque** gerado por WebAudio (sem arquivo): recebendo (vibra no Android), chamando (425 Hz, padrão BR), ocupado, fim.
- **Mudo, alto-falante** (setSinkId onde existe; no iPhone a saída é escolhida pelo sistema), **cronômetro**.
- **Microfone solto** em todo fim (desligar, recusar, sem resposta, ocupado, erro, sair da página): todas as trilhas
  `stop()`, `RTCPeerConnection.close()`, canal removido → o indicador laranja do iPhone some.
- **App fechado:** push `"📞 Fulano está te ligando"` (send-push v4, TTL 45 s, abre `chat.html?com=…&chamada=…`).
  iPhone (app da Tela de Início): o aviso chega; tocar abre o app já na tela de atender. App aberto: toca no app.
- **Registro no chat** (tipo `chamada`): "Chamada de voz · 2:35", "recusada", "perdida" (quem ligou vê "não atendida").
  Só "perdida" gera push de mensagem (substitui o aviso de toque — mesmo tag).
- Limites: 15 ligações / 10 min por pessoa; 4 não atendidas seguidas para a mesma pessoa em 10 min; bloqueio impede ligar.

## TURN (para funcionar em 4G/CGNAT/Wi-Fi de empresa)
Edge Function `turn-credenciais` entrega credencial **curta** (padrão 2 h) só para participante de ligação ativa;
o segredo fica só no servidor. Provedores plugáveis (secrets da função):
1. **Cloudflare Realtime TURN (recomendado):** `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`.
   US$ 0,05/GB, **1.000 GB/mês grátis** (https://developers.cloudflare.com/realtime/turn/faq/ ,
   https://developers.cloudflare.com/realtime/sfu/pricing/). Áudio Opus ≈ 0,3–0,5 MB/min por sentido →
   1.000 GB ≈ 1 milhão+ de minutos relayados/mês grátis (e só ~10–20% das ligações precisam de TURN).
2. **coturn próprio:** `TURN_SHARED_SECRET`, `TURN_URLS` (VPS ~US$ 5–10/mês + banda; você mantém o servidor).
- Metered.ca: grátis só 500 MB/mês; depois US$ 99/mês (150 GB) (https://www.metered.ca/stun-turn).
- Twilio NTS: US$ 0,40/GB (EUA/Europa), **US$ 0,80/GB em São Paulo**, sem franquia (https://www.twilio.com/en-us/stun-turn/pricing).
Sem TURN configurado: só STUN público (Cloudflare/Google) — funciona na maioria das redes, pode falhar em algumas.

## Falta para ligar no STAGING (ldzefbwdghqiudafqjar)
1. SQL Editor do minera-teste: rodar `sql/63-chamadas.sql` (conferência no fim: tabela, rls, funcoes=6, policies_rt=2, publicacao, gatilho_push).
2. Edge Functions: publicar a nova `send-push` (v4) e a nova `turn-credenciais` (Verify JWT **ligado**).
3. (TURN) Cloudflare → Realtime → TURN → criar chave; secrets da `turn-credenciais`: `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`.
Produção: nada mudou.

## Testes
- `minera-teste-setup/qa2/chamada/teste.sql` — regras do SQL 63 num Postgres 17 local (25 checagens).
- `minera-teste-setup/qa2/chamada/chamada.js` — Playwright visível, 3 navegadores, microfone falso, WebRTC real,
  Supabase simulado (REST + Realtime), Edge Function real (Deno) + coturn local.

## Produção (09/10/2026)
- Trava de AMBIENTE removida. Agora a trava é pelo BACKEND: o botão 📞 nasce escondido e só aparece se
  `chamada_config()` (SQL 63) existir e responder `ativo=true`. Sem o SQL → nada aparece e nada escuta.
- Interruptor: `app_flags` 'chamadas_ativas' = false esconde o botão e o banco recusa ligações novas.
- Desfazer: `sql/63-chamadas-desfazer.sql` (volta exatamente ao estado do SQL 62; testado 63 → desfazer → 63).
- Pacote para o painel: /workspace/audit/chamadas (DEPLOY-PROD.md).

## iPhone: eco e alto-falante (09/10/2026, build 20261009l)
Relato: no iPhone (app na tela inicial) a ligação conecta, mas com muito ECO e o som sai no alto-falante (sem modo ouvido / sensor de proximidade).
Causa: na página havia AudioContext TOCANDO durante a ligação — o toque/“destrava” do chamada.js (criado no 1º toque na tela e
nunca fechado) e o “pim” de mensagem do nav.js (MineraSom). No iPhone isso tira a ligação do modo "conversa" (o cancelamento de eco
do sistema só tem como referência o som WebRTC do <audio>) e o Safari usa a saída padrão de "play-and-record", que é o alto-falante.
Correção (chamada.js):
- toques agora são WAV gerado no próprio JS tocado num <audio> (nenhum AudioContext na ligação);
- todo AudioContext da página (nav.js, audio-compat, chat-audio) é SUSPENSO enquanto o microfone da ligação está aberto e volta depois;
- navigator.audioSession.type = 'play-and-record' ao pegar o microfone e 'auto' no fim (Safari 16.4+);
- iPhone com setSinkId (iOS 26+): o <audio> da ligação vai para o RECEPTOR (ouvido → sensor de proximidade); botão Alto-falante alterna;
  iPhone sem setSinkId (iOS < 26): o Safari não deixa escolher → botão Alto-falante escondido (som no alto-falante, limitação do iOS);
- getUserMedia com echoCancellation/noiseSuppression/autoGainControl + mono; 1 só <audio> remoto; microfone nunca tocado localmente.

## iPhone: ouvido × alto-falante (09/10/2026, build 20261009n) — pesquisa
- WebKit põe AVAudioSessionCategoryOptionDefaultToSpeaker em PlayAndRecord desde 2017 (changeset 218148, bug 173276) → iOS ≤ 18: sempre alto-falante, sem API (setSinkId não existe no iOS < 26).
- WebKit commit 19888c4 ("Prepare AVAudioSessionCaptureDeviceManager for speaker selection"): DefaultToSpeaker só sai quando o RECEPTOR é a saída preferida (setPreferredSpeakerID ← setSinkId do <audio> que toca trilha WebRTC, RemoteAudioMediaStreamTrackRendererInternalUnitManager::setLastDeviceUsed). Safari 26: "Speaker Selection API on iOS and iPadOS".
- Bug WebKit 320087 (Zoom, iOS 26.5): setSinkId resolve mas não troca com 1 trilha WebRTC; funciona com 2. Corrigido em 318149@main (29/07/2026) — mixed source "default" sobrescrevia o speaker. Contorno: enviamos 2ª trilha (clone mudo do mic).
- setSinkId precisa de gesto (LiveKit #1635: "funciona sempre" quando chamado no toque) ou microfone recém-ligado (W3C WebRTC WG 16/09/2025, Youenn). Lista de saídas em cache; botão chama setSinkId sem await antes; repete após 400 ms (Safari 26.0: "switching from speaker to receiver does not work the first time").
- audioSession.type: 'play-and-record' DEPOIS do getUserMedia; no fim 'playback'→'auto' (StackOverflow 79401143 / bug 282939). audioSession sozinho NÃO tira o DefaultToSpeaker (código do WebKit).
- <video playsinline> no lugar de <audio>, volume/muted: sem efeito na rota (rota é da sessão; volume é só leitura no iOS).

## 20261009p — Trava de bolso, player da tela de bloqueio, cores, card Pix

**Problemas no teste do Jhon (prod 20261009o, iPhone):**
1. Sensor de proximidade não apaga a tela → nenhum app web (Safari/PWA) tem acesso ao sensor de proximidade; só app nativo (CallKit/AVAudioSession .voiceChat).
2. A orelha toca no indicador de microfone da Dynamic Island → aparece "Gravação de Áudio — Parar gravação?". A Dynamic Island é do sistema: **nenhuma página consegue bloqueá-la nem capturar esse toque**.
3. Tela de bloqueio mostrava um player "Chat Minera" 0:00 (play, ±10 s, AirPlay). Causa: o WebKit põe no "Tocando agora" qualquer `<audio>` com duração > ~0,95 s (os toques WAV tinham 1–6 s em loop) e o "chute" de `audioSession.type='playback'` ao fim da ligação.

**Correções:**
- **Trava de bolso**: com a ligação conectada (aparelho de toque), após 3 s sem toque a tela vira uma camada preta "🔒 Tela travada" com cronômetro; ela engole todos os toques (Silenciar microfone/Desligar/Silenciar som não são acionados sem querer). Destrava só arrastando a alça 🔓 até o fim ou segurando a alça por 1,5 s. Botão "🔒 Travar tela" trava na hora. A parte de cima fica vazia (longe da Dynamic Island). Wake Lock mantém a tela acesa durante a ligação quando suportado.
- **Sem player na tela de bloqueio**: toques ≤ 0,9 s, repetidos por timer (sem loop); `disableRemotePlayback`, `x-webkit-airplay="deny"`, sem controles; `navigator.mediaSession.metadata=null`, handlers nulos, `playbackState='none'`; elemento do toque removido ao fim; `audioSession.type` volta para `'auto'` (sem `'playback'`). Áudio remoto só via `srcObject`.
- **Decisão do dono (09/10/2026): ligação SEMPRE em viva-voz** em todos os aparelhos. Removidos: troca ouvido/alto-falante, `setSinkId`, 2ª trilha muda (bug WebKit 320087) e os avisos "Som no ouvido"/"iOS antigo". Na tela: "🔊 Ligação em viva-voz". Botões: "Silenciar microfone" (↔ "Ativar microfone"), Desligar (vermelho), "Silenciar som" (↔ "Ativar som"; `audio.muted` do som do outro lado, ícone alto-falante × cortado). A trava de bolso agora trava sozinha sempre (3 s sem toque).
- **Cores**: tela de ligação (tocando, chamando, conectada) e trava de bolso usam o amarelo da marca `#F5A623` (`--accent-color`), texto escuro sobre amarelo; Desligar/Recusar continuam vermelhos.
- **Card "Apoie o Minera Pará" (Pix)**: novo botão "Não mostrar novamente" → grava `minera_apoio_nunca_<auth_id>` no aparelho e `user_metadata.minera_apoio_nunca=true` na conta (vale em outro aparelho/reinstalação). "Agora não"/✕ mantêm o comportamento anterior. A lógica está no nav.js, carregado no app principal, Chat Minera e Gestor (o card só aparece nas páginas do app principal).

Testes: `qa2/chamada/chamada.js` (cenário 8 = trava de bolso + tela de bloqueio) e `qa2/apoio/apoio.js` (7/7).

## 20261009r — Trava de bolso REMOVIDA (decisão do dono)
Sai por completo: trava automática após 3 s, botão "Travar tela", camada preta e alça de destravar. Continua: viva-voz sempre, 3 botões (Silenciar microfone / Desligar / Silenciar som), tema amarelo, sem player na tela de bloqueio, card Pix com "Não mostrar novamente". O Wake Lock (tela não apaga sozinha durante a ligação) foi mantido: é inofensivo (só pede para a tela ficar acesa enquanto a ligação está conectada, é solto ao desligar; onde não existe é ignorado) e evita que o iPhone apague a tela e pause o microfone do app web. Testes: qa2/chamada 77/77, qa2/apoio 7/7.

## 20261009t — Redução de ECO (viva-voz no iPhone)
**Pesquisa:** no iPhone o cancelamento de eco é o "voice processing" do iOS que o WebKit liga quando o microfone abre com `echoCancellation:true` (único ajuste de áudio que o Safari realmente respeita — bug WebKit 179411/311451). No alto-falante, com volume alto, ele deixa passar resto de eco; bugs abertos: 311451 (qualidade cai com o mic aberto), 326286 (iOS 27: estalos com eco ligado). WebAudio no caminho do som remoto ou do mic pode tirar o áudio do caminho que o iOS usa como referência do cancelamento → nada de WebAudio.
**Mudanças:**
- getUserMedia: `echoCancellation: {exact:true}` (cai para `ideal` se o aparelho recusar), `noiseSuppression`, `autoGainControl`, `channelCount:1`, `sampleRate:48000`; se `getSettings().echoCancellation` vier false, tenta `applyConstraints`. Teste confere `echoCancellation === true`.
- Som do outro lado só num `<audio>` (srcObject), nenhum AudioContext rodando, toque parado (já testado).
- Opus (fmtp da descrição remota, cópia aplicada; banco intacto): `useinbandfec=1; usedtx=1; stereo=0; sprop-stereo=0; maxaveragebitrate=32000`.
- **Anti-eco meio-duplex (só iPhone/iPad, `CFG.antiEco='ios'`)**: a cada 50 ms lê o nível da voz do outro lado em `RTCRtpReceiver.getSynchronizationSources()[].audioLevel` (sem WebAudio). Se ≥ 0,035 (~ -29 dBov) e eu não estava falando nos últimos 600 ms (meu nível via `getStats` 'media-source' ≥ 0,08), meu mic é desligado (`track.enabled=false`) e volta 300 ms depois que o outro fica abaixo de 0,02. Quem começa a falar fica com a vez. O botão Mudo é independente.
- **Trade-off:** é "meio-duplex" como viva-voz de telefone fixo: enquanto o outro fala alto, a minha voz não passa; ao interromper, as primeiras sílabas podem ser cortadas até ~300 ms depois que o outro para. Pacotes só recentes (400 ms) contam, por causa do DTX.
Testes: qa2/chamada 88/88 (cenário 9 = anti-eco forçado nos 2 lados).

## 20261009v — Anti-eco mais suave, crédito, Termos de Uso
- Anti-eco (iPhone): só abafa com voz do outro claramente alta (≥ 0,08 ≈ -22 dBov) por ≥ 100 ms seguidos; solta 180 ms após cair abaixo de 0,045 (~ -27 dBov); quem fala primeiro mantém a vez (600 ms). Configurável em `CFG` (ecoLigaEm, ecoAtaqueMs, ecoSoltaAbaixo, ecoSegurarMs, ecoMinhaVoz, ecoMinhaVezMs).
- Crédito discreto "Sistema desenvolvido por J&L Empreendimentos · Termos de Uso" no fim do conteúdo de todas as telas (texto único em `credito.js`, carregado pelo `pwa.js`; no site, pelo `index.html`). No chat aparece no fim da lista de Conversas e some com a conversa aberta; nunca na tela de ligação.
- `termos.html` (Termos de Uso + Política de Privacidade, versão 2026-10-09). Cadastro (entrar, Chat Minera, Gestor): caixinha "Li e concordo…" obrigatória; aceite vai para `user_metadata.termos_aceitos_em` + `termos_versao` (sem SQL novo). Recomenda-se revisão por advogado.
