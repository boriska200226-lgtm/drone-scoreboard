// Сборка: core.js + mesh.js встраиваются в страницы.
//  app.html   → index.html (самостоятельная) и dist/kompas-scan.html (для публикации в Claude)
//  app3d.html → index3d.html и dist/kompas-3d.html
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const dir = new URL('.', import.meta.url).pathname;
const src = ['core.js', 'mesh.js'].map(f => readFileSync(dir + f, 'utf8')).join('\n');
const names = [...src.matchAll(/^export function (\w+)/gm)].map(m => m[1]);
const lib = `window.KCore = (() => {\n${src.replace(/^import .*$/gm, '').replace(/^export /gm, '')}\nreturn { ${names.join(', ')} };\n})();`;
const app1 = readFileSync(dir + 'app.html', 'utf8');
const style = app1.match(/<style>\n([\s\S]*?)<\/style>/)[1];
mkdirSync(dir + 'dist', { recursive: true });
const page = (frag) => `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}</style>\n</head><body>\n${frag}\n</body></html>\n`;
for (const [srcFile, out, standalone] of [['app.html', 'kompas-scan', 'index.html'], ['app3d.html', 'kompas-3d', 'index3d.html']]) {
  const html = readFileSync(dir + srcFile, 'utf8').replace('/*STYLE*/', () => style).replace('/*CORE*/', () => lib);
  writeFileSync(dir + `dist/${out}.html`, html);
  writeFileSync(dir + standalone, page(html));
  console.log(out, (html.length / 1024).toFixed(0), 'КБ');
}
console.log('функций в ядре:', names.length);
