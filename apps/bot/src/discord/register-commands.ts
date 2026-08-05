import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { createHash } from "node:crypto";
import type { Logger } from "pino";
import type { ApiClient } from "../api/client";

export const commandDefinitions = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency and availability."),
  new SlashCommandBuilder().setName("help").setDescription("Show available commands."),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Guild settings commands")
    .addSubcommand((sub) => sub.setName("view").setDescription("View guild bot settings"))
    .addSubcommandGroup((group) =>
      group
        .setName("admin")
        .setDescription("Manage FHAIBot admins")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Add an FHAIBot admin")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("Server member to add")
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Remove an FHAIBot admin")
            .addUserOption((option) =>
              option
                .setName("user")
                .setDescription("Server member to remove")
                .setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("List the server owner and FHAIBot admins"),
        ),
    ),
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("AI chat administration commands")
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("View AI settings for this server"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Enable AI responses in a channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Target channel")
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName("mention_only")
            .setDescription("Only respond when the bot is mentioned"),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Disable AI responses in a channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Target channel")
            .setRequired(true),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("prompt")
        .setDescription("Manage this server's AI prompts")
        .addSubcommand((sub) =>
          sub
            .setName("view")
            .setDescription("View effective prompts")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Prompt type; omit to view both")
                .addChoices(
                  { name: "assistant", value: "assistant" },
                  { name: "gatekeeper", value: "gatekeeper" },
                ),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("set")
            .setDescription("Set a prompt override")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Prompt type")
                .setRequired(true)
                .addChoices(
                  { name: "assistant", value: "assistant" },
                  { name: "gatekeeper", value: "gatekeeper" },
                ),
            )
            .addStringOption((option) =>
              option
                .setName("text")
                .setDescription("Prompt text (maximum 6,000 characters)")
                .setRequired(true)
                .setMaxLength(6_000),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("reset")
            .setDescription("Reset a prompt to its default")
            .addStringOption((option) =>
              option
                .setName("type")
                .setDescription("Prompt type")
                .setRequired(true)
                .addChoices(
                  { name: "assistant", value: "assistant" },
                  { name: "gatekeeper", value: "gatekeeper" },
                ),
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("retention")
        .setDescription("Set memory retention period in days")
        .addIntegerOption((option) =>
          option
            .setName("days")
            .setDescription("Retention window in days")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(3650),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("memory-clear")
        .setDescription("Clear AI memory for a channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Target channel")
            .setRequired(true),
        ),
    ),
].map((command) => command.toJSON());

export const commandManifestHash = createHash("sha256")
  .update(JSON.stringify(commandDefinitions))
  .digest("hex");

export async function registerGuildCommands(input: {
  botToken: string;
  clientId: string;
  guildId: string;
  logger: Logger;
}): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(input.botToken);
  await rest.put(
    Routes.applicationGuildCommands(input.clientId, input.guildId),
    { body: commandDefinitions },
  );
  input.logger.info({ guildId: input.guildId }, "Guild slash commands synchronized");
}

export async function synchronizeGuildCommands(input: {
  apiClient: ApiClient;
  botToken: string;
  clientId: string;
  guildId: string;
  previousHash?: string | null;
  previousErrorCode?: string | null;
  canPerformDiscordSideEffects: () => boolean;
  logger: Logger;
}): Promise<boolean> {
  if (
    input.previousHash === commandManifestHash &&
    !input.previousErrorCode
  ) {
    input.logger.debug(
      { guildId: input.guildId, commandManifestHash },
      "Guild command manifest already current",
    );
    return false;
  }

  if (!input.canPerformDiscordSideEffects()) {
    input.logger.warn(
      { guildId: input.guildId },
      "Guild command synchronization skipped because Discord side effects are fenced",
    );
    return false;
  }

  try {
    await registerGuildCommands(input);
    await input.apiClient.reportCommandManifest({
      guildId: input.guildId,
      hash: commandManifestHash,
      errorCode: null,
      syncedAt: new Date(),
    });
    return true;
  } catch (error) {
    await input.apiClient.reportCommandManifest({
      guildId: input.guildId,
      errorCode: "COMMAND_SYNC_FAILED",
    }).catch((reportError) => {
      input.logger.warn(
        { err: reportError, guildId: input.guildId },
        "Failed to report command synchronization error",
      );
    });
    throw error;
  }
}
