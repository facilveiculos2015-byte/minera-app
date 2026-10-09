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
