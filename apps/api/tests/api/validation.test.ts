import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedAgent, createTestApp } from "../helpers/test-app";

describe("validation and error behavior", () => {
  let closeApp: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeApp) await closeApp();
    closeApp = undefined;
  });

  it("returns 404 for unknown guild", async () => {
    const { app } = await createTestApp();
    closeApp = () => app.close();

    const user = await createAuthenticatedAgent(app, "discord_user_404");
    const response = await user.agent.get("/api/v1/guilds/missing/settings");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("GUILD_NOT_FOUND");
  });

  it("returns 400 for invalid payload", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-validation", "Guild Validation");
    const admin = await createAuthenticatedAgent(app, "discord_admin_validation");
    repo.seedMembership({ guildId: guild.id, userId: admin.userId, tenantRole: "ADMIN" });

    const response = await admin.agent
      .patch(`/api/v1/guilds/${guild.discordGuildId}/commands/purge`)
      .set("x-csrf-token", admin.csrfToken)
      .send({
        minRole: "NOT_A_ROLE",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts 32,000-character prompts and rejects larger or blank prompts", async () => {
    const { app, repo } = await createTestApp();
    closeApp = () => app.close();
    const guild = repo.seedGuild("guild-prompt-validation", "Prompt Validation");
    const admin = await createAuthenticatedAgent(app, "discord_prompt_validation");
    repo.seedMembership({ guildId: guild.id, userId: admin.userId, tenantRole: "ADMIN" });
    const route = `/api/v1/guilds/${guild.discordGuildId}/llm/settings`;

    const accepted = await admin.agent
      .patch(route)
      .set("x-csrf-token", admin.csrfToken)
      .send({ assistantPrompt: "x".repeat(32_000) });
    expect(accepted.status).toBe(200);

    for (const assistantPrompt of ["x".repeat(32_001), "   "]) {
      const rejected = await admin.agent
        .patch(route)
        .set("x-csrf-token", admin.csrfToken)
        .send({ assistantPrompt });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
