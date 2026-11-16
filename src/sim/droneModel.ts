// Детальная PBR-модель мультикоптера: рама, моторы, винты с размытием, шасси, подвес, огни.
import * as THREE from "three";
import { Airframe } from "./airframes";
import { DroneSim } from "./physics";

export interface DroneModel {
  group: THREE.Group;
  update(dt: number, sim: DroneSim, payloadFrac: number, time: number): void;
}

function blurTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, "rgba(20,20,20,0)"); gr.addColorStop(0.15, "rgba(20,20,20,0.55)");
  gr.addColorStop(0.8, "rgba(30,30,30,0.35)"); gr.addColorStop(0.93, "rgba(240,240,240,0.55)"); gr.addColorStop(1, "rgba(30,30,30,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildDrone(af: Airframe, opts: { tank: boolean; boom: number }): DroneModel {
  const group = new THREE.Group();
  const s = af.arm;
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.38, metalness: 0.35 });
  const shell = new THREE.MeshPhysicalMaterial({ color: af.color, roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.15 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.3, metalness: 0.95 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.05, metalness: 0.9 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const tube = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: THREE.Material) => {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const m = add(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    return m;
  };

  // центральная рама и обтекатель
  const plateR = s * 0.34 + 0.03;
  add(new THREE.CylinderGeometry(plateR, plateR, 0.012, 8), carbon, 0, 0.03, 0);
  add(new THREE.CylinderGeometry(plateR, plateR, 0.012, 8), carbon, 0, -0.03, 0);
  const body = add(new THREE.SphereGeometry(1, 24, 16), shell, 0, 0.07 + s * 0.03, -s * 0.02);
  body.scale.set(s * 0.3 + 0.02, s * 0.13 + 0.025, s * 0.44 + 0.03);
  const batt = add(new THREE.BoxGeometry(s * 0.3, s * 0.12 + 0.02, s * 0.42), new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6 }), 0, -0.05 - s * 0.07, s * 0.05);
  add(new THREE.BoxGeometry(s * 0.305, 0.02, s * 0.2), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 }), 0, 0, 0, batt);
  // GPS и антенны
  tube(0, 0.08, s * 0.3, 0, 0.2 + s * 0.12, s * 0.3, 0.006 + s * 0.006, carbon);
  add(new THREE.CylinderGeometry(0.03 + s * 0.03, 0.03 + s * 0.03, 0.018, 16), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4 }), 0, 0.21 + s * 0.12, s * 0.3);
  for (const sx of [-1, 1]) tube(sx * s * 0.2, -0.03, s * 0.3, sx * s * 0.28, -0.14 - s * 0.1, s * 0.36, 0.004, rubber);

  // шасси
  const gearH = 0.16 + af.arm * 0.28;
  const tr = 0.008 + s * 0.012;
  for (const sx of [-1, 1]) {
    const footX = sx * (s * 0.42 + 0.04);
    tube(sx * s * 0.18, -0.03, 0, footX, -gearH + tr, 0, tr, carbon);
    tube(footX, -gearH + tr, -s * 0.5 - 0.05, footX, -gearH + tr, s * 0.5 + 0.05, tr, carbon);
    for (const sz of [-1, 1]) {
      const pad = add(new THREE.CylinderGeometry(tr * 1.9, tr * 1.9, s * 0.16 + 0.03, 10), rubber, footX, -gearH + tr, sz * (s * 0.38 + 0.03));
      pad.rotation.x = Math.PI / 2;
    }
  }

  // подвес с камерой
  const gim = new THREE.Group();
  gim.position.set(0, -0.07 - s * 0.05, -s * 0.42 - 0.03);
  group.add(gim);
  add(new THREE.BoxGeometry(0.02 + s * 0.02, 0.05 + s * 0.05, 0.02 + s * 0.02), carbon, 0, 0, 0, gim);
  const camR = 0.028 + s * 0.035;
  add(new THREE.SphereGeometry(camR, 16, 12), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.5 }), 0, -0.04 - s * 0.04, 0, gim);
  const lens = add(new THREE.CylinderGeometry(camR * 0.55, camR * 0.55, camR * 0.5, 16), glass, 0, -0.04 - s * 0.04, -camR * 0.85, gim);
  lens.rotation.x = Math.PI / 2;

  // бак и штанга опрыскивателя
  let liquid: THREE.Mesh | null = null;
  if (opts.tank) {
    const tr2 = Math.min(gearH * 0.36, s * 0.24), len = s * 0.55;
    const tankMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f6f8, roughness: 0.3, transmission: 0.6, thickness: 0.05, transparent: true, opacity: 0.55 });
    const tank = add(new THREE.CapsuleGeometry(tr2, len, 6, 14), tankMat, 0, -gearH * 0.52, s * 0.08);
    tank.rotation.x = Math.PI / 2;
    tank.castShadow = true;
    liquid = add(new THREE.CapsuleGeometry(tr2 * 0.9, len, 4, 12), new THREE.MeshStandardMaterial({ color: 0x2f7fd0, roughness: 0.2 }), 0, -gearH * 0.52, s * 0.08);
    liquid.rotation.x = Math.PI / 2;
  }
  if (opts.boom > 0) {
    tube(-opts.boom / 2, -gearH * 0.8, s * 0.2, opts.boom / 2, -gearH * 0.8, s * 0.2, 0.012, alu);
    for (let i = 0; i <= 6; i++) add(new THREE.ConeGeometry(0.025, 0.06, 8), rubber, -opts.boom / 2 + (opts.boom * i) / 6, -gearH * 0.8 - 0.04, s * 0.2);
  }

  // лучи, моторы, винты
  const blur = blurTexture();
  const armR = 0.011 + s * 0.02;
  const seen = new Set<string>();
  const rotors: { spin: THREE.Group; disc: THREE.MeshBasicMaterial; blades: THREE.MeshStandardMaterial; angle: number }[] = [];
  const ledMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 6, toneMapped: false });
  af.motors.forEach((m) => {
    const key = `${m.x.toFixed(2)},${m.z.toFixed(2)}`;
    if (!seen.has(key)) {
      seen.add(key);
      const len = Math.hypot(m.x, m.z), k = (plateR * 0.6) / len;
      tube(m.x * k, 0, m.z * k, m.x, 0, m.z, armR, carbon);
      add(new THREE.CylinderGeometry(af.propR * 0.2, af.propR * 0.2, 0.02 + Math.abs(m.y) * 2, 14), carbon, m.x, 0, m.z);
      add(new THREE.SphereGeometry(armR * 0.9, 8, 6), ledMat(m.z < 0 ? 0xff2020 : 0x20ff40), m.x * 0.82, -armR * 1.3, m.z * 0.82);
    }
    const dirY = m.y < 0 ? -1 : 1;
    const baseY = m.y !== 0 ? m.y * 1.1 : 0;
    const bellH = 0.022 + af.propR * 0.1;
    add(new THREE.CylinderGeometry(af.propR * 0.17, af.propR * 0.19, bellH, 18), alu, m.x, baseY + dirY * (0.012 + bellH / 2), m.z);
    add(new THREE.CylinderGeometry(af.propR * 0.192, af.propR * 0.192, bellH * 0.25, 18), shell, m.x, baseY + dirY * (0.012 + bellH / 2), m.z);
    const spin = new THREE.Group();
    spin.position.set(m.x, baseY + dirY * (0.02 + bellH), m.z);
    group.add(spin);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.3, metalness: 0.3, transparent: true });
    for (const side of [-1, 1]) {
      const blade = add(new THREE.BoxGeometry(af.propR * 0.92, 0.005, af.propR * 0.15), bladeMat, side * af.propR * 0.5, 0, 0, spin);
      blade.rotation.x = side * m.dir * 0.2;
    }
    add(new THREE.CylinderGeometry(af.propR * 0.07, af.propR * 0.09, 0.02, 10), alu, 0, 0, 0, spin);
    const discMat = new THREE.MeshBasicMaterial({ map: blur, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(af.propR, 28), discMat);
    disc.rotation.x = -Math.PI / 2;
    spin.add(disc);
    rotors.push({ spin, disc: discMat, blades: bladeMat, angle: 0 });
  });
  const strobe = add(new THREE.SphereGeometry(0.012 + s * 0.012, 8, 6), ledMat(0xffffff), 0, 0.1 + s * 0.14, s * 0.2);

  return {
    group,
    update(dt, sim, payloadFrac, time) {
      rotors.forEach((r, i) => {
        const k = sim.motorOk[i] ? Math.sqrt(Math.max(0, sim.thrust[i] / af.motorThrust)) : 0;
        const rpm = k * 110;
        r.angle += af.motors[i].dir * rpm * dt;
        r.spin.rotation.y = r.angle;
        const blurK = THREE.MathUtils.smoothstep(rpm, 8, 30);
        r.disc.opacity = blurK * 0.55;
        r.blades.opacity = 1 - blurK * 0.85;
      });
      if (liquid) { liquid.visible = payloadFrac > 0.02; liquid.scale.set(0.35 + 0.65 * payloadFrac, 1, 0.35 + 0.65 * payloadFrac); }
      strobe.visible = time % 1.2 < 0.08;
    },
  };
}
