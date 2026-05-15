/** Run work after the next paint so status timers and Stop stay responsive. */
export const scheduleHeavyUpdate = (fn: () => void): void => {
  const run = () => {
    try {
      fn();
    } catch {
      // ignore — caller surfaces errors separately when needed
    }
  };
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => {
      if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(run, { timeout: 250 });
      } else {
        globalThis.setTimeout(run, 0);
      }
    });
  } else {
    globalThis.setTimeout(run, 0);
  }
};
