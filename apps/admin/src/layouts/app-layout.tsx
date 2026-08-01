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
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const guildNavigation = [
  { path: "overview", label: "Overview", icon: LayoutDashboard },
  { path: "ai", label: "AI settings", icon: BrainCircuit },
  { path: "channels", label: "Channels", icon: Hash },
  { path: "commands", label: "Commands", icon: Command },
  { path: "administrators", label: "Administrators", icon: Users },
  { path: "audit", label: "Audit log", icon: FileClock },
  { path: "operations", label: "Operations", icon: Activity },
];

export function AppLayout() {
  const { guildId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isPlatformAdmin = me?.platformRole === "PLATFORM_ADMIN";
  const membership = me?.memberships.find((item) => item.guildId === guildId);
  const isPlatformContext = Boolean(guildId && !membership && isPlatformAdmin);

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

          <div className="p-4">
            <Select
              value={guildId ?? ""}
              onValueChange={(value) => {
                localStorage.setItem("fhaibot:last-guild", value);
                navigate(`/guilds/${value}/overview`);
              }}
            >
              <SelectTrigger aria-label="Select guild" className="h-auto min-h-12 bg-white/[0.035] py-2">
                <div className="min-w-0 text-left">
                  <div className="truncate text-sm font-medium">{selectedGuildName}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {isPlatformContext ? "Platform access" : membership?.tenantRole ?? "Guild"}
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
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:overflow-visible">
            {guildId
              ? guildNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={`/guilds/${guildId}/${item.path}`}
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
                to="/platform/guilds"
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
                All guilds
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
        {isPlatformContext ? (
          <div className="flex items-center justify-center gap-2 border-b border-violet-300/15 bg-violet-400/8 px-4 py-2 text-xs font-medium text-violet-200">
            <ShieldCheck className="size-3.5" />
            Platform Admin mode — changes are recorded as platform actions
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8 lg:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
