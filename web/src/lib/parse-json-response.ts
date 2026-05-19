import { parseJsonInWorker } from "./json-parse-worker";

/** Bodies at or above this size are parsed off the main thread when a worker is available. */
export const PARSE_JSON_IN_WORKER_MIN_BYTES = 512_000;

const yieldToMainThread = (): Promise<void> =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });

const parseJsonOnMainThread = async <T>(text: string): Promise<T> => {
  await yieldToMainThread();
  return JSON.parse(text) as T;
};

/** Parse a fetch body without blocking the UI on large JSON.parse. */
export const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  const useWorker =
    typeof Worker !== "undefined" &&
    text.length >= PARSE_JSON_IN_WORKER_MIN_BYTES;

  if (useWorker) {
    try {
      return await parseJsonInWorker<T>(text);
    } catch {
      // Stale bundles, CSP, or worker load failures — still return data on main thread.
      return parseJsonOnMainThread<T>(text);
    }
  }

  return parseJsonOnMainThread<T>(text);
};
