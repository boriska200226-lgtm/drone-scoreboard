import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Airframe } from "@/sim/airframes";
import { buildDrone } from "@/sim/droneModel";
import { DroneSim } from "@/sim/physics";

/** Вращающаяся 3D-модель аппарата на подиуме ангара. */
export default function HangarPreview({ af, tank, livery }: { af: Airframe; tank: boolean; livery?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.7;

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const s = af.arm * 3;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 20 });
    const rim = new THREE.DirectionalLight(0x66ccff, 1.6);
    rim.position.set(-4, 2, -5);
    scene.add(key, rim, new THREE.HemisphereLight(0x9fb4d0, 0x101418, 0.6));

    // подиум с подсвеченным кольцом
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(af.arm * 2.1, af.arm * 2.2, 0.06, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.35, metalness: 0.6 }));
    podium.position.y = -0.03;
    podium.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(af.arm * 2.12, 0.012, 8, 96),
      new THREE.MeshBasicMaterial({ color: af.color, toneMapped: false }));
    ring.rotation.x = Math.PI / 2;
    scene.add(podium, ring);

    const model = buildDrone(af, { tank, boom: 0, livery });
    const gearH = 0.16 + af.arm * 0.28;
    model.group.position.y = gearH;
    scene.add(model.group);
    const sim = new DroneSim(af);
    sim.thrust.fill(af.motorThrust * 0.08);
    sim.landed = true;

    const cam = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    const dist = af.arm * 5.4 + 0.6;
    let raf = 0, t = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio())) renderer.setSize(w, h, false);
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      const a = t * 0.35 + 0.6;
      cam.position.set(Math.sin(a) * dist, dist * 0.42 + gearH, Math.cos(a) * dist);
      cam.lookAt(0, gearH * 0.8, 0);
      model.update(dt, sim, 0.7, t);
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
      env.dispose();
      pm.dispose();
      renderer.dispose();
    };
  }, [af, tank, livery]);

  return <canvas ref={ref} className="w-full h-full block" />;
}
