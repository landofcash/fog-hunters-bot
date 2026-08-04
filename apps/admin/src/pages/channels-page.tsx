import { useMutation, useQuery } from "@tanstack/react-query";
import { Hash, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ChannelsPage() {
  const { guildId = "", botId = "" } = useParams();
  const [channelId, setChannelId] = useState("");
  const [mentionOnly, setMentionOnly] = useState(false);
  const [clearChannelId, setClearChannelId] = useState<string>();
  const llm = useQuery({
    queryKey: ["guild", guildId, "bot", botId, "llm"],
    queryFn: () => api.llmSettings(guildId, botId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["guild", guildId, "bot", botId, "llm"] });
  const configure = useMutation({
    mutationFn: (input: { id: string; mentionOnly: boolean }) =>
      api.configureChannel(guildId, botId, input.id, input.mentionOnly),
    onSuccess: async () => {
      await refresh();
      setChannelId("");
      setMentionOnly(false);
      toast.success("Channel settings saved");
    },
    onError: (error) => toast.error(error.message),
  });
  const disable = useMutation({
    mutationFn: (id: string) => api.disableChannel(guildId, botId, id),
    onSuccess: async () => {
      await refresh();
      toast.success("AI disabled for channel");
    },
    onError: (error) => toast.error(error.message),
  });
  const clearMemory = useMutation({
    mutationFn: (id: string) => api.clearChannelMemory(guildId, botId, id),
    onSuccess: (_, id) => {
      setClearChannelId(undefined);
      toast.success(`Retained memory cleared for ${id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const channels = llm.data?.channels ?? [];
  const readOnly = llm.data?.installation.presenceStatus !== "PRESENT";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="AI routing"
        title="Channels"
        description="Enable the bot in selected Discord channels and choose whether a mention is required."
      />
      {llm.error ? <ErrorState error={llm.error} /> : null}
      {readOnly ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-400/7 px-4 py-3 text-sm text-amber-100">
          Channel settings and retained history are read-only while the bot is absent.
        </div>
      ) : null}
      {!llm.data?.settings.platformEnabled ? (
        <div className="flex gap-3 rounded-xl border border-rose-300/15 bg-rose-400/7 px-4 py-3 text-sm text-rose-100">
          <ShieldAlert className="size-4 shrink-0" />
          Platform suspension overrides every channel below. No provider requests can run.
        </div>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
            <div className="grid gap-2">
              <Label htmlFor="channel-id">Discord channel ID</Label>
              <Input
                id="channel-id"
                inputMode="numeric"
                placeholder="123456789012345678"
                value={channelId}
                disabled={readOnly}
                onChange={(event) => setChannelId(event.target.value.trim())}
              />
            </div>
            <label className="flex h-10 items-center gap-3 rounded-lg border border-white/10 px-3 text-sm text-slate-300">
              <Switch disabled={readOnly} checked={mentionOnly} onCheckedChange={setMentionOnly} />
              Mention only
            </label>
            <Button
              disabled={readOnly || !channelId || configure.isPending}
              onClick={() => configure.mutate({ id: channelId, mentionOnly })}
            >
              <Plus className="size-4" />
              Add channel
            </Button>
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Channel names require a future Discord catalog sync; IDs are authoritative and work now.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {channels.map((channel) => (
          <Card key={channel.discordChannelId} className={!channel.enabled ? "opacity-65" : undefined}>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
              <div className="grid size-10 place-items-center rounded-lg bg-white/6">
                <Hash className="size-4 text-slate-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-slate-200">{channel.discordChannelId}</p>
                <div className="mt-2 flex gap-2">
                  <Badge variant={channel.enabled ? "default" : "secondary"}>
                    {channel.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {channel.respondOnMentionOnly ? <Badge variant="outline">Mention only</Badge> : null}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Mention only
                <Switch
                  checked={channel.respondOnMentionOnly}
                  disabled={readOnly || !channel.enabled || configure.isPending}
                  onCheckedChange={(checked) =>
                    configure.mutate({ id: channel.discordChannelId, mentionOnly: checked })
                  }
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={readOnly}
                onClick={() =>
                  channel.enabled
                    ? disable.mutate(channel.discordChannelId)
                    : configure.mutate({
                        id: channel.discordChannelId,
                        mentionOnly: channel.respondOnMentionOnly,
                      })
                }
              >
                {channel.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="text-rose-300"
                aria-label="Clear retained channel memory"
                disabled={readOnly}
                onClick={() => setClearChannelId(channel.discordChannelId)}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {!llm.isLoading && channels.length === 0 ? (
        <EmptyState
          title="No AI channels configured"
          description="Add a Discord channel ID above to allow guild-channel responses."
        />
      ) : null}

      <AlertDialog open={Boolean(clearChannelId)} onOpenChange={(open) => !open && setClearChannelId(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear retained channel memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes stored conversation messages for channel {clearChannelId}. Prompt and
              channel settings are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={readOnly}
              onClick={() => clearChannelId && clearMemory.mutate(clearChannelId)}
            >
              Clear memory
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
