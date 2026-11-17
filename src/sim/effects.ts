// Система частиц: клубящиеся текстурированные спрайты с поворотом, туманом и цветовой рампой пламени.
import * as THREE from "three";
import { mulberry32 } from "./noise";
import { THERMAL_LAYER } from "./world";

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aRot;
uniform float uScale, uTime;
varying vec4 vColor;
varying float vRot;
varying float vDist;
void main() {
  vColor = aColor;
  vRot = aRot + uTime * (fract(aRot * 7.31) - .5) * .6;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint, uFogColor;
uniform float uFogDensity;
varying vec4 vColor;
varying float vRot;
varying float vDist;
void main() {
  vec2 p = gl_PointCoord - .5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + .5;
  float a = texture2D(uMap, p).a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = vColor.rgb * uTint;
  float f = 1. - exp(-uFogDensity * uFogDensity * vDist * vDist);
  #ifdef ADDITIVE
    gl_FragColor = vec4(col * a * (1. - f), 1.);
  #else
    gl_FragColor = vec4(mix(col, uFogColor, f), a);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let puffTex: THREE.CanvasTexture | null = null;
/** Клуб: радиальный градиент, изъеденный случайными пятнами. */
function puff(): THREE.CanvasTexture {
  if (puffTex) return puffTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const rnd = mulberry32(77);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.28, d = rnd() * 30, r = 16 + rnd() * 26;
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,0.33)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c);
  return puffTex;
}

export interface ParticleOpts {
  max: number;
  additive?: boolean;
  gravity?: number;
  drag?: number; // насколько частица увлекается ветром, 1/с
  grow?: number; // рост размера, м/с
  thermal?: boolean; // видна ли в тепловизоре
  fireRamp?: boolean; // цвет по времени жизни: белый → жёлтый → оранжевый → тёмно-красный
  tint?: THREE.Color; // освещённость (для дыма и воды)
  fog?: THREE.FogExp2;
  ground?: (x: number, z: number) => number;
  onHit?: (x: number, z: number, data: number) => void;
}

export class Particles {
  points: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private size: Float32Array;
  private life: Float32Array; private maxLife: Float32Array; private alpha: Float32Array; private data: Float32Array;
  private head = 0;
  private mat: THREE.ShaderMaterial;
  private opts: ParticleOpts;

  constructor(scene: THREE.Scene, opts: ParticleOpts) {
    this.opts = opts;
    const n = opts.max;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.alpha = new Float32Array(n); this.data = new Float32Array(n);
    const rot = new Float32Array(n);
    const rnd = mulberry32(n);
    for (let i = 0; i < n; i++) rot[i] = rnd() * 6.283;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aRot", new THREE.BufferAttribute(rot, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      defines: opts.additive ? { ADDITIVE: 1 } : {},
      uniforms: {
        uScale: { value: 600 }, uTime: { value: 0 }, uMap: { value: puff() },
        uTint: { value: opts.tint ?? new THREE.Color(1, 1, 1) },
        uFogColor: { value: opts.fog?.color ?? new THREE.Color(0, 0, 0) }, uFogDensity: { value: opts.fog?.density ?? 0 },
      },
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 3 : 2;
    if (opts.thermal) this.points.layers.enable(THERMAL_LAYER);
    scene.add(this.points);
  }

  setScale(s: number) { this.mat.uniforms.uScale.value = s; }

  /** Освещённость системы: чтобы получить «белый» в кадре, цвет частицы делят на неё. */
  get tint(): THREE.Color { return this.mat.uniforms.uTint.value; }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number,
        life: number, size: number, r: number, g: number, b: number, a: number, data = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.opts.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.alpha[i] = a; this.data[i] = data;
  }

  update(dt: number, wind: THREE.Vector3) {
    const { gravity = 0, drag = 0, grow = 0, ground, onHit, fireRamp } = this.opts;
    const k = Math.min(1, drag * dt);
    this.mat.uniforms.uTime.value += dt;
    for (let i = 0; i < this.opts.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3, c = i * 4;
      if (this.life[i] <= 0) { this.col[c + 3] = 0; this.size[i] = 0; continue; }
      this.vel[j] += (wind.x - this.vel[j]) * k;
      this.vel[j + 2] += (wind.z - this.vel[j + 2]) * k;
      this.vel[j + 1] -= gravity * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += grow * dt;
      const t = this.life[i] / this.maxLife[i];
      if (fireRamp) {
        // t: 1 — только что родилась, 0 — гаснет
        const hot = Math.max(0, t - 0.55) / 0.45, mid = Math.min(1, t / 0.55);
        this.col[c] = 0.5 + 2.6 * mid + 1.6 * hot;
        this.col[c + 1] = 0.05 + 0.75 * mid * mid + 1.9 * hot;
        this.col[c + 2] = 0.02 + 0.06 * mid + 1.1 * hot * hot;
        this.col[c + 3] = this.alpha[i] * Math.min(1, t * 3) * Math.min(1, (1 - t) * 8);
      } else this.col[c + 3] = this.alpha[i] * Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 6 + 0.15);
      if (ground && this.pos[j + 1] <= ground(this.pos[j], this.pos[j + 2])) {
        if (onHit) onHit(this.pos[j], this.pos[j + 2], this.data[i]);
        this.life[i] = 0; this.col[c + 3] = 0; this.size[i] = 0;
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// ─────────────────────────── языки пламени ───────────────────────────

const FLAME_VERT = /* glsl */ `
attribute float aSeed;
attribute float aHeat;
uniform vec3 uCam;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
void main() {
  vUv = uv; vSeed = aSeed; vHeat = aHeat;
  vec3 c = instanceMatrix[3].xyz;
  float w = length(instanceMatrix[0].xyz), h = length(instanceMatrix[1].xyz);
  // цилиндрический билборд: плоскость всегда развёрнута к камере, но стоит вертикально
  vec3 toCam = uCam - c; toCam.y = 0.;
  vec3 right = normalize(cross(vec3(0., 1., 0.), normalize(toCam + vec3(1e-4, 0., 0.))));
  vec3 p = c + right * position.x * w + vec3(0., 1., 0.) * position.y * h;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vHeat;
float hsh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hsh(i), hsh(i+vec2(1.,0.)), f.x), mix(hsh(i+vec2(0.,1.)), hsh(i+vec2(1.,1.)), f.x), f.y); }
float fb(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.07 + 11.3; a *= .5; } return s; }
void main() {
  vec2 uv = vUv;
  float t = uTime * (1.6 + vSeed * .6);
  // турбулентность поднимается вверх, у основания пламя плотнее
  float n = fb(vec2(uv.x * 3. + vSeed * 17., uv.y * 2.4 - t));
  float n2 = fb(vec2(uv.x * 6. - vSeed * 9., uv.y * 5. - t * 1.7));
  float x = (uv.x - .5) * 2. + (n - .5) * .7 * uv.y;
  float body = 1. - abs(x) * (.85 + uv.y * 1.9);
  float f = body - uv.y * .95 + (n * .6 + n2 * .4 - .5) * 1.1 + .25;
  f *= smoothstep(0., .08, uv.y) * smoothstep(1., .55, uv.y);
  f = clamp(f, 0., 1.);
  if (f < .02) discard;
  // цвет по температуре: тёмно-красный край → оранжевый → жёлтый → почти белое ядро
  vec3 col = vec3(.55, .07, .01);
  col = mix(col, vec3(1., .38, .04), smoothstep(.05, .3, f));
  col = mix(col, vec3(1., .72, .2), smoothstep(.3, .6, f));
  col = mix(col, vec3(1., .9, .62), smoothstep(.78, 1., f));
  float k = f * (.6 + .4 * vHeat);
  gl_FragColor = vec4(col * k * 1.9, 1.);
}`;

/** Поле языков пламени: инстансированные билборды с процедурным огнём, яркие — их подхватывает свечение (bloom). */
export class FlameField {
  mesh: THREE.InstancedMesh;
  private seed: THREE.InstancedBufferAttribute;
  private heat: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private m4 = new THREE.Matrix4();
  private n = 0;

  constructor(scene: THREE.Scene, max: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    this.heat = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (let i = 0; i < max; i++) this.seed.setX(i, Math.random());
    geo.setAttribute("aSeed", this.seed);
    geo.setAttribute("aHeat", this.heat);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.layers.enable(THERMAL_LAYER);
    scene.add(this.mesh);
  }

  begin() { this.n = 0; }

  /** Язык пламени с основанием в (x, y, z), шириной w, высотой h и силой горения heat 0..1. */
  add(x: number, y: number, z: number, w: number, h: number, heat: number) {
    if (this.n >= this.seed.count) return;
    this.m4.makeScale(w, h, 1).setPosition(x, y, z);
    this.mesh.setMatrixAt(this.n, this.m4);
    this.heat.setX(this.n, heat);
    this.n++;
  }

  end(dt: number, cam: THREE.Vector3) {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heat.needsUpdate = true;
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uCam.value.copy(cam);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
