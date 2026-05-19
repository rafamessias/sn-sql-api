/// <reference lib="webworker" />

type ParseRequest = { text: string };
type ParseResponse =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  try {
    const value = JSON.parse(event.data.text) as unknown;
    const out: ParseResponse = { ok: true, value };
    self.postMessage(out);
  } catch (err) {
    const out: ParseResponse = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(out);
  }
};
