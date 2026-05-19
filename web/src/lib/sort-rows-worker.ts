import type { CellValue } from "./api";

const SORT_WORKER_URL = new URL("../workers/sort-rows.worker.ts", import.meta.url);

let worker: Worker | null = null;

const getSortWorker = (): Worker => {
  worker ??= new Worker(SORT_WORKER_URL, { type: "module" });
  return worker;
};

export const sortRowsInWorker = (
  rows: CellValue[][],
  columnIndex: number,
  direction: "asc" | "desc",
): Promise<CellValue[][]> =>
  new Promise((resolve, reject) => {
    const w = getSortWorker();

    const onMessage = (event: MessageEvent<CellValue[][]>) => {
      cleanup();
      resolve(event.data);
    };

    const onError = () => {
      cleanup();
      reject(new Error("Sort worker failed"));
    };

    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ rows, columnIndex, direction });
  });
