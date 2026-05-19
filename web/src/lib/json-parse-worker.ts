const PARSE_WORKER_URL = new URL("../workers/json-parse.worker.ts", import.meta.url);

let worker: Worker | null = null;

const getParseWorker = (): Worker => {
  worker ??= new Worker(PARSE_WORKER_URL, { type: "module" });
  return worker;
};

type ParseWorkerResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export const parseJsonInWorker = <T>(text: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const w = getParseWorker();

    const onMessage = (event: MessageEvent<ParseWorkerResponse>) => {
      cleanup();
      const payload = event.data;
      if (payload.ok) {
        resolve(payload.value as T);
        return;
      }
      reject(new Error(payload.error || "JSON parse failed"));
    };

    const onError = () => {
      cleanup();
      reject(new Error("JSON parse worker failed"));
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ text });
  });
