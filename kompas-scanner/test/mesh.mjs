// Синтетический «скан»: пластина 100×60×10 R8 с отверстием Ø20 + трубка Ø40/Ø20 до высоты 35.
// Сетка повёрнута, масштаб произвольный, на вершинах шум. Проверяем выравнивание, уступы, сечения, DXF.
import * as M from '../mesh.js';
import * as C from '../core.js';

const N = 360;
const rr = (t) => { // точка на скруглённом прямоугольнике по углу (луч из центра)
  const dx = Math.cos(t), dy = Math.sin(t);
  let lo = 0, hi = 200;
  const inside = (x, y) => { const ax = Math.abs(x) - 42, ay = Math.abs(y) - 22; if (ax <= 0 || ay <= 0) return Math.abs(x) <= 50 && Math.abs(y) <= 30; return ax * ax + ay * ay <= 64; };
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (inside(m * dx, m * dy)) lo = m; else hi = m; }
  return [lo * dx, lo * dy];
};
const circ = (r) => (t) => [r * Math.cos(t), r * Math.sin(t)];
const pos = [], idx = [];
const ring = (f, z) => { const b = pos.length / 3; for (let i = 0; i < N; i++) { const [x, y] = f(i / N * 2 * Math.PI); pos.push(x, y, z); } return b; };
const strip = (a, b, flip) => { for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (flip) idx.push(a + i, b + j, b + i, a + i, a + j, b + j); else idx.push(a + i, b + i, b + j, a + i, b + j, a + j); } };
const zs = [0, 2.5, 5, 7.5, 10];
const outer = zs.map(z => ring(rr, z));
for (let k = 0; k < zs.length - 1; k++) strip(outer[k], outer[k + 1], false);
const tubeZ = [10, 15, 20, 25, 30, 35];
const tubeO = tubeZ.map(z => ring(circ(20), z));
for (let k = 0; k < tubeZ.length - 1; k++) strip(tubeO[k], tubeO[k + 1], false);
const holeZ = [0, 5, 10, 15, 20, 25, 30, 35];
const hole = holeZ.map(z => ring(circ(10), z));
for (let k = 0; k < holeZ.length - 1; k++) strip(hole[k], hole[k + 1], true);
strip(hole[0], outer[0], false);                     // низ
const bottomFace = idx.length / 3 - 1;
strip(tubeO[0], outer[4], true);                     // верх пластины (кольцо)
strip(hole[holeZ.length - 1], tubeO[tubeZ.length - 1], true); // торец трубки

// произвольный поворот, масштаб 0.0123 (как «метры» фотограмметрии), сдвиг, шум 0.05 мм
const a = 0.7, b = -0.4, c = 1.9, s = 0.0123;
const Rx = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const Ry = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
const Rz = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
const mul = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return r; };
const R = mul(Rz, mul(Ry, Rx));
let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const P2 = [];
for (let i = 0; i < pos.length; i += 3) {
  const x = pos[i] + gauss() * 0.05, y = pos[i + 1] + gauss() * 0.05, z = pos[i + 2] + gauss() * 0.05;
  P2.push(s * (R[0] * x + R[1] * y + R[2] * z) + 0.3, s * (R[3] * x + R[4] * y + R[5] * z) - 1.2, s * (R[6] * x + R[7] * y + R[8] * z) + 0.05);
}
// записать как бинарный STL без индексов (как из реального приложения) и прочитать обратно
const raw = { pos: Float64Array.from(P2), idx: Uint32Array.from(idx) };
const stl = M.toSTL(raw);
const m = M.parseMesh(stl.buffer, 'scan.stl');
console.log('вершин', m.pos.length / 3, 'треугольников', m.idx.length / 3);

let ok = true;
const check = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) ok = false; };

M.alignPCA(m); 
const rn = M.regionNormal(m, bottomFace);
M.alignBase(m, rn, bottomFace);
let bb = M.bounds(m);
// калибровка 1 (грубо): габарит по X = 100 мм (по нему же шумные крайние точки)
M.scaleMesh(m, 100 / bb.size[0]);
// калибровка 2 (точно): ширина аппроксимированного сечения пластины = 100 мм (штангенциркуль)
let sec = M.sectionShapes(M.sliceZ(m, 5).loops, { tol: 0.2 });
const sb = C.shapesBBox(sec.filter(x => !x.hole));
console.log('после грубой калибровки сечение', sb.w.toFixed(3), '×', sb.h.toFixed(3));
M.scaleMesh(m, 100 / sb.w);
bb = M.bounds(m);
console.log('габарит модели', bb.size.map(v => v.toFixed(3)).join(' × '));

const lv = M.detectLevels(m);
console.log('уступы:', lv.map(l => l.z.toFixed(2)).join(', '));
check(lv.length === 3 && Math.abs(lv[1].z - 10) < 0.2, 'найдены уступы 0 / 10 / 35');
const plan = M.layerPlan(m, lv);
check(plan.length === 2, 'план: 2 слоя');
console.log('слои:', plan.map(p => (p.z1 - p.z0).toFixed(3)).join(' + '), '=', (plan[plan.length - 1].z1 - plan[0].z0).toFixed(3));
check(Math.abs(plan[0].z1 - plan[0].z0 - 10) < 0.15 && Math.abs(plan[1].z1 - plan[1].z0 - 25) < 0.15, 'толщины слоёв 10 и 25 ±0.15');
for (const L of plan) {
  const r = M.sliceZ(m, L.zc);
  const sh = M.sectionShapes(r.loops, { tol: 0.2 });
  const cnt = {}; sh.forEach(x => x.ents.forEach(e => cnt[e.type] = (cnt[e.type] || 0) + 1));
  const ob = C.shapesBBox(sh.filter(x => !x.hole));
  const circles = sh.flatMap(x => x.ents.filter(e => e.type === 'circle').map(e => (2 * e.r).toFixed(2)));
  const arcs = sh.flatMap(x => x.ents.filter(e => e.type === 'arc').map(e => e.r.toFixed(2)));
  console.log(`слой ${L.z0.toFixed(2)}–${L.z1.toFixed(2)}: ${ob.w.toFixed(2)}×${ob.h.toFixed(2)}`, cnt, 'Ø', circles.join(' '), 'R', arcs.join(' '), r.openCount ? 'обрывов ' + r.openCount : '');
  if (L.zc < 10) {
    check(Math.abs(ob.w - 100) < 0.15 && Math.abs(ob.h - 60) < 0.25, 'пластина 100×60 ±0.25');
    check(cnt.line === 4 && cnt.arc === 4 && circles.length === 1 && Math.abs(circles[0] - 20) < 0.25, '4 отрезка + 4 дуги + Ø20');
  } else {
    check(circles.length === 2 && Math.abs(Math.max(...circles) - 40) < 0.3, 'трубка Ø40/Ø20');
  }
  const dxf = C.toDXF(sh, { origin: 'none', yUp: true });
  if (L.zc < 10) (await import('fs')).writeFileSync(process.argv[2] || '/dev/null', dxf);
}
console.log(ok ? '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : '\nЕСТЬ ОШИБКИ');
process.exit(ok ? 0 : 1);
