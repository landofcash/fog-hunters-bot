import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("audit logging", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("writes audit logs for admin mutations", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-audit", "Guild Audit");
    const admin = await createAuthenticatedAgent(app, "discord_admin");
    repo.seedMembership({ guildId: guild.id, userId: admin.userId, tenantRole: "ADMIN" });

    const response = await admin.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/features/moderation`)
      .set("x-csrf-token", admin.csrfToken)
      .send({
        enabled: true,
        config: { threshold: 3 },
      });

    expect(response.status).toBe(200);
    expect(response.body.auditLogId).toBeTruthy();

    const logs = await admin.agent.get(`/api/v1/guilds/${guild.discordGuildId}/audit-logs`);
    expect(logs.status).toBe(200);
    expect(logs.body.items).toHaveLength(1);
    expect(logs.body.items[0].action).toBe("feature.updated");
  });

  it("records prompt hashes and lengths without raw prompt text", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-prompt-audit", "Guild Prompt Audit");
    const admin = await createAuthenticatedAgent(app, "discord_prompt_admin");
    repo.seedMembership({ guildId: guild.id, userId: admin.userId, tenantRole: "ADMIN" });
    const assistantPrompt = "Assistant secret instructions";
    const gatekeeperPrompt = "Gatekeeper secret rules";

    const response = await admin.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/llm/settings`)
      .set("x-csrf-token", admin.csrfToken)
      .send({ assistantPrompt, gatekeeperPrompt });

    expect(response.status).toBe(200);
    const audit = repo.auditLogs.at(-1);
    expect(audit?.after).toMatchObject({
      assistantPrompt: {
        configured: true,
        length: assistantPrompt.length,
        sha256: createHash("sha256").update(assistantPrompt).digest("hex"),
      },
      gatekeeperPrompt: {
        configured: true,
        length: gatekeeperPrompt.length,
        sha256: createHash("sha256").update(gatekeeperPrompt).digest("hex"),
      },
    });
    expect(JSON.stringify(audit)).not.toContain(assistantPrompt);
    expect(JSON.stringify(audit)).not.toContain(gatekeeperPrompt);
  });
});
