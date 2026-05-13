import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const BACKEND = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";
const USE_POLLING = process.env.VITE_USE_POLLING === "true";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    watch: USE_POLLING
      ? {
          usePolling: true,
          interval: 300,
        }
      : undefined,
    proxy: {
      "/query": { target: BACKEND, changeOrigin: true },
      "/schema": { target: BACKEND, changeOrigin: true },
      "/health": { target: BACKEND, changeOrigin: true },
      "/debug": { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
