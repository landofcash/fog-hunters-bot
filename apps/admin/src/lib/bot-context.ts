import type { BotInstallation, GuildBotListItem } from "@/api/types";

export function guildBotSelectionKey(guildId: string): string {
  return `fhaibot:last-bot:${guildId}`;
}

export function selectGuildBotId(
  items: GuildBotListItem[],
  rememberedBotId?: string | null,
): string | undefined {
  return (
    items.find(({ bot }) => bot.id === rememberedBotId)?.bot.id ??
    items[0]?.bot.id
  );
}

export function isInstallationReadOnly(
  installation?: Pick<BotInstallation, "presenceStatus">,
): boolean {
  return installation?.presenceStatus !== "PRESENT";
}

export function botContextQueryKey(
  guildId: string,
  botId: string,
  resource: string,
): readonly string[] {
  return ["guild", guildId, "bot", botId, resource] as const;
}
