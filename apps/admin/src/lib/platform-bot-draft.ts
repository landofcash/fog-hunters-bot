import type { BotProfile, BotSummary } from "@/api/types";

export type BotProfileDraft = Omit<
  BotProfile,
  "id" | "botInstanceId" | "settingsVersion"
>;

export interface PlatformBotDraft {
  botId: string;
  displayName: string;
  displayNameDirty: boolean;
  profile: BotProfileDraft;
  profileDirty: boolean;
}

export function toBotProfileDraft(profile: BotProfile): BotProfileDraft {
  return {
    defaultModel: profile.defaultModel,
    assistantPrompt: profile.assistantPrompt ?? null,
    gatekeeperPrompt: profile.gatekeeperPrompt ?? null,
    dmEnabled: profile.dmEnabled,
    retentionDays: profile.retentionDays,
    maxInputChars: profile.maxInputChars,
    maxOutputTokens: profile.maxOutputTokens,
  };
}

export function botProfileDraftEquals(
  draft: BotProfileDraft,
  profile: BotProfile,
): boolean {
  return (
    draft.defaultModel === profile.defaultModel
    && (draft.assistantPrompt ?? null) === (profile.assistantPrompt ?? null)
    && (draft.gatekeeperPrompt ?? null) === (profile.gatekeeperPrompt ?? null)
    && draft.dmEnabled === profile.dmEnabled
    && draft.retentionDays === profile.retentionDays
    && draft.maxInputChars === profile.maxInputChars
    && draft.maxOutputTokens === profile.maxOutputTokens
  );
}

export function reconcilePlatformBotDraft(
  current: PlatformBotDraft,
  detail: { bot: BotSummary; profile: BotProfile },
): PlatformBotDraft {
  if (current.botId !== detail.bot.id) {
    return {
      botId: detail.bot.id,
      displayName: detail.bot.displayName,
      displayNameDirty: false,
      profile: toBotProfileDraft(detail.profile),
      profileDirty: false,
    };
  }

  const displayNameDirty =
    current.displayNameDirty
    && current.displayName !== detail.bot.displayName;
  const profileDirty =
    current.profileDirty
    && !botProfileDraftEquals(current.profile, detail.profile);

  const next = {
    ...current,
    displayName: displayNameDirty
      ? current.displayName
      : detail.bot.displayName,
    displayNameDirty,
    profile: profileDirty
      ? current.profile
      : toBotProfileDraft(detail.profile),
    profileDirty,
  };

  if (
    next.displayName === current.displayName
    && next.displayNameDirty === current.displayNameDirty
    && next.profileDirty === current.profileDirty
    && (
      next.profile === current.profile
      || botProfileDraftEquals(current.profile, detail.profile)
    )
  ) {
    return current;
  }
  return next;
}
