// Сборка симулятора одной страницей с относительными путями.
//   Публикация по ссылке (хостинг не отдаёт .hdr/.glb):  SIM_PACKED=1 npx vite build -c vite.standalone.config.ts
//   Настольное приложение (Electron):                    SIM_OUT=desktop/app npx vite build -c vite.standalone.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  define: {
    "import.meta.env.VITE_STANDALONE": JSON.stringify("1"),
    "import.meta.env.VITE_PACKED_ASSETS": JSON.stringify(process.env.SIM_PACKED ? "1" : ""),
  },
  build: {
    outDir: process.env.SIM_OUT ?? "dist-simulator",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "simulator.html"),
      output: { inlineDynamicImports: true, entryFileNames: "assets/simulator.js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
