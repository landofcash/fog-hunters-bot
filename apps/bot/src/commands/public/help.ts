import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

export async function handleHelpCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: [
      "Available commands:",
      "- `/ping` public health check",
      "- `/help` command list",
      "- `/settings view` admin settings summary",
      "- `/settings admin ...` owner-managed FHAIBot admins",
      "- `/ai ...` AI chat administration",
    ].join("\n"),
  });
}
