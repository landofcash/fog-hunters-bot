import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Eye, FileClock } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import type { AuditLog } from "@/api/types";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      <pre className="overflow-x-auto rounded-xl border border-white/8 bg-black/25 p-4 text-xs leading-relaxed text-slate-300">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </div>
  );
}

export function AuditPage() {
  const { guildId = "", botId = "" } = useParams();
  const [selected, setSelected] = useState<AuditLog>();
  const audit = useQuery({
    queryKey: ["guild", guildId, "bot", botId, "audit"],
    queryFn: () => api.audit(guildId, botId),
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description="Review who changed guild configuration, what changed, and when it happened."
        action={<Badge variant="outline">{audit.data?.items.length ?? 0} recent events</Badge>}
      />
      {audit.error ? <ErrorState error={audit.error} /> : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data?.items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <FileClock className="size-4 text-slate-500" />
                    <span className="font-mono text-xs text-slate-200">{entry.action}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={entry.actorType === "PLATFORM_ADMIN" ? "warning" : "secondary"}>
                    {entry.actorType}
                  </Badge>
                </TableCell>
                <TableCell>
                  <p className="text-sm text-slate-300">{entry.entityType}</p>
                  <p className="mt-0.5 max-w-56 truncate font-mono text-[11px] text-slate-600">{entry.entityId}</p>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm")}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setSelected(entry)}>
                    <Eye className="size-4" />
                    <span className="sr-only">View audit details</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!audit.isLoading && audit.data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No audit events yet" description="Effective settings changes will be recorded here." />
          </div>
        ) : null}
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.action}</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.actorType} · ${format(new Date(selected.createdAt), "PPpp")}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <JsonBlock title="Before" value={selected?.before} />
            <JsonBlock title="After" value={selected?.after} />
            <JsonBlock title="Metadata" value={selected?.metadata} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
