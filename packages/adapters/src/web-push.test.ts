import type { AdapterContext, NotificationMessage } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { CallPushDevice } from "./push-token-store.js";
import {
  isPushServiceEndpoint,
  WebPushSender,
  webPushKeysFromEnv,
  webPushPayload,
} from "./web-push.js";

const KEYS = {
  publicKey: "public-test",
  privateKey: "private-test",
  subject: "mailto:test@example.test",
};
const context: AdapterContext = {
  operationId: "notify",
  traceId: "bot-1",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};
const message: NotificationMessage = {
  kind: "completion",
  title: "Chief",
  body: "Done",
  botId: "bot-1",
  threadId: "thread-1",
};
const browser = (endpoint: string, deviceId = "device-1"): CallPushDevice => ({
  deviceId,
  platform: "web",
  webPush: { endpoint, p256dh: "p256dh-test", auth: "auth-test" },
  userId: "user-1",
  sessionId: "session-1",
  revision: `rev-${deviceId}`,
});

function sender(devices: CallPushDevice[], send = vi.fn(async () => ({}))) {
  const tokens = {
    devices: vi.fn(async () => devices),
    removeDevice: vi.fn(async () => undefined),
  };
  return { tokens, send, web: new WebPushSender(tokens, KEYS, send) };
}

describe("web push", () => {
  it("only accepts the browsers' push services as endpoints", () => {
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(
      true,
    );
    expect(isPushServiceEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushServiceEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com.evil.test/x")).toBe(false);
    expect(isPushServiceEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
  });

  it("is off without both keys", () => {
    expect(webPushKeysFromEnv({ WEB_PUSH_PUBLIC_KEY: "a" })).toBeUndefined();
    expect(
      webPushKeysFromEnv({ WEB_PUSH_PUBLIC_KEY: "a", WEB_PUSH_PRIVATE_KEY: "b" }),
    ).toMatchObject({
      publicKey: "a",
      privateKey: "b",
    });
  });

  it("opens the group chat for a group reply and the bot's chat otherwise", () => {
    expect(webPushPayload(message, "space-1")).toMatchObject({
      title: "Chief",
      body: "Done",
      tag: "thread-1:completion",
      path: "/app/bot-1",
    });
    expect(webPushPayload({ ...message, groupId: "group-1" }, "space-1").path).toBe(
      "/app/g/group-1",
    );
    expect(webPushPayload({ ...message, body: "x".repeat(500) }, "").body).toHaveLength(180);
  });

  it("pushes to each subscribed browser and skips app-only devices", async () => {
    const appOnly = { ...browser("https://fcm.googleapis.com/fcm/send/a"), webPush: undefined };
    const { web, send } = sender([browser("https://fcm.googleapis.com/fcm/send/b"), appOnly]);
    await expect(web.send(message, context)).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const [subscription, payload, options] = send.mock.calls[0] as unknown as [
      { endpoint: string; keys: unknown },
      string,
      { urgency: string; vapidDetails: unknown },
    ];
    expect(subscription).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/b",
      keys: { p256dh: "p256dh-test", auth: "auth-test" },
    });
    expect(JSON.parse(payload).path).toBe("/app/bot-1");
    expect(options).toMatchObject({ urgency: "normal", vapidDetails: KEYS });
  });

  it("never calls an endpoint outside the push services", async () => {
    const { web, send } = sender([browser("https://internal.example.test/hook")]);
    await expect(web.send(message, context)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("forgets a browser whose subscription is gone, and keeps one that failed for a while", async () => {
    const send = vi.fn(async (subscription: { endpoint: string }) => {
      throw Object.assign(new Error("push failed"), {
        statusCode: subscription.endpoint.endsWith("gone") ? 410 : 503,
      });
    });
    const { web, tokens } = sender(
      [
        browser("https://fcm.googleapis.com/fcm/send/gone", "device-gone"),
        browser("https://fcm.googleapis.com/fcm/send/busy", "device-busy"),
      ],
      send as never,
    );
    await expect(web.send(message, context)).resolves.toBe(false);
    expect(tokens.removeDevice).toHaveBeenCalledOnce();
    expect(tokens.removeDevice).toHaveBeenCalledWith(
      "user-1",
      "device-gone",
      "rev-device-gone",
      "web",
    );
  });

  it("marks questions and failures urgent", async () => {
    const { web, send } = sender([browser("https://fcm.googleapis.com/fcm/send/b")]);
    await web.send({ ...message, kind: "help" }, context);
    expect(
      (send.mock.calls[0] as unknown as [unknown, unknown, { urgency: string }])[2].urgency,
    ).toBe("high");
  });
});
