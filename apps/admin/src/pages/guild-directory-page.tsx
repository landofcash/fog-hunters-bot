import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function GuildDirectoryPage() {
  const { data: me, error } = useQuery({ queryKey: ["me"], queryFn: api.me });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Workspace"
        title="Choose a guild"
        description="You only see guilds where your Discord account has an active administrative membership."
        action={
          me?.platformRole === "PLATFORM_ADMIN" ? (
            <Button asChild variant="outline">
              <Link to="/platform/guilds">
                <ShieldCheck className="size-4" />
                View all guilds
              </Link>
            </Button>
          ) : null
        }
      />
      {error ? <ErrorState error={error} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {me?.memberships.map((guild) => (
          <Card key={guild.guildId} className="group transition-colors hover:border-emerald-300/20">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-11 place-items-center rounded-xl bg-white/6">
                  <Building2 className="size-5 text-slate-300" />
                </div>
                <Badge variant={guild.tenantRole === "OWNER" ? "default" : "secondary"}>
                  {guild.tenantRole}
                </Badge>
              </div>
              <h2 className="mt-5 truncate text-lg font-semibold text-white">{guild.guildName}</h2>
              <p className="mt-1 truncate font-mono text-xs text-slate-600">{guild.guildId}</p>
              <Button asChild variant="ghost" className="mt-4 w-full justify-between px-0 hover:bg-transparent">
                <Link to={`/guilds/${guild.guildId}/overview`}>
                  Open control room
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {me?.memberships.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/12 px-6 py-14 text-center">
          <Building2 className="mx-auto size-7 text-slate-600" />
          <p className="mt-3 font-medium text-slate-200">No guild memberships yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Start the bot in your server once so it can register the guild owner.
          </p>
        </div>
      ) : null}
    </div>
  );
}
