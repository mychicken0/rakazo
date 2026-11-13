import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const owner: Actor = {
  userId: "user-one",
  spaceId: "space-one",
  email: "one@rakazo.test",
  isDeploymentOwner: true,
};

function setup() {
  const updateMany = vi.fn(async ({ where }: { where: { id: string; userId: string } }) => ({
    count: where.id === "credential-one" && where.userId === owner.userId ? 1 : 0,
  }));
  const prisma = { userModelCredential: { updateMany } } as unknown as PrismaClient;
  const handler = new RPCHandler(createRouter({ prisma } as unknown as RouterDeps));
  const call = async (input: unknown) => {
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/models/setShownModels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor: owner } },
    );
    if (!response) throw new Error("no response");
    return response;
  };
  return { call, updateMany };
}

describe("models.setShownModels", () => {
  it("saves a deduplicated list on the actor's own connection only", async () => {
    const { call, updateMany } = setup();
    const response = await call({ credentialId: "credential-one", modelIds: ["a", "b", "a"] });
    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "credential-one", userId: owner.userId },
      data: { shownModelIds: ["a", "b"] },
    });
  });

  it("does not find another member's connection", async () => {
    const { call } = setup();
    const response = await call({ credentialId: "credential-other", modelIds: ["a"] });
    expect(response.status).toBe(404);
  });
});
