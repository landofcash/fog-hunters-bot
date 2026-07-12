import "dotenv/config";
import { Events } from "discord.js";
import { ApiClient } from "./api/client";
import { loadConfig } from "./config";
import { createDiscordClient } from "./discord/client";
import { handleGuildCreateEvent } from "./events/guild-create";
import { handleInteractionCreateEvent } from "./events/interaction-create";
import { handleMessageCreateEvent } from "./events/message-create";
import { handleReadyEvent } from "./events/ready";
import { createLogger } from "./logger";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const apiClient = new ApiClient(config, logger);
  const client = createDiscordClient();

  client.once(Events.ClientReady, async (readyClient) => {
    await handleReadyEvent({
      client: readyClient,
      config,
      apiClient,
      logger,
    });
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      await handleGuildCreateEvent({
        guild,
        apiClient,
        config,
        logger,
      });
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Guild bootstrap failed");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteractionCreateEvent({
      interaction,
      apiClient,
      logger,
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    await handleMessageCreateEvent({
      message,
      apiClient,
      logger,
    });
  });

  await client.login(config.discordBotToken);

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down Discord bot");
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
