import type { RpcClient } from "./rpc";

const DEVICE_KEY = "rakazo:web-push-device";

type PushHost = {
  navigator: { serviceWorker?: Pick<ServiceWorkerContainer, "ready"> };
  Notification?: { permission: NotificationPermission };
  storage?: Pick<Storage, "getItem" | "setItem">;
  randomUUID(): string;
};

function browserHost(): PushHost {
  let storage: PushHost["storage"];
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    navigator,
    Notification: typeof Notification === "undefined" ? undefined : Notification,
    storage,
    randomUUID: () => crypto.randomUUID(),
  };
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function base64url(buffer: ArrayBuffer | null): string | undefined {
  if (!buffer) return undefined;
  let raw = "";
  for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** One id per browser, so a fresh subscription replaces this browser's old one. */
function deviceId(host: PushHost): string {
  const saved = host.storage?.getItem(DEVICE_KEY);
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
  const id = host.randomUUID();
  host.storage?.setItem(DEVICE_KEY, id);
  return id;
}

let syncing: Promise<void> | undefined;

/**
 * Subscribes this browser to the server's push once notifications are allowed, so replies arrive
 * while the app is closed. Does nothing until permission is granted or when the server sends no
 * web push. Safe to call often: the browser hands back the same subscription.
 */
export function syncWebPush(
  rpc: Pick<RpcClient, "notifications">,
  host: PushHost = browserHost(),
): Promise<void> {
  syncing ??= subscribe(rpc, host)
    .catch(() => undefined)
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}

async function subscribe(rpc: Pick<RpcClient, "notifications">, host: PushHost) {
  if (host.Notification?.permission !== "granted" || !host.navigator.serviceWorker) return;
  const { publicKey } = await rpc.notifications.webPushKey();
  if (!publicKey) return;
  const registration = await host.navigator.serviceWorker.ready;
  const applicationServerKey = keyBytes(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  const current = subscription?.options.applicationServerKey;
  // A subscription made for another key (the server's changed) cannot be pushed to.
  if (subscription && current && base64url(current) !== publicKey) {
    await subscription.unsubscribe().catch(() => undefined);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  const p256dh = base64url(subscription.getKey("p256dh"));
  const auth = base64url(subscription.getKey("auth"));
  if (!p256dh || !auth) return;
  await rpc.notifications.registerWebPush({
    deviceId: deviceId(host),
    endpoint: subscription.endpoint,
    p256dh,
    auth,
  });
}

/** Android only shows notifications from the service worker; a tap opens the chat. */
export async function showThroughServiceWorker(
  title: string,
  options: { body: string; tag: string; icon?: string },
  chat: { botId: string; groupId?: string },
): Promise<void> {
  const registration = await navigator.serviceWorker?.ready;
  await registration?.showNotification(title, {
    ...options,
    data: { path: chat.groupId ? `/app/g/${chat.groupId}` : `/app/${chat.botId}` },
  });
}
