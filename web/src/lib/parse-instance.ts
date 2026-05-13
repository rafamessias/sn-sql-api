const SERVICE_NOW_SUFFIX = ".service-now.com";

const shortenServiceNowHost = (host: string): string => {
  const trimmed = host.trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(SERVICE_NOW_SUFFIX)) {
    return trimmed.slice(0, trimmed.length - SERVICE_NOW_SUFFIX.length);
  }
  return trimmed;
};

/**
 * Best-effort extraction of the ServiceNow instance from a JDBC URL.
 * Returns the host portion, shortened by stripping the `.service-now.com`
 * suffix when present. Returns an empty string if the URL can't be parsed.
 */
export const parseInstanceFromUrl = (url: string): string => {
  if (!url) return "";

  const nativeMatch = url.match(
    /jdbc:servicenow:\/\/(?:https?:\/\/)?([^/:;?\s]+)/i,
  );
  if (nativeMatch && nativeMatch[1]) {
    return shortenServiceNowHost(nativeMatch[1]);
  }

  const simbaMatch = url.match(/Server=https?:\/\/([^/:;?\s]+)/i);
  if (simbaMatch && simbaMatch[1]) {
    return shortenServiceNowHost(simbaMatch[1]);
  }

  return "";
};
