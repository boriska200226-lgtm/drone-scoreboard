// Сборка: core.js встраивается в app.html.
//  dist/kompas-scan.html — фрагмент для публикации в Claude (без <html>/<head>)
//  index.html            — самостоятельная страница: открыть на телефоне/ПК, выложить на любой хостинг
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const dir = new URL('.', import.meta.url).pathname;
const core = readFileSync(dir + 'core.js', 'utf8');
const names = [...core.matchAll(/^export function (\w+)/gm)].map(m => m[1]);
const lib = `window.KCore = (() => {\n${core.replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;
const app = readFileSync(dir + 'app.html', 'utf8').replace('/*CORE*/', () => lib);
mkdirSync(dir + 'dist', { recursive: true });
writeFileSync(dir + 'dist/kompas-scan.html', app);
writeFileSync(dir + 'index.html', `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>\n</head><body>\n${app}\n</body></html>\n`);
console.log('ok:', names.length, 'функций,', (app.length / 1024).toFixed(0), 'КБ');
