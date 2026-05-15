import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { devHmrDockerPlugin } from "./vite-plugin-dev-hmr";
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

const DEV_PORT = Number(process.env.VITE_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [devHmrDockerPlugin(), spa404Plugin(), preact()],
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: true,
    watch: USE_POLLING
      ? {
          usePolling: true,
          // Slower polling reduces watcher churn on WSL2 bind mounts (fewer HMR reconnects).
          interval: Number(process.env.VITE_POLL_INTERVAL_MS ?? 1000),
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
