/** Parse a fetch body without blocking the UI thread on the full JSON.parse at once. */
export const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
  return JSON.parse(text) as T;
};
