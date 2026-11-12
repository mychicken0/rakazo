import type { AdapterContext, NotificationMessage } from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import type { CallPushDevice, PushTokenStore, WebPushSubscription } from "./push-token-store.js";

const MAX_TITLE_CHARS = 100;
const MAX_BODY_CHARS = 180;
/** A reply that waits longer than a day is old news. */
const TTL_SECONDS = 24 * 60 * 60;
const SEND_TIMEOUT_MS = 15_000;

/**
 * The browsers' push services. The endpoint comes from the browser, so nothing else is ever
 * called with the server's signing key: an arbitrary URL would turn delivery into a request
 * to wherever the client pointed it.
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export type WebPushKeys = { publicKey: string; privateKey: string; subject: string };

/** Signing keys from the environment; web push is off without both halves. */
export function webPushKeysFromEnv(env: NodeJS.ProcessEnv = process.env): WebPushKeys | undefined {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return undefined;
  const subject = env.WEB_PUSH_SUBJECT?.trim() || env.WEB_URL?.trim() || "mailto:admin@localhost";
  return { publicKey, privateKey, subject };
}

/** What the service worker shows, and where a tap goes. */
export function webPushPayload(message: NotificationMessage, spaceId: string) {
  const capped = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return {
    title: capped(message.title, MAX_TITLE_CHARS),
    body: capped(message.body, MAX_BODY_CHARS),
    // The same tag the open page uses, so a page alert and a push for one reply show once.
    tag: `${message.threadId}:${message.kind}`,
    path: message.groupId ? `/app/g/${message.groupId}` : `/app/${message.botId}`,
    kind: message.kind,
    botId: message.botId,
    threadId: message.threadId,
    ...(message.groupId ? { groupId: message.groupId } : {}),
    ...(spaceId ? { spaceId } : {}),
    ...(message.badge === undefined ? {} : { badge: message.badge }),
  };
}

type SendNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    urgency: "normal" | "high";
    timeout: number;
  },
) => Promise<unknown>;

/** Pushes to the browsers a person turned notifications on in, each from its own session. */
export class WebPushSender {
  private sendNotification?: Promise<SendNotification>;

  constructor(
    private readonly tokens: Pick<PushTokenStore, "devices" | "removeDevice">,
    private readonly keys: WebPushKeys,
    send?: SendNotification,
  ) {
    if (send) this.sendNotification = Promise.resolve(send);
  }

  get publicKey(): string {
    return this.keys.publicKey;
  }

  private load(): Promise<SendNotification> {
    // Only deployments with web push configured load the library.
    this.sendNotification ??= import("web-push").then(
      (module) => (module.default ?? module).sendNotification as SendNotification,
    );
    return this.sendNotification;
  }

  async hasRecipient(userId: string): Promise<boolean> {
    return (await this.browsers(userId)).length > 0;
  }

  private async browsers(userId: string) {
    const devices = (await this.tokens.devices?.(userId)) ?? [];
    return devices.filter((device): device is CallPushDevice & { webPush: WebPushSubscription } =>
      Boolean(device.webPush && isPushServiceEndpoint(device.webPush.endpoint)),
    );
  }

  /** True when at least one browser accepted the push. */
  async send(message: NotificationMessage, context: AdapterContext): Promise<boolean> {
    const browsers = await this.browsers(context.userId);
    if (!browsers.length) return false;
    const send = await this.load();
    const payload = JSON.stringify(webPushPayload(message, context.spaceId));
    const urgent =
      message.kind === "help" || message.kind === "takeover" || message.kind === "failure";
    const results = await Promise.all(
      browsers.map(async (device) => {
        try {
          await send(
            {
              endpoint: device.webPush.endpoint,
              keys: { p256dh: device.webPush.p256dh, auth: device.webPush.auth },
            },
            payload,
            {
              vapidDetails: this.keys,
              TTL: TTL_SECONDS,
              urgency: urgent ? "high" : "normal",
              timeout: SEND_TIMEOUT_MS,
            },
          );
          return true;
        } catch (error) {
          const status = (error as { statusCode?: unknown }).statusCode;
          // The browser unsubscribed or the subscription expired: it will never deliver again.
          if (status === 404 || status === 410) {
            await this.tokens
              .removeDevice?.(context.userId, device.deviceId, device.revision, "web")
              .catch((cause) => getLogger().error("web push removal", cause));
          } else {
            getLogger().warn("web push delivery failed", { status });
          }
          return false;
        }
      }),
    );
    return results.some(Boolean);
  }
}

export function createWebPushSender(
  tokens: Pick<PushTokenStore, "devices" | "removeDevice">,
  env: NodeJS.ProcessEnv = process.env,
): WebPushSender | undefined {
  const keys = webPushKeysFromEnv(env);
  return keys ? new WebPushSender(tokens, keys) : undefined;
}
