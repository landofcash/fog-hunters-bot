import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { EmptyState, ErrorState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  guildBotSelectionKey,
  selectGuildBotId,
} from "@/lib/bot-context";

export function GuildBotRedirect() {
  const { guildId = "" } = useParams();
  const bots = useQuery({
    queryKey: ["guild", guildId, "bots"],
    queryFn: () => api.guildBots(guildId),
  });

  if (bots.isLoading) return <Skeleton className="h-64 w-full" />;
  if (bots.error) return <ErrorState error={bots.error} />;

  const items = bots.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No bot installations"
        description="Invite an active bot from the platform bot directory. It will appear here after Discord confirms the installation."
      />
    );
  }

  const remembered = localStorage.getItem(guildBotSelectionKey(guildId));
  const selected = selectGuildBotId(items, remembered);
  if (!selected) return null;
  return <Navigate to={`/guilds/${guildId}/bots/${selected}/overview`} replace />;
}
