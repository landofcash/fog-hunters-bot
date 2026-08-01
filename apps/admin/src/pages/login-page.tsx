import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { Navigate } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function LoginPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const login = useMutation({
    mutationFn: api.loginUrl,
    onSuccess: ({ url }) => window.location.assign(url),
  });

  if (me.data) {
    return <Navigate to="/guilds" replace />;
  }

  return (
    <div className="dashboard-grid relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
      <div className="absolute top-[-14rem] left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-emerald-400/8 blur-3xl" />
      <div className="relative grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="hidden lg:block">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl border border-emerald-300/15 bg-emerald-400/10">
              <Bot className="size-5 text-emerald-300" />
            </div>
            <span className="text-sm font-semibold tracking-[0.16em] text-slate-300 uppercase">
              Fog Hunters
            </span>
          </div>
          <h1 className="max-w-xl text-5xl leading-[1.05] font-semibold tracking-[-0.045em] text-white">
            Your Discord AI,
            <span className="block text-emerald-300">under control.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-slate-400">
            Configure prompts, channels, permissions, retention, and operations from one
            focused control room.
          </p>
          <div className="mt-9 flex gap-7 text-sm text-slate-400">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-300" />
              Guild scoped
            </span>
            <span className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-emerald-300" />
              Discord OAuth
            </span>
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-300" />
              Audited
            </span>
          </div>
        </section>

        <Card className="border-white/12 bg-[#0c1815]/92 p-2 shadow-[0_35px_100px_rgba(0,0,0,0.45)]">
          <div className="rounded-xl border border-white/7 bg-black/10 p-7 sm:p-9">
            <div className="grid size-12 place-items-center rounded-xl bg-[#5865F2]/15">
              <svg viewBox="0 0 24 24" aria-hidden className="size-6 fill-[#8c95ff]">
                <path d="M19.5 5.34A17.4 17.4 0 0 0 15.1 4l-.55 1.12a15.5 15.5 0 0 0-5.1 0L8.9 4a17.7 17.7 0 0 0-4.4 1.35C1.72 9.46.96 13.46 1.34 17.4a17.8 17.8 0 0 0 5.4 2.72l1.31-1.77a11.3 11.3 0 0 1-2.06-.98l.5-.4a12.5 12.5 0 0 0 11.02 0l.5.4c-.66.4-1.35.72-2.06.98l1.31 1.77a17.7 17.7 0 0 0 5.4-2.72c.45-4.56-.77-8.52-3.16-12.06ZM8.56 15.02c-1.05 0-1.91-.97-1.91-2.16s.84-2.16 1.91-2.16 1.93.98 1.91 2.16c0 1.19-.84 2.16-1.91 2.16Zm6.88 0c-1.05 0-1.91-.97-1.91-2.16s.84-2.16 1.91-2.16 1.93.98 1.91 2.16c0 1.19-.84 2.16-1.91 2.16Z" />
              </svg>
            </div>
            <h2 className="mt-7 text-2xl font-semibold tracking-tight text-white">
              Administration dashboard
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Sign in with the Discord account that owns or administers your server.
            </p>
            <Button
              size="lg"
              className="mt-8 w-full bg-[#6672f4] text-white hover:bg-[#7882f7]"
              disabled={login.isPending}
              onClick={() => login.mutate()}
            >
              {login.isPending ? "Connecting…" : "Continue with Discord"}
              <ArrowRight className="size-4" />
            </Button>
            {login.isError ? (
              <p className="mt-3 text-center text-xs text-rose-300">{login.error.message}</p>
            ) : null}
            <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
              Session credentials stay in secure HTTP-only cookies.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
