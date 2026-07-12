import { REST, Routes, SlashCommandBuilder } from "discord.js";
import type { Logger } from "pino";

export const commandDefinitions = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot latency and availability."),
  new SlashCommandBuilder().setName("help").setDescription("Show available commands."),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Guild settings commands")
    .addSubcommand((sub) => sub.setName("view").setDescription("View guild bot settings")),
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
    .addSubcommand((sub) =>
      sub
        .setName("style")
        .setDescription("Set AI response style")
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Style mode")
            .setRequired(true)
            .addChoices(
              { name: "casual", value: "casual" },
              { name: "strict", value: "strict" },
              { name: "custom", value: "custom" },
            ),
        )
        .addStringOption((option) =>
          option
            .setName("prompt")
            .setDescription("Custom style prompt (required for custom mode)"),
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
