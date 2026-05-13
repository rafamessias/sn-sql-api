import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { BACKEND_PROXY_PATH_PREFIXES, spa404Plugin } from "./vite-plugin-spa-404";

const BACKEND = process.env.VITE_BACKEND_URL ?? "http://localhost:8000";

/** Do not proxy `/schema` alone — that path is the SPA Schema tab. Only proxy API routes. */
const backendProxy = Object.fromEntries(
  BACKEND_PROXY_PATH_PREFIXES.map((prefix) => [
    prefix,
    { target: BACKEND, changeOrigin: true },
  ]),
);
const USE_POLLING = process.env.VITE_USE_POLLING === "true";

export default defineConfig({
  plugins: [spa404Plugin(), preact()],
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
    proxy: backendProxy,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
