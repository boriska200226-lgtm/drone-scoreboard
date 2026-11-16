// Простая система частиц на THREE.Points с собственным шейдером.
import * as THREE from "three";
import { THERMAL_LAYER } from "./world";

const VERT = `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.25, d) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;

export interface ParticleOpts {
  max: number;
  additive?: boolean;
  gravity?: number;
  drag?: number; // насколько частица увлекается ветром, 1/с
  grow?: number; // рост размера, м/с
  thermal?: boolean; // видна ли в тепловизоре
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    if (opts.thermal) this.points.layers.enable(THERMAL_LAYER);
    scene.add(this.points);
  }

  setScale(s: number) { this.mat.uniforms.uScale.value = s; }

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
    const { gravity = 0, drag = 0, grow = 0, ground, onHit } = this.opts;
    const k = Math.min(1, drag * dt);
    for (let i = 0; i < this.opts.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.vel[j] += (wind.x - this.vel[j]) * k;
      this.vel[j + 2] += (wind.z - this.vel[j + 2]) * k;
      this.vel[j + 1] -= gravity * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += grow * dt;
      const t = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = this.alpha[i] * Math.min(1, t * 2.2);
      if (ground && this.pos[j + 1] <= ground(this.pos[j], this.pos[j + 2])) {
        if (onHit) onHit(this.pos[j], this.pos[j + 2], this.data[i]);
        this.life[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0;
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
