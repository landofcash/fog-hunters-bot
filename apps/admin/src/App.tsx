import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, ApiClientError } from "@/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/layouts/app-layout";

const LoginPage = lazy(() =>
  import("@/pages/login-page").then((module) => ({ default: module.LoginPage })),
);
const GuildDirectoryPage = lazy(() =>
  import("@/pages/guild-directory-page").then((module) => ({ default: module.GuildDirectoryPage })),
);
const GuildBotRedirect = lazy(() =>
  import("@/pages/guild-bot-redirect").then((module) => ({ default: module.GuildBotRedirect })),
);
const OverviewPage = lazy(() =>
  import("@/pages/overview-page").then((module) => ({ default: module.OverviewPage })),
);
const AiSettingsPage = lazy(() =>
  import("@/pages/ai-settings-page").then((module) => ({ default: module.AiSettingsPage })),
);
const ChannelsPage = lazy(() =>
  import("@/pages/channels-page").then((module) => ({ default: module.ChannelsPage })),
);
const CommandsPage = lazy(() =>
  import("@/pages/commands-page").then((module) => ({ default: module.CommandsPage })),
);
const AdministratorsPage = lazy(() =>
  import("@/pages/administrators-page").then((module) => ({ default: module.AdministratorsPage })),
);
const AuditPage = lazy(() =>
  import("@/pages/audit-page").then((module) => ({ default: module.AuditPage })),
);
const OperationsPage = lazy(() =>
  import("@/pages/operations-page").then((module) => ({ default: module.OperationsPage })),
);
const PlatformBotsPage = lazy(() =>
  import("@/pages/platform-bots-page").then((module) => ({ default: module.PlatformBotsPage })),
);

function RouteFallback() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-16 w-80" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

function AuthenticatedRoutes() {
  const location = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });

  if (me.isLoading) {
    return (
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-6">
        <div className="w-full space-y-4">
          <Skeleton className="h-14 w-64" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (me.error instanceof ApiClientError && me.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (me.isError) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Dashboard unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{me.error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/guilds" element={<GuildDirectoryPage />} />
          <Route path="/guilds/:guildId" element={<GuildBotRedirect />} />
          <Route path="/guilds/:guildId/bots/:botId/overview" element={<OverviewPage />} />
          <Route path="/guilds/:guildId/bots/:botId/ai" element={<AiSettingsPage />} />
          <Route path="/guilds/:guildId/bots/:botId/channels" element={<ChannelsPage />} />
          <Route path="/guilds/:guildId/bots/:botId/commands" element={<CommandsPage />} />
          <Route path="/guilds/:guildId/administrators" element={<AdministratorsPage />} />
          <Route path="/guilds/:guildId/bots/:botId/audit" element={<AuditPage />} />
          <Route path="/guilds/:guildId/bots/:botId/operations" element={<OperationsPage />} />
          <Route path="/platform/bots" element={<PlatformBotsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/guilds" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<AuthenticatedRoutes />} />
      </Routes>
    </Suspense>
  );
}
