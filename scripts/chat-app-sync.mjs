#!/usr/bin/env node
/**
 * Chat Minera (app só-chat instalável em /chat/) — gera chat/index.html e chat/entrar.html
 * a partir de chat.html e entrar.html, para não duplicar nada à mão: o JS e o CSS são os mesmos
 * do app (via <base href="../">); só muda o "modo só-chat" (window.MINERA_CHAT_APP), o manifest,
 * os ícones e o título.
 * Uso: node scripts/chat-app-sync.mjs   (rodar de novo sempre que mudar chat.html ou entrar.html)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AVISO = '<!-- GERADO por scripts/chat-app-sync.mjs a partir de {SRC} (Chat Minera, modo só-chat). Não editar à mão. -->';

function trocar(html, de, para, nome) {
  if (typeof de === 'string' ? !html.includes(de) : !de.test(html)) {
    console.error('FALHA: não achei "' + nome + '"');
    process.exit(2);
  }
  return html.replace(de, para);
}

function modoChat(html, src, titulo) {
  html = trocar(html, /<!DOCTYPE html>\n/i, '<!DOCTYPE html>\n' + AVISO.replace('{SRC}', src) + '\n', 'doctype');
  html = trocar(html, /<title>[^<]*<\/title>/,
    '<base href="../">\n    <script>window.MINERA_CHAT_APP = true;</script>\n    <title>' + titulo + '</title>', 'title');
  html = trocar(html, /<link rel="icon" type="image\/png" href="icon-192\.png(\?v=[0-9a-z]+)">/,
    '<link rel="icon" type="image/png" href="chat/icon-192.png$1">', 'icon');
  html = trocar(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png(\?v=[0-9a-z]+)">/,
    '<link rel="apple-touch-icon" href="chat/apple-touch-icon.png$1">', 'apple-touch-icon');
  html = trocar(html, '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="manifest" href="chat/manifest.webmanifest">', 'manifest');
  html = trocar(html, /<meta name="apple-mobile-web-app-title" content="[^"]*">/,
    '<meta name="apple-mobile-web-app-title" content="Chat Minera">', 'apple title');
  html = trocar(html, /<body( class="([^"]*)")?>/, (m, a, cls) => '<body class="' + (cls ? cls + ' ' : '') + 'chat-app">', 'body');
  return html;
}

// chat.html → chat/index.html
let chat = fs.readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
chat = modoChat(chat, 'chat.html', 'Chat Minera');
// "Pedir senha ao abrir" ligado (chat-trava.js): esconde o conteúdo desde o 1º quadro, até a tela de senha aparecer
chat = trocar(chat, '<script>window.MINERA_CHAT_APP = true;</script>',
  '<script>window.MINERA_CHAT_APP = true;</script>\n    <script>(function(){try{var mm=window.matchMedia;if(!((mm&&(mm(\'(display-mode: standalone)\').matches||mm(\'(display-mode: fullscreen)\').matches))||navigator.standalone===true))return;var u=localStorage.getItem(\'minera_chat_last_uid\');if(u&&localStorage.getItem(\'minera_chat_trava_\'+u)===\'1\'&&sessionStorage.getItem(\'minera_chat_unlock_sess_\'+u)!==\'1\'){document.documentElement.classList.add(\'ct-cedo\');setTimeout(function(){document.documentElement.classList.remove(\'ct-cedo\');},10000);}}catch(e){}})();</script>', 'trava cedo');
chat = trocar(chat, '<h1 class="wa-title">Conversas</h1>',
  '<h1 class="wa-title">Conversas</h1>\n                <a class="chat-app-full" href="inicio.html" target="_blank" rel="noopener">Abrir Minera Pará completo ↗</a>', 'wa-title');
fs.writeFileSync(path.join(ROOT, 'chat', 'index.html'), chat);

// entrar.html → chat/entrar.html (login normal; depois de entrar, irPara volta para o /chat/)
let entrar = fs.readFileSync(path.join(ROOT, 'entrar.html'), 'utf8');
entrar = modoChat(entrar, 'entrar.html', 'Chat Minera - Entrar');
entrar = trocar(entrar, '<p>Crie sua conta ou entre para gerenciar lotes</p>',
  '<p>Chat Minera: entre com a sua conta do Minera Pará</p>\n                <p class="chat-login-dica">No iPhone, entre uma vez aqui dentro do Chat Minera. Depois ele abre direto, sem pedir senha.</p>', 'subtitulo');
fs.writeFileSync(path.join(ROOT, 'chat', 'entrar.html'), entrar);

console.log('ok: chat/index.html e chat/entrar.html gerados');
