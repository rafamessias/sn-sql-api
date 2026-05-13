/** Safe single path segment for downloads (no slashes or reserved characters). */
export const sanitizeDownloadStem = (name: string): string => {
  const trimmed = name.trim() || "query";
  const cleaned = trimmed.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ");
  return cleaned.slice(0, 120) || "query";
};

export const downloadTextFile = (
  filename: string,
  body: string,
  mime = "text/plain;charset=utf-8",
): void => {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
