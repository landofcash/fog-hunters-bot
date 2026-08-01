import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import type { JobStatus } from "@/api/types";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statusIcon: Record<JobStatus, typeof Activity> = {
  QUEUED: Clock3,
  RUNNING: LoaderCircle,
  FAILED: AlertTriangle,
  COMPLETED: CheckCircle2,
  CANCELLED: Activity,
};

export function OperationsPage() {
  const { guildId = "" } = useParams();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });
  const jobs = useQuery({
    queryKey: ["guild", guildId, "jobs"],
    queryFn: () => api.jobs(guildId),
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Diagnostics"
        title="Operations"
        description="Inspect API availability and recent background work for this guild."
        action={
          <Badge variant={health.isSuccess ? "default" : "destructive"}>
            {health.isSuccess ? "API online" : "API unavailable"}
          </Badge>
        }
      />
      {jobs.error ? <ErrorState error={jobs.error} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs tracking-wide text-slate-500 uppercase">API</p>
            <p className="mt-3 text-lg font-semibold text-white">{health.isSuccess ? "Healthy" : "Unavailable"}</p>
            <p className="mt-1 text-xs text-slate-600">30-second dashboard probe</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs tracking-wide text-slate-500 uppercase">Bot connection</p>
            <p className="mt-3 text-lg font-semibold text-slate-300">Not reported</p>
            <p className="mt-1 text-xs text-slate-600">Heartbeat storage is not available yet</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs tracking-wide text-slate-500 uppercase">OpenAI</p>
            <p className="mt-3 text-lg font-semibold text-slate-300">
              {jobs.data?.items.some((job) => job.status === "FAILED") ? "Review failures" : "No job failures"}
            </p>
            <p className="mt-1 text-xs text-slate-600">Based on recorded guild jobs</p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Job type</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.data?.items.map((job) => {
              const Icon = statusIcon[job.status];
              return (
                <TableRow key={job.id}>
                  <TableCell>
                    <Badge
                      variant={
                        job.status === "FAILED"
                          ? "destructive"
                          : job.status === "COMPLETED"
                            ? "default"
                            : "secondary"
                      }
                    >
                      <Icon className="mr-1 size-3" />
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-200">{job.jobType}</TableCell>
                  <TableCell className="text-slate-400">{job.attempts} / {job.maxAttempts}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">
                    {format(new Date(job.scheduledAt), "MMM d, HH:mm")}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-rose-300">{job.errorText ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!jobs.isLoading && jobs.data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No operations recorded" description="Background jobs appear here when configuration work is queued." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
