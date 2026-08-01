import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown, Shield, UserCog } from "lucide-react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import type { TenantRole } from "@/api/types";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function AdministratorsPage() {
  const { guildId = "" } = useParams();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const members = useQuery({
    queryKey: ["guild", guildId, "members"],
    queryFn: () => api.members(guildId),
  });
  const membership = me?.memberships.find((item) => item.guildId === guildId);
  const canManage = membership?.tenantRole === "OWNER" || me?.platformRole === "PLATFORM_ADMIN";

  const updateRole = useMutation({
    mutationFn: ({ userId, tenantRole }: { userId: string; tenantRole: TenantRole }) =>
      api.updateMemberRole(guildId, userId, tenantRole),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["guild", guildId, "members"] });
      toast.success("Administrator role updated");
    },
    onError: (error) => toast.error(error.message),
  });

  const privileged = members.data?.items.filter(
    (member) => member.status === "ACTIVE" && ["OWNER", "ADMIN"].includes(member.tenantRole),
  ) ?? [];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Access control"
        title="Administrators"
        description="Guild owners and platform administrators can grant or remove the ADMIN role. Ownership remains protected by the API."
        action={<Badge variant="outline">{privileged.length} privileged members</Badge>}
      />
      {members.error ? <ErrorState error={members.error} /> : null}
      {!canManage ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-slate-400">
          You can view administrators. Only a guild owner or platform administrator can change roles.
        </div>
      ) : null}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Discord ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-48">Guild role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data?.items.map((member) => (
              <TableRow key={member.userId}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-full bg-white/7">
                      {member.tenantRole === "OWNER" ? (
                        <Crown className="size-4 text-amber-300" />
                      ) : member.tenantRole === "ADMIN" ? (
                        <Shield className="size-4 text-emerald-300" />
                      ) : (
                        <UserCog className="size-4 text-slate-500" />
                      )}
                    </div>
                    <span className="font-medium text-slate-200">{member.username ?? "Discord user"}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{member.discordUserId}</TableCell>
                <TableCell>
                  <Badge variant={member.status === "ACTIVE" ? "default" : "secondary"}>{member.status}</Badge>
                </TableCell>
                <TableCell>
                  {member.tenantRole === "OWNER" ? (
                    <Badge variant="warning">OWNER</Badge>
                  ) : (
                    <Select
                      value={member.tenantRole === "ADMIN" ? "ADMIN" : "USER"}
                      disabled={!canManage || updateRole.isPending || member.status !== "ACTIVE"}
                      onValueChange={(tenantRole) =>
                        updateRole.mutate({ userId: member.userId, tenantRole: tenantRole as TenantRole })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADMIN">ADMIN</SelectItem>
                        <SelectItem value="USER">USER</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!members.isLoading && members.data?.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No members found" description="Members appear after the bot records their guild activity." />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
