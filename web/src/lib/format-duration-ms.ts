/**
 * Elapsed clock for in-progress operations: `m:ss` (e.g. `0:03`, `12:06`).
 */
export const formatRunningClock = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * Formats a wall-clock duration in milliseconds for status messages.
 * Uses minutes, seconds, and milliseconds only where needed.
 */
export const formatDurationMs = (ms: number): string => {
  const total = Math.max(0, Math.round(Number(ms)) || 0);
  if (total < 1000) {
    return `${total} ms`;
  }
  const wholeSeconds = Math.floor(total / 1000);
  const remainderMs = total % 1000;
  if (wholeSeconds < 60) {
    return remainderMs === 0
      ? `${wholeSeconds} s`
      : `${wholeSeconds} s ${remainderMs} ms`;
  }
  const minutes = Math.floor(wholeSeconds / 60);
  const sec = wholeSeconds % 60;
  const parts: string[] = [];
  parts.push(minutes === 1 ? "1 min" : `${minutes} min`);
  if (sec > 0) {
    parts.push(sec === 1 ? "1 s" : `${sec} s`);
  }
  if (remainderMs > 0) {
    parts.push(`${remainderMs} ms`);
  }
  return parts.join(" ");
};
