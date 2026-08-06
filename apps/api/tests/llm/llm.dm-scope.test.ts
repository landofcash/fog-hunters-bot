import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/lib/config";
import { LlmService } from "../../src/modules/llm/llm.service";
import type { LlmProvider } from "../../src/modules/llm/providers/types";
import type { AppRepository } from "../../src/repositories/types";

function createLoggerMock(): FastifyBaseLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

describe("LlmService DM scope", () => {
  it("allows a Discord DM channel ID without selecting a guild installation", async () => {
    const getEffectiveBotSettings = vi.fn().mockResolvedValue({
      dmEnabled: false,
    });
    const provider: LlmProvider = {
      generateChat: vi.fn(),
    };
    const service = new LlmService(
      loadConfig({ NODE_ENV: "test", LLM_ENABLED: "true" }),
      { getEffectiveBotSettings } as unknown as AppRepository,
      createLoggerMock(),
      provider,
    );

    await expect(service.respondToMessage({
      botInstanceId: "bot-1",
      channelId: "dm-channel-1",
      discordUserId: "user-1",
      content: "Hello",
      isDm: true,
      botWasMentioned: false,
    })).resolves.toEqual({
      shouldRespond: false,
      reason: "DM_DISABLED",
    });
    expect(getEffectiveBotSettings).toHaveBeenCalledWith({
      botInstanceId: "bot-1",
    });
  });

  it("still rejects guild context on a DM request", async () => {
    const getEffectiveBotSettings = vi.fn();
    const service = new LlmService(
      loadConfig({ NODE_ENV: "test", LLM_ENABLED: "true" }),
      { getEffectiveBotSettings } as unknown as AppRepository,
      createLoggerMock(),
      { generateChat: vi.fn() },
    );

    await expect(service.respondToMessage({
      botInstanceId: "bot-1",
      guildId: "guild-1",
      channelId: "dm-channel-1",
      discordUserId: "user-1",
      content: "Hello",
      isDm: true,
      botWasMentioned: false,
    })).rejects.toMatchObject({
      code: "LLM_SCOPE_INVALID",
    });
    expect(getEffectiveBotSettings).not.toHaveBeenCalled();
  });
});
