import type { ChatInputCommandInteraction } from "discord.js";

export async function handlePingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const latencyMs = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `Pong! ${latencyMs}ms`,
  });
}
