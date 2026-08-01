import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Bot,
  BrainCircuit,
  Clock3,
  Hash,
  Server,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
          <Icon className="size-4 text-slate-500" />
        </div>
        <p className="mt-4 text-xl font-semibold text-white">{value}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewPage() {
  const { guildId = "" } = useParams();
  const settings = useQuery({
    queryKey: ["guild", guildId, "settings"],
    queryFn: () => api.guildSettings(guildId),
  });
  const llm = useQuery({
    queryKey: ["guild", guildId, "llm"],
    queryFn: () => api.llmSettings(guildId),
  });
  const audit = useQuery({
    queryKey: ["guild", guildId, "audit"],
    queryFn: () => api.audit(guildId),
  });
  const jobs = useQuery({
    queryKey: ["guild", guildId, "jobs"],
    queryFn: () => api.jobs(guildId),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });

  if (settings.isLoading || llm.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const error = settings.error ?? llm.error;
  const recentAudit = audit.data?.items.slice(0, 5) ?? [];
  const recentJobs = jobs.data?.items.slice(0, 5) ?? [];
  const failedJobs = jobs.data?.items.filter((job) => job.status === "FAILED").length ?? 0;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Guild overview"
        title={settings.data?.guild.name ?? guildId}
        description={`Discord guild ${guildId}`}
        action={
          llm.data?.settings.platformEnabled ? (
            <Badge variant={llm.data.effectiveAiEnabled ? "default" : "secondary"}>
              <ShieldCheck className="mr-1 size-3" />
              {llm.data.effectiveAiEnabled ? "AI active" : "AI paused by guild"}
            </Badge>
          ) : (
            <Badge variant="destructive">
              <ShieldAlert className="mr-1 size-3" />
              AI suspended
            </Badge>
          )
        }
      />
      {error ? <ErrorState error={error} /> : null}
      {!llm.data?.settings.platformEnabled ? (
        <div className="flex gap-3 rounded-xl border border-rose-300/15 bg-rose-400/7 px-4 py-3 text-sm text-rose-100">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">AI access is suspended by the platform.</p>
            <p className="mt-0.5 text-rose-200/70">
              Guild and channel preferences remain saved, but no OpenAI requests will be made.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={BrainCircuit}
          label="Assigned model"
          value={llm.data?.settings.defaultModel ?? "—"}
          detail="Platform-managed assignment"
        />
        <StatCard
          icon={Hash}
          label="AI channels"
          value={String(llm.data?.channels.filter((channel) => channel.enabled).length ?? 0)}
          detail="Configured Discord channels"
        />
        <StatCard
          icon={Server}
          label="API health"
          value={health.isSuccess ? "Online" : "Unavailable"}
          detail={health.isSuccess ? "Health probe responding" : "Health probe failed"}
        />
        <StatCard
          icon={Activity}
          label="Recent failures"
          value={String(failedJobs)}
          detail="Within the loaded job history"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="size-4 text-emerald-300" />
              Recent changes
            </CardTitle>
            <CardDescription>The latest recorded administrative actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {recentAudit.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 border-b border-white/7 py-3 last:border-0">
                  <div className="size-2 rounded-full bg-emerald-400/70" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{entry.action}</p>
                    <p className="text-xs text-slate-600">{entry.actorType}</p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
              {recentAudit.length === 0 ? (
                <EmptyState title="No changes yet" description="Saved dashboard and Discord changes appear here." />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-emerald-300" />
              Operations
            </CardTitle>
            <CardDescription>Recent background work associated with this guild.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-3 border-b border-white/7 py-3 last:border-0">
                  <Badge
                    variant={
                      job.status === "FAILED"
                        ? "destructive"
                        : job.status === "COMPLETED"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {job.status}
                  </Badge>
                  <p className="min-w-0 flex-1 truncate text-sm text-slate-300">{job.jobType}</p>
                  <span className="text-xs text-slate-600">
                    {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
              {recentJobs.length === 0 ? (
                <EmptyState title="No jobs yet" description="Background configuration work appears here." />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
