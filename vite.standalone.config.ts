// Сборка симулятора одной страницей с относительными путями: npx vite build -c vite.standalone.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  define: { "import.meta.env.VITE_STANDALONE": JSON.stringify("1") },
  build: {
    outDir: "dist-simulator",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "simulator.html"),
      output: { inlineDynamicImports: true, entryFileNames: "assets/simulator.js", assetFileNames: "assets/[name][extname]" },
    },
  },
});
