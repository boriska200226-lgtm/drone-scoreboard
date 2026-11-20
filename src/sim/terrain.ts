// Реальная местность Республики Коми: высоты и типы поверхности (ESA WorldCover) для каждой миссии.
// Данные готовит tools/terrain/fetch_komi.py → public/sim/terrain/<id>.bin.gz.
// Мир берёт окно со сдвигом (у каждого вылета свой), поэтому местность настоящая, но не повторяется.

/** Классы поверхности (как в файле). */
export const LC = { none: 0, forest: 1, shrub: 2, grass: 3, crop: 4, built: 5, bare: 6, snow: 7, water: 8, bog: 9, mangrove: 10, moss: 11 } as const;

export interface RealTerrain {
  /** Сторона квадрата данных, м; G×G узлов. */
  side: number; G: number;
  /** Высоты над нижним уровнем района, м. */
  h: Float32Array;
  cls: Uint8Array;
}

/** Миссии, для которых есть реальная местность. */
export const REAL_TERRAIN = new Set([
  "training", "fire", "search", "agro", "delivery", "powerline", "oil", "reindeer", "heat", "icejam",
  "logging", "gas", "floe", "aed", "post", "mapping", "ticks", "bear", "patrol", "sling",
]);

const cache = new Map<string, RealTerrain>();
export const getTerrain = (id: string) => cache.get(id) ?? null;

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf);
  // сервер мог уже распаковать (Content-Encoding: gzip) — тогда сразу «KOMI»
  if (!(b[0] === 0x1f && b[1] === 0x8b)) return buf;
  const ds = new DecompressionStream("gzip");
  return new Response(new Blob([b]).stream().pipeThrough(ds)).arrayBuffer();
}

export async function loadTerrain(id: string | undefined): Promise<RealTerrain | null> {
  if (!id) return null;
  if (cache.has(id)) return cache.get(id)!;
  try {
    const base = `${import.meta.env.BASE_URL}sim/terrain/${id}.bin.gz`;
    let raw: ArrayBuffer;
    if (import.meta.env.VITE_PACKED_ASSETS) {
      // хостинг страницы отдаёт только текст — в автономной сборке данные лежат в base64
      const b64 = (await (await fetch(`${base}.txt`)).text()).trim();
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      raw = bytes.buffer;
    } else raw = await (await fetch(base)).arrayBuffer();
    const buf = await gunzip(raw);
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "KOMI") return null;
    const G = dv.getUint16(4, true), side = dv.getFloat32(6, true), step = dv.getFloat32(10, true);
    const q = new Uint16Array(buf.slice(14, 14 + G * G * 2));
    const h = new Float32Array(G * G);
    for (let i = 0; i < h.length; i++) h[i] = q[i] * step;
    const cls = new Uint8Array(buf.slice(14 + G * G * 2, 14 + G * G * 3));
    const t: RealTerrain = { side, G, h, cls };
    cache.set(id, t);
    return t;
  } catch {
    return null; // без данных мир строится процедурно, как раньше
  }
}

/** Выборка из реальной местности в координатах мира (окно сдвинуто на off). */
export class TerrainSampler {
  constructor(private t: RealTerrain, private offX: number, private offZ: number) {}
  private uv(x: number, z: number): [number, number] {
    const { side, G } = this.t;
    const u = ((x + this.offX) / side + 0.5) * (G - 1), v = ((z + this.offZ) / side + 0.5) * (G - 1);
    return [Math.min(G - 1.001, Math.max(0, u)), Math.min(G - 1.001, Math.max(0, v))];
  }
  height(x: number, z: number): number {
    const { G, h } = this.t;
    const [u, v] = this.uv(x, z), i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * G + i;
    return (h[k] * (1 - fu) + h[k + 1] * fu) * (1 - fv) + (h[k + G] * (1 - fu) + h[k + G + 1] * fu) * fv;
  }
  cls(x: number, z: number): number {
    const [u, v] = this.uv(x, z);
    return this.t.cls[Math.round(v) * this.t.G + Math.round(u)];
  }
  /** Доля воды в окрестности r метров (для берегов). */
  water(x: number, z: number, r: number): number {
    let s = 0;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (this.cls(x + dx, z + dz) === LC.water) s++;
    return s / 5;
  }
}
