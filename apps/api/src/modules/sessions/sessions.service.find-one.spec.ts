import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestUserStore } from "../../common/request-user.store.js";
import { SessionsService } from "./sessions.service.js";

function build(projectUserId: string) {
  const prisma = {
    session: {
      findFirst: async () => ({
        id: "s1",
        userId: "u-session",
        projectId: "p1",
        project: { id: "p1", userId: projectUserId, visibility: "SHARED", convergeWebhookSecret: "whsec_123" },
      }),
    },
  } as never;
  const noop = {} as never;
  return new SessionsService(prisma, noop, noop, noop, noop, noop);
}

describe("SessionsService.findOne: convergeWebhookSecret solo para el dueño", () => {
  it("el dueño del proyecto recibe el secreto", async () => {
    const svc = build("u-owner");
    const res = await requestUserStore.run({ userId: "u-owner", role: "developer" }, () => svc.findOne("s1"));
    assert.equal(res.project.convergeWebhookSecret, "whsec_123");
  });

  it("un colaborador SHARED recibe null en lugar del secreto", async () => {
    const svc = build("u-owner");
    const res = await requestUserStore.run({ userId: "u-other", role: "developer" }, () => svc.findOne("s1"));
    assert.equal(res.project.convergeWebhookSecret, null);
    assert.equal(res.project.id, "p1");
  });
});
