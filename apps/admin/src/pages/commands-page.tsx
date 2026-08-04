import { useMutation, useQuery } from "@tanstack/react-query";
import { Command, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import type { CommandPermission, TenantRole } from "@/api/types";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const roles: TenantRole[] = ["USER", "MODERATOR", "ADMIN", "OWNER"];

function csvToIds(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function CommandCard({
  guildId,
  botId,
  command,
  readOnly,
}: {
  guildId: string;
  botId: string;
  command: CommandPermission;
  readOnly: boolean;
}) {
  const [minRole, setMinRole] = useState<TenantRole>(command.minRole);
  const [allow, setAllow] = useState(command.allowChannels.join(", "));
  const [deny, setDeny] = useState(command.denyChannels.join(", "));
  useEffect(() => {
    setMinRole(command.minRole);
    setAllow(command.allowChannels.join(", "));
    setDeny(command.denyChannels.join(", "));
  }, [command]);

  const save = useMutation({
    mutationFn: () =>
      api.updateCommand(guildId, botId, command.commandKey, {
        minRole,
        allowChannels: csvToIds(allow),
        denyChannels: csvToIds(deny),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["guild", guildId, "bot", botId, "settings"] });
      toast.success(`/${command.commandKey.replaceAll(".", " ")} permission saved`);
    },
    onError: (error) => toast.error(error.message),
  });

  const dirty =
    minRole !== command.minRole ||
    allow !== command.allowChannels.join(", ") ||
    deny !== command.denyChannels.join(", ");

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end">
          <div className="min-w-[220px] flex-1 self-start">
            <div className="flex items-center gap-2">
              <div className="grid size-9 place-items-center rounded-lg bg-white/6">
                <Command className="size-4 text-slate-400" />
              </div>
              <div>
                <p className="font-mono text-sm text-slate-100">/{command.commandKey.replaceAll(".", " ")}</p>
                <p className="mt-0.5 text-xs text-slate-600">Updated {new Date(command.updatedAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
          <div className="grid flex-[2] gap-4 sm:grid-cols-[170px_1fr_1fr]">
            <div className="grid gap-2">
              <Label>Minimum role</Label>
              <Select
                value={minRole}
                disabled={readOnly}
                onValueChange={(value) => setMinRole(value as TenantRole)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role} value={role}>{role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Allowed channel IDs</Label>
              <Input disabled={readOnly} value={allow} onChange={(event) => setAllow(event.target.value)} placeholder="Empty means all" />
            </div>
            <div className="grid gap-2">
              <Label>Denied channel IDs</Label>
              <Input disabled={readOnly} value={deny} onChange={(event) => setDeny(event.target.value)} placeholder="Denied wins" />
            </div>
          </div>
          <Button
            size="sm"
            disabled={readOnly || !dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CommandsPage() {
  const { guildId = "", botId = "" } = useParams();
  const settings = useQuery({
    queryKey: ["guild", guildId, "bot", botId, "settings"],
    queryFn: () => api.guildSettings(guildId, botId),
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Authorization"
        title="Command permissions"
        description="Set the minimum tenant role and channel boundaries for configurable Discord commands. Denied channels always take precedence."
        action={<Badge variant="outline">{settings.data?.commands.length ?? 0} policies</Badge>}
      />
      {settings.error ? <ErrorState error={settings.error} /> : null}
      {settings.data?.installation.presenceStatus === "LEFT" ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-400/7 px-4 py-3 text-sm text-amber-100">
          Command policies are read-only while the bot is absent.
        </div>
      ) : null}
      <div className="space-y-3">
        {settings.data?.commands.map((command) => (
          <CommandCard
            key={command.commandKey}
            guildId={guildId}
            botId={botId}
            command={command}
            readOnly={settings.data.installation.presenceStatus !== "PRESENT"}
          />
        ))}
      </div>
      {!settings.isLoading && settings.data?.commands.length === 0 ? (
        <EmptyState
          title="No command overrides"
          description="Commands are currently using their application defaults."
        />
      ) : null}
    </div>
  );
}
