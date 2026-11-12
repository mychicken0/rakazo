export const SKIP_WAITING = "rakazo:skip-waiting";
export const CACHE_PREFIX = "rakazo-shell-";

// Live data, auth callbacks and the screen proxy always go straight to the server.
const BYPASS_PREFIXES = ["/api", "/rpc", "/novnc", "/.well-known", "/health"];
// A self-hosted instance's theme (stylesheet and fonts): fetched fresh, cached for offline reloads.
const THEME_PREFIX = "/instance-theme";
const ACTIVATION_TIMEOUT_MS = 3_000;
const BUILD_ID = /^\d{14}$/;

type ExtendableEvent = { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & {
  request: Request;
  respondWith(response: Promise<Response>): void;
};
type MessageEvent = ExtendableEvent & { data: unknown };
type PushEvent = ExtendableEvent & { data: { json(): unknown } | null };
type NotificationClickEvent = ExtendableEvent & {
  notification: { data: unknown; close(): void };
};
type WindowClient = {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus?(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
};

export type ServiceWorkerScope = {
  location: { origin: string };
  caches: CacheStorage;
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled?: boolean;
    }): Promise<readonly unknown[]>;
    openWindow?(url: string): Promise<unknown>;
  };
  registration: {
    waiting: Pick<ServiceWorker, "postMessage" | "addEventListener" | "removeEventListener"> | null;
    showNotification?(title: string, options: NotificationOptions): Promise<void>;
  };
  skipWaiting(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickEvent) => void,
  ): void;
};

type ChatPush = { title: string; body: string; tag: string; path: string };

/** A server push for a chat, or nothing when it is not one; only in-app paths are opened. */
export function chatPush(data: unknown): ChatPush | undefined {
  if (!data || typeof data !== "object") return undefined;
  const { title, body, tag, path } = data as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string" || typeof tag !== "string")
    return undefined;
  if (typeof path !== "string" || !/^\/app(?:\/[A-Za-z0-9_-]+)*$/.test(path)) return undefined;
  return { title, body, tag, path };
}

export function bypassesServiceWorker(pathname: string): boolean {
  return BYPASS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Precaches the app shell, serves hashed assets cache-first and falls back to
 * the cached shell for navigations while offline. A new version waits until
 * the next navigation of the last open window, then takes over by reloading
 * that navigation. The previous shell stays cached for tabs still using it.
 */
export function installServiceWorker(
  scope: ServiceWorkerScope,
  precache: readonly string[],
  cacheName: string,
): void {
  const precached = new Set(precache);

  scope.addEventListener("install", (event) => {
    event.waitUntil(
      scope.caches
        .open(cacheName)
        .then((cache) =>
          cache.addAll(
            precache.map(
              (url) => new Request(new URL(url, scope.location.origin), { cache: "no-cache" }),
            ),
          ),
        ),
    );
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      scope.caches.keys().then((names) => {
        // Keep the newest previous shell for tabs still running its bundle. Names end in the build
        // id, which sorts oldest first; older workers named caches by a content hash instead, so
        // one of those is kept only when no build-named cache exists.
        const previous = names.filter(
          (name) => name.startsWith(CACHE_PREFIX) && name !== cacheName,
        );
        const byBuild = previous
          .filter((name) => BUILD_ID.test(name.slice(CACHE_PREFIX.length)))
          .sort();
        const keep = byBuild.at(-1) ?? previous.at(-1);
        return Promise.all(
          previous.filter((name) => name !== keep).map((name) => scope.caches.delete(name)),
        );
      }),
    );
  });

  scope.addEventListener("message", (event) => {
    if (event.data === SKIP_WAITING) event.waitUntil(scope.skipWaiting());
  });

  scope.addEventListener("push", (event) => {
    let push: ChatPush | undefined;
    try {
      push = chatPush(event.data?.json());
    } catch {
      return;
    }
    if (!push) return;
    const { title, body, tag, path } = push;
    event.waitUntil(
      (async () => {
        const windows = (await scope.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })) as WindowClient[];
        // Someone looking at the app sees its own alert; the push is for when it is closed.
        if (windows.some((client) => client.focused && client.visibilityState === "visible"))
          return;
        await scope.registration.showNotification?.(title, {
          body,
          tag,
          icon: "/icon-192.png",
          data: { path },
        });
      })(),
    );
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const path = chatPush({
      title: "",
      body: "",
      tag: "",
      ...(event.notification.data as object),
    })?.path;
    const url = new URL(path ?? "/app", scope.location.origin).href;
    event.waitUntil(
      (async () => {
        const windows = (await scope.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })) as WindowClient[];
        const open = windows.find((client) => client.url.startsWith(scope.location.origin));
        if (open?.focus) {
          await open.focus();
          if (open.url !== url) await open.navigate?.(url).catch(() => undefined);
          return;
        }
        await scope.clients.openWindow?.(url);
      })(),
    );
  });

  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== scope.location.origin || bypassesServiceWorker(url.pathname)) return;
    if (request.mode === "navigate") {
      event.respondWith(navigate(request));
    } else if (precached.has(url.pathname) || url.pathname.startsWith("/assets/")) {
      event.respondWith(cacheFirst(event, url.pathname));
    } else if (url.pathname.startsWith(THEME_PREFIX)) {
      event.respondWith(networkFirst(event));
    }
  });

  async function networkFirst(event: FetchEvent): Promise<Response> {
    const cache = await scope.caches.open(cacheName);
    try {
      const response = await scope.fetch(event.request);
      if (response.ok) {
        event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined));
      }
      return response;
    } catch (error) {
      const cached = await cachedAnywhere(event.request);
      if (cached) return cached;
      throw error;
    }
  }

  /** The current shell cache first, then the previous one activation keeps for open tabs. */
  async function cachedAnywhere(request: Request): Promise<Response | undefined> {
    const cached = await (await scope.caches.open(cacheName)).match(request);
    if (cached) return cached;
    for (const name of await scope.caches.keys()) {
      if (!name.startsWith(CACHE_PREFIX) || name === cacheName) continue;
      const previous = await (await scope.caches.open(name)).match(request);
      if (previous) return previous;
    }
    return undefined;
  }

  async function navigate(request: Request): Promise<Response> {
    if (await activateWaitingWorker()) {
      return new Response("", { headers: { Refresh: "0" } });
    }
    try {
      return await scope.fetch(request);
    } catch (error) {
      const shell = await (await scope.caches.open(cacheName)).match("/");
      if (shell) return shell;
      throw error;
    }
  }

  async function activateWaitingWorker(): Promise<boolean> {
    const waiting = scope.registration.waiting;
    if (!waiting) return false;
    if ((await scope.clients.matchAll({ type: "window" })).length > 1) return false;
    return new Promise((resolve) => {
      const changed = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        waiting.removeEventListener("statechange", changed);
        resolve(false);
      }, ACTIVATION_TIMEOUT_MS);
      waiting.addEventListener("statechange", changed, { once: true });
      waiting.postMessage(SKIP_WAITING);
    });
  }

  async function cacheFirst(event: FetchEvent, pathname: string): Promise<Response> {
    const cached = await cachedAnywhere(event.request);
    if (cached) return cached;
    const cache = await scope.caches.open(cacheName);
    const response = await scope.fetch(event.request);
    // A missing chunk can come back as the SPA's HTML; never store that as an asset.
    const html = response.headers.get("content-type")?.includes("text/html") ?? false;
    if (response.ok && !html && pathname.startsWith("/assets/")) {
      event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined));
    }
    return response;
  }
}
