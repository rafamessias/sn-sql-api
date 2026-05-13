import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Connect, Plugin, ResolvedConfig } from "vite";

/** First path segment after `/` that loads the Preact shell (see `use-console-tab.ts`). */
const SPA_ROOT_SEGMENTS = new Set(["", "editor", "schema", "connections", "logs"]);

/**
 * Path prefixes proxied to the Python API in dev (`server.proxy` in vite.config.ts).
 * The 404 middleware must let these through **before** the proxy; otherwise `/about` etc.
 * never reach the backend.
 */
export const BACKEND_PROXY_PATH_PREFIXES = [
  "/query",
  "/schema/tables",
  "/schema/columns",
  "/health",
  "/egress-ip",
  "/about",
  "/debug",
] as const;

const acceptsHtml = (accept: string | undefined): boolean =>
  accept === undefined ||
  accept === "" ||
  accept.includes("text/html") ||
  accept.includes("*/*");

const isSpaShellPath = (pathname: string): boolean => {
  const clean = pathname.replace(/\/$/, "") || "/";
  if (clean === "/") return true;
  const rest = clean.slice(1);
  if (rest.includes("/")) return false;
  return SPA_ROOT_SEGMENTS.has(rest);
};

const shouldSkip = (pathname: string): boolean =>
  pathname.startsWith("/@") ||
  pathname.startsWith("/node_modules") ||
  pathname.startsWith("/src") ||
  pathname.startsWith("/assets/");

const isBackendProxyPath = (pathname: string): boolean =>
  BACKEND_PROXY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

const create404Middleware = (path404: string): Connect.NextHandleFunction => {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (!acceptsHtml(req.headers.accept)) {
      next();
      return;
    }
    const pathname = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
    if (!pathname || shouldSkip(pathname)) {
      next();
      return;
    }
    if (isBackendProxyPath(pathname)) {
      next();
      return;
    }
    if (isSpaShellPath(pathname)) {
      next();
      return;
    }
    const last = pathname.split("/").pop() ?? "";
    if (pathname !== "/" && last.includes(".")) {
      next();
      return;
    }
    if (!existsSync(path404)) {
      next();
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(readFileSync(path404, "utf-8"));
  };
};

const html404PathDev = (config: ResolvedConfig): string =>
  join(config.root, "public/404.html");

const html404PathPreview = (config: ResolvedConfig): string =>
  join(config.root, config.build.outDir, "404.html");

/** Runs before Vite SPA `htmlFallbackMiddleware` so unknown HTML navigations get a real 404. */
export const spa404Plugin = (): Plugin => ({
  name: "sn-sql-spa-404",
  enforce: "pre",
  configureServer({ middlewares, config }) {
    middlewares.use(create404Middleware(html404PathDev(config)));
  },
  configurePreviewServer({ middlewares, config }) {
    middlewares.use(create404Middleware(html404PathPreview(config)));
  },
});
