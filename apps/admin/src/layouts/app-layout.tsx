import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  BrainCircuit,
  Building2,
  Command,
  FileClock,
  Hash,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { guildBotSelectionKey } from "@/lib/bot-context";

const guildNavigation = [
  { path: "overview", label: "Overview", icon: LayoutDashboard },
  { path: "ai", label: "AI settings", icon: BrainCircuit },
  { path: "channels", label: "Channels", icon: Hash },
  { path: "commands", label: "Commands", icon: Command },
  { path: "audit", label: "Audit log", icon: FileClock },
  { path: "operations", label: "Operations", icon: Activity },
];

export function AppLayout() {
  const { guildId, botId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isPlatformAdmin = me?.platformRole === "PLATFORM_ADMIN";
  const membership = me?.memberships.find((item) => item.guildId === guildId);
  const guildBots = useQuery({
    queryKey: ["guild", guildId, "bots"],
    queryFn: () => api.guildBots(guildId as string),
    enabled: Boolean(guildId),
  });
  const selectedBot = guildBots.data?.items.find((item) => item.bot.id === botId);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      queryClient.clear();
      navigate("/login");
    },
    onError: (error) => toast.error(error.message),
  });

  const selectedGuildName =
    membership?.guildName ??
    (guildId ? `Guild ${guildId}` : "Select a guild");

  useEffect(() => {
    if (guildId && botId) {
      localStorage.setItem(guildBotSelectionKey(guildId), botId);
    }
  }, [botId, guildId]);

  return (
    <div className="dashboard-grid min-h-screen lg:grid lg:grid-cols-[268px_1fr]">
      <aside className="border-b border-white/8 bg-[#091411]/95 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-full flex-col">
          <div className="flex h-18 items-center gap-3 border-b border-white/8 px-5">
            <div className="grid size-10 place-items-center rounded-xl border border-emerald-300/15 bg-emerald-400/10">
              <Bot className="size-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-wide text-white">Fog Hunters</div>
              <div className="text-[11px] tracking-[0.16em] text-slate-500 uppercase">Control room</div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            <Select
              value={guildId ?? ""}
              onValueChange={(value) => {
                localStorage.setItem("fhaibot:last-guild", value);
                navigate(`/guilds/${value}`);
              }}
            >
              <SelectTrigger aria-label="Select guild" className="h-auto min-h-12 bg-white/[0.035] py-2">
                <div className="min-w-0 text-left">
                  <div className="truncate text-sm font-medium">{selectedGuildName}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {membership?.tenantRole ?? "Guild"}
                  </div>
                </div>
                <SelectValue className="sr-only" />
              </SelectTrigger>
              <SelectContent className="w-[235px]">
                {me?.memberships.map((item) => (
                  <SelectItem key={item.guildId} value={item.guildId}>
                    {item.guildName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {guildId ? (
              <Select
                value={botId ?? ""}
                onValueChange={(value) => {
                  localStorage.setItem(guildBotSelectionKey(guildId), value);
                  navigate(`/guilds/${guildId}/bots/${value}/overview`);
                }}
              >
                <SelectTrigger aria-label="Select bot" className="h-auto min-h-12 bg-white/[0.035] py-2">
                  <div className="min-w-0 text-left">
                    <div className="truncate text-sm font-medium">
                      {selectedBot?.bot.displayName ?? "Select a bot"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {selectedBot
                        ? `${selectedBot.installation.presenceStatus} · ${selectedBot.installation.operationalStatus}`
                        : `${guildBots.data?.items.length ?? 0} installed`}
                    </div>
                  </div>
                  <SelectValue className="sr-only" />
                </SelectTrigger>
                <SelectContent className="w-[235px]">
                  {guildBots.data?.items.map((item) => (
                    <SelectItem key={item.bot.id} value={item.bot.id}>
                      {item.bot.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:overflow-visible">
            {guildId && botId
              ? guildNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={`/guilds/${guildId}/bots/${botId}/${item.path}`}
                      className={({ isActive }) =>
                        cn(
                          "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                          isActive
                            ? "bg-emerald-400/11 text-emerald-200"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                        )
                      }
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </NavLink>
                  );
                })
              : null}
            {guildId ? (
              <NavLink
                to={`/guilds/${guildId}/administrators`}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-emerald-400/11 text-emerald-200"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                  )
                }
              >
                <Users className="size-4" />
                Administrators
              </NavLink>
            ) : null}
            <NavLink
              to="/guilds"
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive && location.pathname === "/guilds"
                    ? "bg-emerald-400/11 text-emerald-200"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                )
              }
            >
              <Building2 className="size-4" />
              My guilds
            </NavLink>
            {isPlatformAdmin ? (
              <NavLink
                to="/platform/bots"
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-violet-400/11 text-violet-200"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                  )
                }
              >
                <ShieldCheck className="size-4" />
                Bot directory
              </NavLink>
            ) : null}
          </nav>

          <div className="mt-auto hidden border-t border-white/8 p-4 lg:block">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-full bg-white/8 text-sm font-semibold text-slate-200">
                {(me?.user.username ?? "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">{me?.user.username}</p>
                <p className="truncate text-[11px] text-slate-500">{me?.user.discordUserId}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Sign out"
                onClick={() => logout.mutate()}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
