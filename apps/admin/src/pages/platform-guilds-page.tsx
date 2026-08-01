import { useQuery } from "@tanstack/react-query";
import { Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "@/api/client";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function PlatformGuildsPage() {
  const [search, setSearch] = useState("");
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const guilds = useQuery({
    queryKey: ["platform", "guilds", search],
    queryFn: () => api.platformGuilds(search),
    enabled: me?.platformRole === "PLATFORM_ADMIN",
  });

  if (me && me.platformRole !== "PLATFORM_ADMIN") {
    return <Navigate to="/guilds" replace />;
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Platform administration"
        title="All guilds"
        description="Inspect every registered guild, its assigned model, and effective AI access."
        action={<Badge className="h-7 px-3">PLATFORM ADMIN</Badge>}
      />
      <div className="relative max-w-md">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
        <Input
          className="pl-9"
          placeholder="Search guild name or Discord ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {guilds.error ? <ErrorState error={guilds.error} /> : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guild</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Assigned model</TableHead>
              <TableHead>AI access</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guilds.data?.items.map((guild) => (
              <TableRow key={guild.guildId}>
                <TableCell>
                  <p className="font-medium text-slate-100">{guild.guildName}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-600">{guild.guildId}</p>
                </TableCell>
                <TableCell className="text-slate-400">{guild.memberCount}</TableCell>
                <TableCell className="font-mono text-xs text-slate-300">{guild.defaultModel}</TableCell>
                <TableCell>
                  {guild.platformAiEnabled ? (
                    <Badge variant={guild.effectiveAiEnabled ? "default" : "secondary"}>
                      <ShieldCheck className="mr-1 size-3" />
                      {guild.effectiveAiEnabled ? "Active" : "Guild disabled"}
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <ShieldAlert className="mr-1 size-3" />
                      Suspended
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/guilds/${guild.guildId}/overview`}>Inspect</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {guilds.data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No guilds found" description="Try a different name or Discord guild ID." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
