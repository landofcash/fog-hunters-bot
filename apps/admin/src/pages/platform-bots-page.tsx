import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import type { BotInstallation } from "@/api/types";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LLM_PROMPT_MAX_LENGTH } from "@/lib/llm-limits";
import {
  botProfileDraftEquals,
  reconcilePlatformBotDraft,
  toBotProfileDraft,
  type BotProfileDraft,
  type PlatformBotDraft,
} from "@/lib/platform-bot-draft";

const emptyProfile: BotProfileDraft = {
  defaultModel: "gpt-4.1-mini",
  assistantPrompt: null,
  gatekeeperPrompt: null,
  dmEnabled: false,
  retentionDays: 30,
  maxInputChars: 4_000,
  maxOutputTokens: 512,
};

function InstallationPolicyRow({
  botId,
  installation,
}: {
  botId: string;
  installation: BotInstallation;
}) {
  const [modelOverride, setModelOverride] = useState("");
  const detail = useQuery({
    queryKey: ["platform", "bots", botId, "installations", installation.id],
    queryFn: () => api.botInstallation(botId, installation.id),
  });

  useEffect(() => {
    setModelOverride(detail.data?.settings.modelOverride ?? "");
  }, [detail.data?.settings.modelOverride]);

  const updatePolicy = useMutation({
    mutationFn: (
      body: Parameters<typeof api.updatePlatformPolicy>[2],
    ) => api.updatePlatformPolicy(botId, installation.id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["platform", "bots", botId, "installations", installation.id],
      });
      toast.success("Platform installation policy saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const requestCommandResync = useMutation({
    mutationFn: () => api.requestCommandResync(botId, installation.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["platform", "bots", botId, "installations"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["platform", "bots", botId, "installations", installation.id],
        }),
      ]);
      toast.success("Command resynchronization requested");
    },
    onError: (error) => toast.error(error.message),
  });

  const readOnly = installation.presenceStatus !== "PRESENT";
  return (
    <div className="space-y-3 rounded-lg border border-white/8 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-200">{installation.guildName}</p>
          <p className="font-mono text-[11px] text-slate-600">{installation.guildDiscordId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={installation.presenceStatus === "PRESENT" ? "default" : "secondary"}>
            Presence {installation.presenceStatus}
          </Badge>
          <Badge variant={installation.operationalStatus === "ENABLED" ? "outline" : "destructive"}>
            Operations {installation.operationalStatus}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={readOnly || requestCommandResync.isPending}
            onClick={() => requestCommandResync.mutate()}
          >
            <RefreshCw className="size-3.5" />
            Resync commands
          </Button>
        </div>
      </div>
      {detail.error ? <p className="text-xs text-red-300">{detail.error.message}</p> : null}
      {detail.data ? (
        <div className="grid gap-3 border-t border-white/8 pt-3 md:grid-cols-[auto_1fr_auto] md:items-end">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <Switch
              checked={detail.data.settings.llmEnabledByPlatform}
              disabled={readOnly || updatePolicy.isPending}
              onCheckedChange={(llmEnabledByPlatform) =>
                updatePolicy.mutate({ llmEnabledByPlatform })
              }
            />
            Platform AI
          </label>
          <div className="grid gap-1">
            <Label>Platform model override</Label>
            <Input
              value={modelOverride}
              disabled={readOnly}
              placeholder={`Inherit ${detail.data.profile.defaultModel}`}
              onChange={(event) => setModelOverride(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={
              readOnly ||
              updatePolicy.isPending ||
              modelOverride === (detail.data.settings.modelOverride ?? "")
            }
            onClick={() =>
              updatePolicy.mutate({ modelOverride: modelOverride.trim() || null })
            }
          >
            Save policy
          </Button>
        </div>
      ) : null}
      {readOnly ? (
        <p className="text-xs text-slate-500">
          Left installations remain available for read-only inspection.
        </p>
      ) : null}
    </div>
  );
}

export function PlatformBotsPage() {
  const [selectedBotId, setSelectedBotId] = useState("");
  const [create, setCreate] = useState({ slug: "", displayName: "", discordApplicationId: "" });
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<PlatformBotDraft>({
    botId: "",
    displayName: "",
    displayNameDirty: false,
    profile: emptyProfile,
    profileDirty: false,
  });
  const selectBot = useCallback((botId: string) => {
    setToken("");
    setSelectedBotId(botId);
  }, []);

  const bots = useQuery({
    queryKey: ["platform", "bots"],
    queryFn: () => api.platformBots(),
  });
  const detail = useQuery({
    queryKey: ["platform", "bots", selectedBotId],
    queryFn: () => api.platformBot(selectedBotId),
    enabled: Boolean(selectedBotId),
    refetchInterval: 15_000,
  });
  const installations = useQuery({
    queryKey: ["platform", "bots", selectedBotId, "installations"],
    queryFn: () => api.botInstallations(selectedBotId),
    enabled: Boolean(selectedBotId),
  });
  const installUrl = useQuery({
    queryKey: ["platform", "bots", selectedBotId, "install-url"],
    queryFn: () => api.botInstallUrl(selectedBotId),
    enabled: Boolean(selectedBotId),
  });

  useEffect(() => {
    if (!selectedBotId && bots.data?.items[0]) {
      selectBot(bots.data.items[0].id);
    }
  }, [bots.data, selectBot, selectedBotId]);

  useEffect(() => {
    if (!detail.data) return;
    setDraft((current) => reconcilePlatformBotDraft(current, detail.data));
  }, [detail.data]);

  const refresh = async (botId = selectedBotId) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["platform", "bots"] }),
      queryClient.invalidateQueries({ queryKey: ["platform", "bots", botId] }),
    ]);
  };

  const createBot = useMutation({
    mutationFn: () => api.createBot(create),
    onSuccess: async ({ bot }) => {
      setCreate({ slug: "", displayName: "", discordApplicationId: "" });
      selectBot(bot.id);
      await refresh(bot.id);
      toast.success("Bot identity created");
    },
    onError: (error) => toast.error(error.message),
  });
  const saveProfile = useMutation({
    mutationFn: () => api.updateBotProfile(selectedBotId, draft.profile),
    onSuccess: async ({ profile }) => {
      setDraft((current) => current.botId === profile.botInstanceId
        ? {
            ...current,
            profile: toBotProfileDraft(profile),
            profileDirty: false,
          }
        : current);
      await refresh(profile.botInstanceId);
      toast.success("Bot profile saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const configureToken = useMutation({
    mutationFn: () => api.configureBotToken(selectedBotId, token),
    onSuccess: async () => {
      setToken("");
      await refresh();
      toast.success("Discord token encrypted and configured");
    },
    onError: (error) => toast.error(error.message),
  });
  const removeToken = useMutation({
    mutationFn: () => api.deleteBotToken(selectedBotId),
    onSuccess: async () => {
      await refresh();
      toast.success("Discord token removed");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateBot = useMutation({
    mutationFn: (body: Parameters<typeof api.updateBot>[1]) =>
      api.updateBot(selectedBotId, body),
    onSuccess: async ({ bot }, variables) => {
      if (variables.displayName !== undefined) {
        setDraft((current) => current.botId === bot.id
          ? {
              ...current,
              displayName: bot.displayName,
              displayNameDirty: false,
            }
          : current);
      }
      await refresh(bot.id);
      toast.success("Bot updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const selected = detail.data;
  const updateProfileDraft = (changes: Partial<BotProfileDraft>) => {
    const savedProfile = detail.data?.profile;
    setDraft((current) => {
      const profile = { ...current.profile, ...changes };
      return {
        ...current,
        profile,
        profileDirty: savedProfile
          ? !botProfileDraftEquals(profile, savedProfile)
          : true,
      };
    });
  };
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Platform control plane"
        title="Bot directory"
        description="Create Discord identities, configure write-only credentials, and inspect desired and observed runtime state."
      />
      {bots.error ? <ErrorState error={bots.error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="size-4" /> Create bot</CardTitle>
          <CardDescription>The Discord application ID is immutable after creation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1.3fr_1.3fr_auto]">
          <Input
            aria-label="Bot slug"
            placeholder="bot-slug"
            value={create.slug}
            onChange={(event) => setCreate({ ...create, slug: event.target.value })}
          />
          <Input
            aria-label="Bot display name"
            placeholder="Display name"
            value={create.displayName}
            onChange={(event) => setCreate({ ...create, displayName: event.target.value })}
          />
          <Input
            aria-label="Discord application ID"
            placeholder="Discord application ID"
            value={create.discordApplicationId}
            onChange={(event) => setCreate({ ...create, discordApplicationId: event.target.value })}
          />
          <Button
            disabled={!create.slug || !create.displayName || !create.discordApplicationId || createBot.isPending}
            onClick={() => createBot.mutate()}
          >
            Create
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <Card className="h-fit">
          <CardHeader><CardTitle>Identities</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {bots.data?.items.map((bot) => (
              <button
                key={bot.id}
                type="button"
                onClick={() => selectBot(bot.id)}
                className={`w-full rounded-lg border px-3 py-3 text-left ${
                  bot.id === selectedBotId
                    ? "border-emerald-300/25 bg-emerald-400/8"
                    : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{bot.displayName}</span>
                  <Badge variant={bot.desiredStatus === "ACTIVE" ? "default" : "secondary"}>
                    {bot.desiredStatus}
                  </Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-600">{bot.slug}</p>
              </button>
            ))}
            {!bots.isLoading && bots.data?.items.length === 0 ? (
              <EmptyState title="No bots yet" description="Create the first identity above." />
            ) : null}
          </CardContent>
        </Card>

        {selected ? (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{selected.bot.displayName}</CardTitle>
                    <CardDescription>{selected.bot.discordApplicationId}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={selected.bot.tokenConfigured ? "default" : "destructive"}>
                      Token {selected.bot.tokenConfigured ? `v${selected.bot.tokenVersion}` : "missing"}
                    </Badge>
                    <Badge variant={selected.runtime.runtimeState === "READY" ? "default" : "secondary"}>
                      Runtime {selected.runtime.runtimeState}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant={selected.bot.desiredStatus === "ACTIVE" ? "destructive" : "default"}
                    disabled={!selected.bot.tokenConfigured || updateBot.isPending}
                    onClick={() =>
                      updateBot.mutate({
                        desiredStatus: selected.bot.desiredStatus === "ACTIVE" ? "DISABLED" : "ACTIVE",
                      })
                    }
                  >
                    <Power className="size-4" />
                    {selected.bot.desiredStatus === "ACTIVE" ? "Disable" : "Activate"}
                  </Button>
                  {installUrl.data?.url ? (
                    <Button asChild variant="outline">
                      <a href={installUrl.data.url} target="_blank" rel="noreferrer">
                        Install in Discord <ExternalLink className="size-4" />
                      </a>
                    </Button>
                  ) : null}
                  <span className="text-xs text-slate-500">
                    Desired state and observed runtime state are intentionally separate.
                  </span>
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Input
                    aria-label="Bot display name"
                    disabled={updateBot.isPending}
                    value={draft.displayName}
                    onChange={(event) => {
                      const displayName = event.target.value;
                      setDraft((current) => ({
                        ...current,
                        displayName,
                        displayNameDirty:
                          displayName !== selected.bot.displayName,
                      }));
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={
                      !draft.displayName.trim() ||
                      !draft.displayNameDirty ||
                      updateBot.isPending
                    }
                    onClick={() =>
                      updateBot.mutate({ displayName: draft.displayName.trim() })
                    }
                  >
                    <Save className="size-4" />
                    Save name
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    aria-label="New Discord bot token"
                    placeholder="Enter a new Discord token"
                    disabled={configureToken.isPending}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <Button
                    disabled={token.length < 20 || configureToken.isPending}
                    onClick={() => configureToken.mutate()}
                  >
                    <KeyRound className="size-4" /> Configure
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={!selected.bot.tokenConfigured || removeToken.isPending}
                    onClick={() => removeToken.mutate()}
                  >
                    <Trash2 className="size-4" /> Remove
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Existing token values are never returned or displayed.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Bot profile</CardTitle></CardHeader>
              <CardContent>
                <fieldset disabled={saveProfile.isPending} className="space-y-5 border-0 p-0">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>Default model</Label>
                      <Input value={draft.profile.defaultModel} onChange={(event) => updateProfileDraft({ defaultModel: event.target.value })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Retention days</Label>
                      <Input type="number" value={draft.profile.retentionDays} onChange={(event) => updateProfileDraft({ retentionDays: Number(event.target.value) })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>DM responses</Label>
                      <div className="flex h-9 items-center"><Switch checked={draft.profile.dmEnabled} onCheckedChange={(dmEnabled) => updateProfileDraft({ dmEnabled })} /></div>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Assistant prompt</Label>
                      <Textarea
                        maxLength={LLM_PROMPT_MAX_LENGTH}
                        value={draft.profile.assistantPrompt ?? ""}
                        onChange={(event) => updateProfileDraft({
                          assistantPrompt: event.target.value || null,
                        })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Gatekeeper prompt</Label>
                      <Textarea
                        maxLength={LLM_PROMPT_MAX_LENGTH}
                        value={draft.profile.gatekeeperPrompt ?? ""}
                        onChange={(event) => updateProfileDraft({
                          gatekeeperPrompt: event.target.value || null,
                        })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Max input characters</Label>
                      <Input type="number" value={draft.profile.maxInputChars} onChange={(event) => updateProfileDraft({ maxInputChars: Number(event.target.value) })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Max output tokens</Label>
                      <Input type="number" value={draft.profile.maxOutputTokens} onChange={(event) => updateProfileDraft({ maxOutputTokens: Number(event.target.value) })} />
                    </div>
                  </div>
                  <Button onClick={() => saveProfile.mutate()} disabled={!draft.profileDirty || saveProfile.isPending}>
                    <Save className="size-4" /> Save profile
                  </Button>
                </fieldset>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Runtime and installations</CardTitle>
                <CardDescription>
                  Last heartbeat: {selected.runtime.lastHeartbeatAt
                    ? new Date(selected.runtime.lastHeartbeatAt).toLocaleString()
                    : "never"}
                  {selected.runtime.lastErrorCode ? ` · ${selected.runtime.lastErrorCode}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {installations.data?.items.map((installation) => (
                  <InstallationPolicyRow
                    key={installation.id}
                    botId={selectedBotId}
                    installation={installation}
                  />
                ))}
                {installations.data?.items.length === 0 ? (
                  <p className="text-sm text-slate-500">No Discord installations observed yet.</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
