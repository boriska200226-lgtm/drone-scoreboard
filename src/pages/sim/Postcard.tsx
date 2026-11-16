import { useEffect, useRef } from "react";
import { MissionDef } from "@/sim/missions";
import { mulberry32 } from "@/sim/noise";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Рисованная «открытка» локации: небо по палитре миссии, увалы, кромка тайги, река. */
export default function Postcard({ mission, className }: { mission: MissionDef; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    const p = mission.world.palette;
    const rnd = mulberry32(mission.world.seed);

    const sky = g.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, hex(p.skyTop)); sky.addColorStop(1, hex(p.skyBottom));
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // солнце/облака
    const sx = W * (0.5 + p.sunDir[0] * 0.35), sy = H * (0.55 - p.sunDir[1] * 0.45);
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.5);
    sun.addColorStop(0, `rgba(255,240,210,${0.55 * (1 - p.clouds * 0.6)})`); sun.addColorStop(1, "rgba(255,240,210,0)");
    g.fillStyle = sun; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9 * p.clouds + 2; i++) {
      const x = rnd() * W, y = rnd() * H * 0.35, r = 20 + rnd() * 50;
      const c = g.createRadialGradient(x, y, 0, x, y, r);
      c.addColorStop(0, "rgba(255,255,255,0.35)"); c.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = c; g.beginPath(); g.ellipse(x, y, r * 1.8, r * 0.6, 0, 0, 6.3); g.fill();
    }
    // дальние увалы в дымке
    const ridge = (base: number, amp: number, col: string) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, base + Math.sin(x * 0.012 + base) * amp + Math.sin(x * 0.031) * amp * 0.4);
      g.lineTo(W, H); g.fill();
    };
    ridge(H * 0.52, 8, `${hex(p.fog)}cc`);
    // ряды ёлок: дальние светлее, ближние темнее
    const rows = [[0.6, 0.35, 7], [0.7, 0.6, 11], [0.82, 0.9, 17]];
    for (const [yk, dark, size] of rows) {
      const y0 = H * yk;
      g.fillStyle = hex(p.groundA);
      g.fillRect(0, y0, W, H - y0);
      const tree = hex(p.tree);
      for (let x = -10; x < W + 10; x += size * (0.5 + rnd() * 0.5)) {
        const h = size * (1.6 + rnd() * 1.6);
        g.globalAlpha = dark;
        g.fillStyle = p.snow ? "#e8eef4" : tree;
        if (!p.snow || rnd() < 0.4) g.fillStyle = tree;
        g.beginPath(); g.moveTo(x, y0 - h); g.lineTo(x + size * 0.45, y0 + 2); g.lineTo(x - size * 0.45, y0 + 2); g.fill();
      }
      g.globalAlpha = 1;
    }
    if (mission.world.river) {
      g.fillStyle = `${hex(p.water)}dd`;
      g.beginPath(); g.moveTo(0, H * 0.9);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, H * 0.9 + Math.sin(x * 0.02) * 4);
      for (let x = W; x >= 0; x -= 8) g.lineTo(x, H * 0.96 + Math.sin(x * 0.02 + 1) * 4);
      g.fill();
    }
    // воздушная перспектива
    const fog = g.createLinearGradient(0, H * 0.4, 0, H);
    fog.addColorStop(0, `${hex(p.fog)}00`); fog.addColorStop(1, `${hex(p.fog)}${p.fogDensity > 0.004 ? "88" : "22"}`);
    g.fillStyle = fog; g.fillRect(0, 0, W, H);
  }, [mission]);
  return <canvas ref={ref} className={className} />;
}
