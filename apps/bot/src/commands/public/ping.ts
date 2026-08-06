import type { ChatInputCommandInteraction } from "discord.js";
import { APP_VERSION } from "../../lib/app-version";

export async function handlePingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const latencyMs = Date.now() - interaction.createdTimestamp;
  await interaction.reply({
    content: `Pong! ${latencyMs}ms · v${APP_VERSION}`,
  });
}
