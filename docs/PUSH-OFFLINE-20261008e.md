# Push com o aparelho offline / travado (conferido no build 20261008e)

Nada precisou mudar — já estava adequado:

- **Edge Function `send-push`** (`supabase/functions/send-push/index.ts`, v2 publicada em 08/10/2026):
  `webpush.sendNotification(..., { TTL: 86400, urgency: "high", topic })`
  - `TTL: 86400` = o serviço de push (FCM no Android/Chrome, APNs no iPhone, Mozilla no Firefox) guarda a
    mensagem por **24 h** se o aparelho estiver sem internet/desligado e entrega quando ele voltar online.
  - `urgency: "high"` = entrega imediata mesmo com o celular travado / em economia de bateria (Doze no Android;
    no APNs vira prioridade 10).
  - `topic` = `dm-<remetente>` / `g-<grupo>` (até 32 caracteres): se chegarem várias mensagens da mesma conversa
    com o aparelho offline, o serviço guarda só a mais nova (sem enxurrada de avisos) — igual à `tag` da notificação.
- **Service workers** (`sw.js` e `chat/sw.js`): o evento `push` chama `showNotification` sempre que o serviço entrega
  (inclusive quando o aparelho volta online), com `tag` + `renotify: true` + som/vibração. Só não mostra quando uma
  janela do Minera está visível e com foco (o próprio app avisa); no iPhone/Safari mostra sempre (regra do iOS).
  Não há TTL/expiração no SW.
- Limite conhecido: se o aparelho ficar **mais de 24 h** sem internet, aquela notificação expira no serviço de push
  (a mensagem continua no chat). Aumentar o TTL exigiria redeploy da função — não foi feito.
