/** The host without a leading "www.", which most sites serve as the same place. */
function siteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Whether a saved login's HTTPS origin and a page's origin are the same site: equal, or differing
 * only by a leading "www." on the same scheme and port, since sites redirect between the two.
 */
export function sameLoginSite(saved: string, page: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(saved);
    b = new URL(page);
  } catch {
    return false;
  }
  if (a.origin === b.origin) return true;
  return (
    a.protocol === "https:" &&
    b.protocol === "https:" &&
    a.port === b.port &&
    siteHost(a.hostname) === siteHost(b.hostname)
  );
}

/** The origin with "www." added or removed: where a login saved for `origin` may also be used. */
export function loginSiteVariant(origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  url.hostname = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return url.origin;
}
