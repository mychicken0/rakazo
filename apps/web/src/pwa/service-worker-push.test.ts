import { describe, expect, it, vi } from "vitest";
import type { ServiceWorkerScope } from "./service-worker.js";
import { chatPush, installServiceWorker } from "./service-worker.js";

const ORIGIN = "https://app.example.com";

type Client = {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus?: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
};

function setup(windows: Client[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const scope = {
    location: { origin: ORIGIN },
    caches: {} as CacheStorage,
    clients: { matchAll: async () => windows, openWindow },
    registration: { waiting: null, showNotification },
    skipWaiting: vi.fn(),
    fetch: vi.fn(),
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, listener);
    },
  };
  installServiceWorker(scope as unknown as ServiceWorkerScope, [], "rakazo-shell-test");
  async function dispatch(type: string, extra: object) {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({
      ...extra,
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  }
  return { showNotification, openWindow, dispatch };
}

const reply = {
  title: "Chief",
  body: "Done: the report is ready",
  tag: "thread-1:completion",
  path: "/app/bot-1",
};
const push = (data: unknown) => ({ data: { json: () => data } });

describe("service worker push", () => {
  it("shows a chat reply while the app is closed, with where a tap goes", async () => {
    const sw = setup();
    await sw.dispatch("push", push(reply));
    expect(sw.showNotification).toHaveBeenCalledWith("Chief", {
      body: reply.body,
      tag: reply.tag,
      icon: "/icon-192.png",
      data: { path: "/app/bot-1" },
    });
  });

  it("leaves the alert to the app when someone is looking at it", async () => {
    const sw = setup([{ url: `${ORIGIN}/app`, focused: true, visibilityState: "visible" }]);
    await sw.dispatch("push", push(reply));
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("still shows it when the app is open but in the background", async () => {
    const sw = setup([{ url: `${ORIGIN}/app`, focused: false, visibilityState: "hidden" }]);
    await sw.dispatch("push", push(reply));
    expect(sw.showNotification).toHaveBeenCalledOnce();
  });

  it("ignores pushes that are not chat replies or point outside the app", async () => {
    const sw = setup();
    await sw.dispatch("push", push({ ...reply, path: "https://evil.example/app" }));
    await sw.dispatch("push", push({ title: "x" }));
    await sw.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("not json");
        },
      },
    });
    expect(sw.showNotification).not.toHaveBeenCalled();
    expect(chatPush({ ...reply, path: "/app/g/group-1" })?.path).toBe("/app/g/group-1");
  });

  it("opens the chat in the running app on tap", async () => {
    const client = {
      url: `${ORIGIN}/app`,
      focus: vi.fn(async () => undefined),
      navigate: vi.fn(async () => undefined),
    };
    const sw = setup([client]);
    const close = vi.fn();
    await sw.dispatch("notificationclick", {
      notification: { data: { path: "/app/bot-1" }, close },
    });
    expect(close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/app/bot-1`);
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("starts the app on the chat when it is closed", async () => {
    const sw = setup();
    await sw.dispatch("notificationclick", {
      notification: { data: { path: "/app/g/group-1" }, close: vi.fn() },
    });
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/app/g/group-1`);
  });
});
