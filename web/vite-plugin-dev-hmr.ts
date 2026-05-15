import type { Plugin } from "vite";

/**
 * Docker / WSL2 dev: pin the HMR WebSocket to the host-mapped port (localhost:5173).
 * Without this, the client may target the container hostname and drop after idle — Vite's
 * full-page grey "connection lost" overlay covers the browser on :5173.
 */
export function devHmrDockerPlugin(): Plugin {
  return {
    name: "sn-sql-dev-hmr-docker",
    config(_config, { command }) {
      if (command !== "serve") return;

      const port = Number(process.env.VITE_DEV_PORT ?? 5173);
      const host = process.env.VITE_HMR_HOST ?? "localhost";
      const clientPort = Number(process.env.VITE_HMR_CLIENT_PORT ?? port);

      return {
        server: {
          hmr: {
            protocol: "ws",
            host,
            port,
            clientPort,
            // Avoid full-viewport grey overlay on brief HMR drops; errors stay in the terminal.
            overlay: false,
          },
        },
      };
    },
  };
}
