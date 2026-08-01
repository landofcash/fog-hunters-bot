import { MessageFlags, type ChatInputCommandInteraction, type User } from "discord.js";
import type { ApiClient } from "../../api/client";
import { ApiClientError } from "../../runtime/errors";

function targetProfile(user: User) {
  return {
    discordUserId: user.id,
    username: user.username,
    globalName: user.globalName ?? null,
    avatarUrl: user.displayAvatarURL() ?? null,
  };
}

function mention(discordUserId: string): string {
  return `<@${discordUserId}>`;
}

async function handleList(apiClient: ApiClient, interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await apiClient.listGuildAdmins({
    guildId: interaction.guildId as string,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
  });
  const owners = result.owners.map((member) => mention(member.discordUserId));
  const visibleAdmins = result.admins.slice(0, 50).map((member) => `- ${mention(member.discordUserId)}`);
  const hiddenAdminCount = result.admins.length - visibleAdmins.length;
  const lines = [
    `Owner${owners.length === 1 ? "" : "s"}: ${owners.join(", ") || "not recorded"}`,
    "",
    `Admins (${result.admins.length}):`,
    ...(visibleAdmins.length > 0 ? visibleAdmins : ["- No additional admins"]),
  ];
  if (hiddenAdminCount > 0) {
    lines.push(`- …and ${hiddenAdminCount} more`);
  }

  await interaction.editReply({
    content: lines.join("\n"),
    allowedMentions: { users: [] },
  });
}

async function handleAddOrRemove(
  apiClient: ApiClient,
  interaction: ChatInputCommandInteraction,
  action: "add" | "remove",
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Bot accounts cannot be FHAIBot admins.",
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const request = {
    guildId: interaction.guildId as string,
    actorDiscordUserId: interaction.user.id,
    channelId: interaction.channelId ?? undefined,
    target: targetProfile(user),
  };
  const result = action === "add"
    ? await apiClient.addGuildAdmin(request)
    : await apiClient.removeGuildAdmin(request);

  let content: string;
  if (action === "add") {
    content = result.changed
      ? `Added ${mention(user.id)} as an FHAIBot admin.`
      : result.reason === "OWNER_ALREADY_PRIVILEGED"
        ? `${mention(user.id)} is the server owner and already has administrative access.`
        : `${mention(user.id)} is already an FHAIBot admin.`;
  } else {
    content = result.changed
      ? `Removed ${mention(user.id)} as an FHAIBot admin.`
      : `${mention(user.id)} is not an FHAIBot admin.`;
  }

  await interaction.editReply({
    content,
    allowedMentions: { users: [] },
  });
}

export async function handleSettingsAdminCommand(
  apiClient: ApiClient,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Admin management can only be used in a server.",
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);
  try {
    if (subcommand === "list") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await handleList(apiClient, interaction);
      return;
    }
    if (subcommand === "add" || subcommand === "remove") {
      await handleAddOrRemove(apiClient, interaction, subcommand);
      return;
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "Unsupported admin command.",
    });
  } catch (error) {
    const content =
      error instanceof ApiClientError && error.statusCode === 403
        ? subcommand === "list"
          ? "Only FHAIBot admins can list this server's admins."
          : "Only the server owner can add or remove FHAIBot admins."
        : error instanceof ApiClientError && error.code === "OWNER_PROTECTED"
          ? "The server owner cannot be removed as an FHAIBot admin."
          : error instanceof ApiClientError && error.statusCode === 404
            ? "This server is not onboarded yet. Re-invite or restart the bot."
            : "Failed to manage FHAIBot admins right now. Try again in a moment.";

    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content });
    }
  }
}
