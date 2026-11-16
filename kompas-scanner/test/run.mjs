// Проверка точности на синтетических «фотографиях» с известной геометрией.
// Запуск: node kompas-scanner/test/run.mjs
import * as C from '../core.js';

const SHEET = { W: 210, H: 297 };

// Деталь: скруглённый прямоугольник 100×60, R8, центр (105,150); отверстие Ø20 в (85,150); паз 20×10 в (125,150)
const OBJ = { cx: 105, cy: 150, w: 100, h: 60, r: 8 };
function inRoundRect(x, y, o) {
  const dx = Math.abs(x - o.cx) - (o.w / 2 - o.r), dy = Math.abs(y - o.cy) - (o.h / 2 - o.r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - o.cx) <= o.w / 2 && Math.abs(y - o.cy) <= o.h / 2;
  return dx * dx + dy * dy <= o.r * o.r;
}
const inHole = (x, y) => (x - 85) ** 2 + (y - 150) ** 2 <= 100 || (Math.abs(x - 125) <= 10 && Math.abs(y - 150) <= 5);

function makeCamera({ C: Cpos, target, f, w, h }) {
  const norm = (v) => { const n = Math.hypot(...v); return v.map(x => x / n); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(target.map((v, i) => v - Cpos[i]));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return { C: Cpos, x, y, z, f, cx: w / 2, cy: h / 2, w, h };
}
function project(cam, P) {
  const d = P.map((v, i) => v - cam.C[i]);
  const px = d[0] * cam.x[0] + d[1] * cam.x[1] + d[2] * cam.x[2];
  const py = d[0] * cam.y[0] + d[1] * cam.y[1] + d[2] * cam.y[2];
  const pz = d[0] * cam.z[0] + d[1] * cam.z[1] + d[2] * cam.z[2];
  return [cam.f * px / pz + cam.cx, cam.f * py / pz + cam.cy];
}

/** Рендер: ось Z листа направлена «в стол», поэтому высота h над листом — это z = -h. */
function render(cam, { height = 0, holes = true, ss = 2, seed = 1 }) {
  const { w, h } = cam;
  const g = new Uint8ClampedArray(w * h);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let v = 0; v < h; v++)
    for (let u = 0; u < w; u++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const uu = u + (sx + 0.5) / ss - 0.5, vv = v + (sy + 0.5) / ss - 0.5;
          const rc = [(uu - cam.cx) / cam.f, (vv - cam.cy) / cam.f, 1];
          const d = [0, 1, 2].map(i => cam.x[i] * rc[0] + cam.y[i] * rc[1] + cam.z[i] * rc[2]);
          const hit = (z0) => { const t = (z0 - cam.C[2]) / d[2]; return [cam.C[0] + t * d[0], cam.C[1] + t * d[1]]; };
          const top = hit(-height), base = hit(0);
          let val;
          const objTop = inRoundRect(top[0], top[1], OBJ);
          if (objTop && !(holes && inHole(top[0], top[1]))) val = 35;
          else if (objTop && holes && !inHole(base[0], base[1])) val = 35; // стенка отверстия
          else if (base[0] >= 0 && base[0] <= SHEET.W && base[1] >= 0 && base[1] <= SHEET.H) val = 225 - 10 * (base[0] / SHEET.W); // лёгкий градиент освещения
          else val = 70;
          acc += val;
        }
      g[v * w + u] = acc / (ss * ss) + (rnd() - 0.5) * 8;
    }
  return g;
}

async function runCase(name, camOpts, { height = 0, holes = true, hCorr = 0, f35 = null }) {
  const cam = makeCamera(camOpts);
  const t0 = Date.now();
  const gray = render(cam, { height, holes });
  const tR = Date.now() - t0;
  const truth = [[0, 0], [SHEET.W, 0], [SHEET.W, SHEET.H], [0, SHEET.H]].map(p => project(cam, [p[0], p[1], 0]));
  const t1 = Date.now();
  const corners = C.detectSheet(gray, cam.w, cam.h);
  if (!corners) { console.log(name, 'ЛИСТ НЕ НАЙДЕН'); return false; }
  const ordTruth = C.orderCorners(truth);
  const cornErr = Math.max(...corners.map((p, i) => Math.hypot(p[0] - ordTruth[i][0], p[1] - ordTruth[i][1])));
  const { W, H } = C.sheetSizeForCorners(corners, 210, 297);
  const Hm = C.homography([[0, 0], [W, 0], [W, H], [0, H]], corners);
  const ppm = 10;
  const rect = C.rectify(gray, cam.w, cam.h, Hm, W, H, ppm);
  const ext = C.extractContours(rect, {});
  if (process.env.DUMP) { const fs = await import('fs'); fs.writeFileSync(process.env.DUMP, rect.data); fs.writeFileSync(process.env.DUMP + '.json', JSON.stringify({ w: rect.w, h: rect.h, ppm })); process.exit(0); }
  const diag = Math.hypot(cam.w, cam.h);
  const fpx = f35 ? f35 * diag / 43.2666 : cam.f;
  const pose = C.cameraPose(Hm, fpx, cam.w / 2, cam.h / 2);
  const G = C.heightCorrection(Hm, pose, hCorr);
  const shapes = C.buildShapes(ext.loops, { G, tol: 0.1 });
  const bb = C.shapesBBox(shapes.filter(s => !s.hole));
  const dims = [bb.w, bb.h].sort((a, b) => b - a);
  const counts = {};
  for (const s of shapes) for (const e of s.ents) counts[e.type] = (counts[e.type] || 0) + 1;
  const circles = shapes.flatMap(s => s.ents.filter(e => e.type === 'circle').map(e => 2 * e.r));
  const arcs = shapes.flatMap(s => s.ents.filter(e => e.type === 'arc').map(e => e.r));
  const errW = dims[0] - 100, errH = dims[1] - 60;
  console.log(`\n== ${name} (рендер ${tR} мс, обработка ${Date.now() - t1} мс)`);
  console.log(`  ошибка углов листа: ${cornErr.toFixed(2)} px, rms кромки ${corners.rms?.toFixed(2)} px`);
  console.log(`  поза: расстояние ${pose.distance.toFixed(0)} мм (истина ${Math.abs(cam.C[2]).toFixed(0)}), наклон ${pose.tilt.toFixed(1)}°`);
  console.log(`  контуров: ${shapes.length} (отв.: ${shapes.filter(s => s.hole).length}), элементы:`, counts);
  console.log(`  габарит ${dims[0].toFixed(3)} × ${dims[1].toFixed(3)} мм (ошибка ${errW.toFixed(3)} / ${errH.toFixed(3)})`);
  if (circles.length) console.log(`  окружности Ø: ${circles.map(d => d.toFixed(3)).join(', ')}`);
  if (arcs.length) console.log(`  радиусы дуг: ${arcs.map(r => r.toFixed(2)).join(', ')}`);
  return { errW, errH, circles, shapes, counts };
}

let ok = true;
const check = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

// 1) Тонкая деталь, камера под наклоном ~20°, 12 Мп
{
  const r = await runCase('плоская деталь, наклон', { C: [60, 110, -420], target: [105, 150, 0], f: 3000, w: 3024, h: 4032 }, {});
  check(Math.abs(r.errW) < 0.25 && Math.abs(r.errH) < 0.25, 'габарит точнее ±0.25 мм');
  check(r.circles.length === 1 && Math.abs(r.circles[0] - 20) < 0.2, 'отверстие Ø20 распознано окружностью ±0.2 мм');
  check(r.shapes.length === 3, '3 контура: внешний, отверстие, паз');
  const outer = r.shapes.find(s => !s.hole);
  const arcs = outer.ents.filter(e => e.type === 'arc');
  check(arcs.length === 4 && arcs.every(a => Math.abs(a.r - 8) < 0.3), '4 скругления R8 ±0.3');
  check(outer.ents.length === 8, 'внешний контур = 4 отрезка + 4 дуги');
  // DXF
  const dxf = C.toDXF(r.shapes);
  check(dxf.includes('AC1009') && dxf.trim().endsWith('EOF'), 'DXF сформирован');
}

// 2) Толстая деталь 15 мм, съёмка сверху над деталью, с коррекцией высоты
{
  const cam = { C: [110, 145, -450], target: [105, 152, 0], f: 3000, w: 3024, h: 4032 };
  const r0 = await runCase('толщина 15 мм БЕЗ коррекции', cam, { height: 15, holes: false });
  const r1 = await runCase('толщина 15 мм С коррекцией', cam, { height: 15, holes: false, hCorr: 15 });
  const r2 = await runCase('толщина 15 мм С коррекцией, фокус по EXIF 26мм', cam, { height: 15, holes: false, hCorr: 15, f35: 26 });
  check(r0.errW > 2, 'без коррекции габарит завышен (параллакс)');
  check(Math.abs(r1.errW) < 0.3 && Math.abs(r1.errH) < 0.3, 'с коррекцией ±0.3 мм');
  check(Math.abs(r2.errW) < 0.6, 'с приблизительным фокусом ±0.6 мм');
}

console.log(ok ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nЕСТЬ ОШИБКИ');
process.exit(ok ? 0 : 1);
