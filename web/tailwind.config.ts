import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0d1117",
        surface: "#161b22",
        "surface-2": "#21262d",
        border: "#30363d",
        text: "#e6edf3",
        muted: "#8b949e",
        subtle: "#6e7681",
        accent: {
          DEFAULT: "#3fb950",
          dim: "#1a4422",
          glow: "rgba(63, 185, 80, 0.15)",
        },
        info: "#79c0ff",
        warn: "#e3b341",
        danger: "#f85149",
        code: "#010409",
      },
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          '"IBM Plex Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        focus: "0 0 0 3px rgba(63, 185, 80, 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
