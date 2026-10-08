#!/usr/bin/env node
/**
 * Gestor Minera (app só-gestor instalável em /gestor/) — gera gestor/index.html, gestor/entrar.html e
 * gestor/instalar.html a partir de gestor.html, entrar.html e chat/instalar.html, para não duplicar nada à mão:
 * o JS e o CSS são os mesmos do app (via <base href="../">); só muda o "modo só-gestor"
 * (window.MINERA_GESTOR_APP: sem barra de baixo, login e volta dentro do /gestor/, sem push), o manifest,
 * os ícones e o título.
 * Uso: node scripts/gestor-app-sync.mjs   (rodar de novo sempre que mudar gestor.html, entrar.html ou chat/instalar.html)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AVISO = '<!-- GERADO por scripts/gestor-app-sync.mjs a partir de {SRC} (Gestor Minera, modo só-gestor). Não editar à mão. -->';

function trocar(html, de, para, nome) {
  if (typeof de === 'string' ? !html.includes(de) : !de.test(html)) {
    console.error('FALHA: não achei "' + nome + '"');
    process.exit(2);
  }
  return typeof de === 'string' ? html.split(de).join(para) : html.replace(de, para);
}

function modoGestor(html, src, titulo) {
  html = trocar(html, /<!DOCTYPE html>\n/i, '<!DOCTYPE html>\n' + AVISO.replace('{SRC}', src) + '\n', 'doctype');
  html = trocar(html, /<title>[^<]*<\/title>/,
    '<base href="../">\n    <script>window.MINERA_GESTOR_APP = true;</script>\n    <title>' + titulo + '</title>', 'title');
  html = trocar(html, /<link rel="icon" type="image\/png" href="icon-192\.png(\?v=[0-9a-z]+)">/,
    '<link rel="icon" type="image/png" href="gestor/icon-192.png$1">', 'icon');
  html = trocar(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png(\?v=[0-9a-z]+)">/,
    '<link rel="apple-touch-icon" href="gestor/apple-touch-icon.png$1">', 'apple-touch-icon');
  html = trocar(html, '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="manifest" href="gestor/manifest.webmanifest">', 'manifest');
  html = trocar(html, /<meta name="apple-mobile-web-app-title" content="[^"]*">/,
    '<meta name="apple-mobile-web-app-title" content="Gestor Minera">', 'apple title');
  html = trocar(html, /<body( class="([^"]*)")?>/, (m, a, cls) => '<body class="' + (cls ? cls + ' ' : '') + 'gestor-app">', 'body');
  return html;
}

// gestor.html → gestor/index.html
let gestor = fs.readFileSync(path.join(ROOT, 'gestor.html'), 'utf8');
gestor = modoGestor(gestor, 'gestor.html', 'Gestor Minera');
gestor = trocar(gestor, '<a class="gf-voltar" id="gf-voltar" href="perfil.html" aria-label="Voltar ao Perfil">← Perfil</a>',
  '<a class="gestor-app-full" href="inicio.html" target="_blank" rel="noopener">Abrir Minera Pará completo ↗</a>', 'gf-voltar');
fs.writeFileSync(path.join(ROOT, 'gestor', 'index.html'), gestor);

// entrar.html → gestor/entrar.html (login normal; depois de entrar, irPara volta para o /gestor/)
let entrar = fs.readFileSync(path.join(ROOT, 'entrar.html'), 'utf8');
entrar = modoGestor(entrar, 'entrar.html', 'Gestor Minera - Entrar');
entrar = trocar(entrar, '<p>Crie sua conta ou entre para gerenciar lotes</p>',
  '<p>Gestor Minera: entre com a sua conta do Minera Pará</p>\n                <p class="chat-login-dica">No iPhone, entre uma vez aqui dentro do Gestor Minera. Depois ele abre direto.</p>', 'subtitulo');
fs.writeFileSync(path.join(ROOT, 'gestor', 'entrar.html'), entrar);

// chat/instalar.html → gestor/instalar.html (mesmo instalador, textos e ícones do Gestor)
let inst = fs.readFileSync(path.join(ROOT, 'chat', 'instalar.html'), 'utf8');
inst = trocar(inst, /<!DOCTYPE html>\n/i, '<!DOCTYPE html>\n' + AVISO.replace('{SRC}', 'chat/instalar.html') + '\n', 'doctype');
inst = trocar(inst, '<script>window.MINERA_CHAT_APP = true; window.MINERA_INSTALADOR = true;</script>',
  '<script>window.MINERA_GESTOR_APP = true; window.MINERA_INSTALADOR = true;</script>', 'flag');
inst = trocar(inst, '<title>Chat Minera na tela inicial</title>', '<title>Gestor Minera na tela inicial</title>', 'title');
inst = trocar(inst, 'href="chat/icon-192.png', 'href="gestor/icon-192.png', 'icon');
inst = trocar(inst, 'src="chat/icon-192.png', 'src="gestor/icon-192.png', 'img');
inst = trocar(inst, 'href="chat/apple-touch-icon.png', 'href="gestor/apple-touch-icon.png', 'apple-touch-icon');
inst = trocar(inst, '<link rel="manifest" href="chat/manifest.webmanifest">', '<link rel="manifest" href="gestor/manifest.webmanifest">', 'manifest');
inst = trocar(inst, '<meta name="apple-mobile-web-app-title" content="Chat Minera">', '<meta name="apple-mobile-web-app-title" content="Gestor Minera">', 'apple title');
inst = trocar(inst, '<body class="chat-app chat-instalar">', '<body class="gestor-app chat-instalar">', 'body');
inst = trocar(inst, 'alt="Ícone do Chat Minera"', 'alt="Ícone do Gestor Minera"', 'alt');
inst = trocar(inst, '<h1>Chat na tela inicial</h1>', '<h1>Gestor na tela inicial</h1>', 'h1');
inst = trocar(inst, /<p class="ci-sub">[\s\S]*?<\/p>/,
  '<p class="ci-sub">Coloque o <strong>Gestor Minera</strong> na tela inicial do celular e abra o seu Gestor Financeiro num toque, sem abrir o site. É o mesmo gestor do Minera Pará: mesma conta, mesmos lançamentos.</p>', 'sub');
inst = trocar(inst, '✓ O Chat Minera já está na tela inicial deste aparelho.', '✓ O Gestor Minera já está na tela inicial deste aparelho.', 'pronto');
inst = trocar(inst, 'No iPhone, entre na sua conta uma vez dentro do Chat Minera.', 'No iPhone, entre na sua conta uma vez dentro do Gestor Minera.', 'dica ios');
inst = trocar(inst, 'Para colocar o <strong>Chat Minera</strong> na tela inicial', 'Para colocar o <strong>Gestor Minera</strong> na tela inicial', 'fora');
inst = trocar(inst, '<a class="ci-abrir" id="ci-abrir" href="chat/">Abrir chat</a>', '<a class="ci-abrir" id="ci-abrir" href="gestor/">Abrir gestor</a>', 'abrir');
inst = trocar(inst, "var APP = { id: 'chat', nome: 'Chat Minera', dir: 'chat/' };", "var APP = { id: 'gestor', nome: 'Gestor Minera', dir: 'gestor/' };", 'APP');
inst = trocar(inst, '<a class="ci-voltar" href="inicio.html" id="ci-voltar">', '<a class="ci-voltar" href="gestor.html" id="ci-voltar">', 'voltar');
if (/Chat Minera|"chat\//.test(inst.replace(/\/\/[^\n]*/g, ''))) { console.error('FALHA: sobrou "Chat" no instalador do gestor'); process.exit(3); }
fs.writeFileSync(path.join(ROOT, 'gestor', 'instalar.html'), inst);

console.log('ok: gestor/index.html, gestor/entrar.html e gestor/instalar.html gerados');
