// Трава у камеры: тысячи пучков стеблей в «бесконечном» тайле, который следует за наблюдателем.
// Высота берётся из карты высот в текстуре, густота — из маски. Стебли качаются на ветру
// и ложатся от потока винтов, когда аппарат висит низко.
import * as THREE from "three";
import { mulberry32 } from "./noise";

export interface GrassOpts {
  size: number; // размер тайла, м
  count: number; // пучков
  heights: Float32Array; n: number; worldSize: number;
  density: Float32Array; // 0..1 на узел сетки рельефа
  tint: THREE.Color;
  time: { value: number };
}

export class GrassField {
  mesh: THREE.Mesh;
  uniforms: {
    uCam: { value: THREE.Vector2 }; uWind: { value: THREE.Vector2 }; uDrone: { value: THREE.Vector3 }; uWash: { value: number };
  };
  private disposables: { dispose(): void }[] = [];

  constructor(o: GrassOpts) {
    // пучок из 4 изогнутых стеблей по 3 сегмента
    const blades = 7, segs = 3;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const rnd = mulberry32(42);
    for (let b = 0; b < blades; b++) {
      const ang = (b / blades) * Math.PI + rnd() * 0.6;
      const ox = (rnd() - 0.5) * 0.3, oz = (rnd() - 0.5) * 0.3;
      const lean = 0.06 + rnd() * 0.14, h = 0.22 + rnd() * 0.28, w = 0.011 + rnd() * 0.008;
      const base = pos.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs, ww = w * (1 - t * 0.85);
        const cx = ox + Math.cos(ang + 1.57) * lean * t * t, cz = oz + Math.sin(ang + 1.57) * lean * t * t;
        for (const side of [-1, 1]) {
          pos.push(cx + Math.cos(ang) * ww * side, t * h, cz + Math.sin(ang) * ww * side);
          uv.push(side * 0.5 + 0.5, t);
        }
      }
      for (let s = 0; s < segs; s++) {
        const a = base + s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const blade = new THREE.InstancedBufferGeometry();
    blade.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    blade.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    blade.setIndex(idx);
    blade.computeVertexNormals();
    const off = new Float32Array(o.count * 2), rr = new Float32Array(o.count * 3);
    for (let i = 0; i < o.count; i++) {
      off[i * 2] = rnd() * o.size; off[i * 2 + 1] = rnd() * o.size;
      rr[i * 3] = rnd() * 6.283; rr[i * 3 + 1] = 0.6 + rnd() * 0.8; rr[i * 3 + 2] = rnd();
    }
    blade.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 2));
    blade.setAttribute("aRand", new THREE.InstancedBufferAttribute(rr, 3));
    blade.instanceCount = o.count;
    this.disposables.push(blade);

    const mk = (data: Float32Array) => {
      const h16 = new Uint16Array(data.length);
      for (let i = 0; i < data.length; i++) h16[i] = THREE.DataUtils.toHalfFloat(data[i]);
      const t = new THREE.DataTexture(h16, o.n, o.n, THREE.RedFormat, THREE.HalfFloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      this.disposables.push(t);
      return t;
    };
    const tHeight = mk(o.heights), tDens = mk(o.density);

    this.uniforms = {
      uCam: { value: new THREE.Vector2() }, uWind: { value: new THREE.Vector2(1, 0) },
      uDrone: { value: new THREE.Vector3(0, -100, 0) }, uWash: { value: 0 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, color: o.tint });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms, {
        uTime: o.time, tHeight: { value: tHeight }, tDens: { value: tDens },
        uTile: { value: o.size }, uWorld: { value: o.worldSize },
      });
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", /* glsl */ `#include <common>
          attribute vec2 aOff; attribute vec3 aRand;
          uniform vec2 uCam, uWind; uniform vec3 uDrone; uniform float uWash, uTime, uTile, uWorld;
          uniform sampler2D tHeight, tDens;
          varying float vT; varying float vShade;`)
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0., 1., 0.);")
        .replace("#include <begin_vertex>", /* glsl */ `
          vec2 p = aOff - uCam;
          p -= uTile * floor(p / uTile + .5);
          vec2 wp = uCam + p;
          vec2 tuv = (wp + uWorld * .5) / uWorld;
          float gh = texture2D(tHeight, tuv).r;
          float dens = texture2D(tDens, tuv).r;
          float dist = length(p);
          float scale = aRand.y * step(aRand.z, dens) * smoothstep(uTile * .5, uTile * .3, dist);
          float c = cos(aRand.x), s = sin(aRand.x);
          vec3 lp = vec3(c * position.x - s * position.z, position.y, s * position.x + c * position.z) * scale;
          float t = uv.y; vT = t; vShade = .75 + .5 * fract(aRand.z * 13.7);
          // ветер: волны по полю + мелкая дрожь
          float gust = sin(dot(wp, uWind) * .08 - uTime * 1.6) * .5 + .5;
          vec2 bend = uWind * (.25 + .5 * gust) * .35 + vec2(sin(uTime * 3.1 + aRand.x * 9.), cos(uTime * 2.7 + aRand.z * 9.)) * .05;
          // поток от винтов: стебли ложатся от центра
          vec2 dv = wp - uDrone.xz;
          float dd = length(dv);
          float wash = uWash * smoothstep(7., 0., dd) * smoothstep(12., 0., uDrone.y - gh);
          bend += (dd > .01 ? dv / dd : vec2(0.)) * wash * (1.2 + .4 * sin(uTime * 14. + dd * 3.));
          lp.xz += bend * t * t * scale * .45;
          lp.y *= 1. - min(.6, length(bend) * .35) * t;
          vec3 transformed = vec3(wp.x + lp.x, gh + lp.y - .03, wp.y + lp.z);`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vT; varying float vShade;")
        // у стебля нет «изнанки»: обе стороны освещаются одинаково
        .replace("#include <normal_fragment_begin>", "float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;")
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb *= mix(vec3(.32, .36, .22), vec3(1.05, 1.08, .8), vT) * vShade;`);
    };
    this.disposables.push(mat);
    this.mesh = new THREE.Mesh(blade, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  update(cam: THREE.Vector3, wind: THREE.Vector3, drone: THREE.Vector3, wash: number) {
    this.uniforms.uCam.value.set(cam.x, cam.z);
    const wl = Math.hypot(wind.x, wind.z);
    this.uniforms.uWind.value.set(wind.x, wind.z).multiplyScalar(wl > 0.01 ? Math.min(1.6, wl / 5) / wl : 0);
    this.uniforms.uDrone.value.copy(drone);
    this.uniforms.uWash.value = wash;
  }

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
