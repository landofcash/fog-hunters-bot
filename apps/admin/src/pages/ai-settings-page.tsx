import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, LockKeyhole, RotateCcw, Save, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/api/client";
import { queryClient } from "@/api/query";
import { ErrorState, PageHeader } from "@/components/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LLM_PROMPT_MAX_LENGTH } from "@/lib/llm-limits";

const settingsSchema = z.object({
  enabled: z.boolean(),
  dmEnabled: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650).nullable(),
  maxInputChars: z.number().int().min(128).max(32000).nullable(),
  maxOutputTokens: z.number().int().min(64).max(4096).nullable(),
  assistantPrompt: z.string().max(LLM_PROMPT_MAX_LENGTH),
  gatekeeperPrompt: z.string().max(LLM_PROMPT_MAX_LENGTH),
});

type SettingsForm = z.infer<typeof settingsSchema>;

function parseNullableNumberInput(value: string): number | null {
  return value === "" ? null : Number(value);
}

function FormField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {description ? <p className="text-xs leading-relaxed text-slate-500">{description}</p> : null}
    </div>
  );
}

export function AiSettingsPage() {
  const { guildId = "", botId = "" } = useParams();
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me });
  const isPlatformAdmin = me?.platformRole === "PLATFORM_ADMIN";
  const llm = useQuery({
    queryKey: ["guild", guildId, "bot", botId, "llm"],
    queryFn: () => api.llmSettings(guildId, botId),
  });
  const models = useQuery({
    queryKey: ["platform", "llm-models"],
    queryFn: api.supportedModels,
    enabled: isPlatformAdmin,
  });
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      enabled: false,
      dmEnabled: false,
      retentionDays: null,
      maxInputChars: null,
      maxOutputTokens: null,
      assistantPrompt: "",
      gatekeeperPrompt: "",
    },
  });

  useEffect(() => {
    if (!llm.data) return;
    const { settings } = llm.data;
    form.reset({
      enabled: settings.enabled,
      dmEnabled: settings.dmEnabled,
      retentionDays: settings.retentionDays,
      maxInputChars: settings.maxInputChars,
      maxOutputTokens: settings.maxOutputTokens,
      assistantPrompt: settings.assistantPrompt ?? "",
      gatekeeperPrompt: settings.gatekeeperPrompt ?? "",
    });
  }, [form, llm.data]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!form.formState.isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [form.formState.isDirty]);

  const save = useMutation({
    mutationFn: (values: SettingsForm) =>
      api.updateLlmSettings(guildId, botId, {
        ...values,
        assistantPrompt: values.assistantPrompt.trim() || null,
        gatekeeperPrompt: values.gatekeeperPrompt.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["guild", guildId, "bot", botId] });
      toast.success("AI settings saved");
    },
    onError: (error) => toast.error(error.message),
  });

  const platformPolicy = useMutation({
    mutationFn: (body: { platformEnabled?: boolean; defaultModel?: string }) =>
      api.updatePlatformPolicy(botId, llm.data!.installation.id, {
        llmEnabledByPlatform: body.platformEnabled,
        modelOverride: body.defaultModel,
      }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["guild", guildId, "bot", botId] }),
        queryClient.invalidateQueries({ queryKey: ["platform", "bots"] }),
      ]);
      setConfirmSuspend(false);
      toast.success(
        variables.defaultModel
          ? "Assigned model updated"
          : variables.platformEnabled
            ? "Guild AI access restored"
            : "Guild AI access suspended",
      );
    },
    onError: (error) => toast.error(error.message),
  });

  if (llm.isLoading) {
    return <Skeleton className="h-[680px] w-full" />;
  }

  const settings = llm.data?.settings;
  const readOnly = llm.data?.installation.presenceStatus !== "PRESENT";
  const assistantLength = form.watch("assistantPrompt").length;
  const gatekeeperLength = form.watch("gatekeeperPrompt").length;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Guild configuration"
        title="AI settings"
        description="Control this guild's AI behavior, prompt overrides, retention, and response limits."
        action={
          <Button
            disabled={readOnly || !form.formState.isDirty || save.isPending}
            onClick={form.handleSubmit((values) => save.mutate(values))}
          >
            <Save className="size-4" />
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        }
      />
      {llm.error ? <ErrorState error={llm.error} /> : null}
      {readOnly ? (
        <div className="rounded-xl border border-amber-300/15 bg-amber-400/7 px-4 py-3 text-sm text-amber-100">
          This installation is read-only because the bot is no longer present.
        </div>
      ) : null}
      {!settings?.platformEnabled ? (
        <div className="flex gap-3 rounded-xl border border-rose-300/15 bg-rose-400/7 px-4 py-3 text-sm text-rose-100">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Platform AI access is suspended.</p>
            <p className="mt-0.5 text-rose-200/70">
              Settings remain editable and saved, but provider calls are blocked.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Availability and delivery</CardTitle>
              <CardDescription>Guild-level preferences within the platform access policy.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <Label htmlFor="guild-ai-enabled">Enable AI for this guild</Label>
                  <p className="mt-1 text-xs text-slate-500">
                    Channel rules still determine where the bot can respond.
                  </p>
                </div>
                <Switch
                  id="guild-ai-enabled"
                  checked={form.watch("enabled")}
                  disabled={readOnly}
                  onCheckedChange={(checked) => form.setValue("enabled", checked, { shouldDirty: true })}
                />
              </div>
              <Separator />
              <div className="flex items-start justify-between gap-6">
                <div>
                  <Label htmlFor="dm-enabled">Direct messages</Label>
                  <p className="mt-1 text-xs text-slate-500">Allow AI responses in bot DMs.</p>
                </div>
                <Switch
                  id="dm-enabled"
                  checked={form.watch("dmEnabled")}
                  disabled
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guild prompts</CardTitle>
              <CardDescription>
                Blank values use the application defaults. Overrides are isolated to this guild.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                label="Assistant prompt"
                description="Defines voice, behavior, and response style for the assistant."
              >
                <Textarea
                  className="min-h-48 resize-y font-mono text-xs leading-relaxed"
                  disabled={readOnly}
                  maxLength={LLM_PROMPT_MAX_LENGTH}
                  placeholder={llm.data?.effectivePrompts.assistant}
                  {...form.register("assistantPrompt")}
                />
                <div className="flex justify-between text-[11px] text-slate-600">
                  <button
                    type="button"
                    disabled={readOnly}
                    className="flex items-center gap-1 hover:text-slate-300"
                    onClick={() => form.setValue("assistantPrompt", "", { shouldDirty: true })}
                  >
                    <RotateCcw className="size-3" />
                    Use default
                  </button>
                  <span>
                    {assistantLength.toLocaleString()} / {LLM_PROMPT_MAX_LENGTH.toLocaleString()}
                  </span>
                </div>
              </FormField>
              <Separator />
              <FormField
                label="Gatekeeper rules"
                description="Guild-specific rules for deciding whether a message needs a bot response."
              >
                <Textarea
                  className="min-h-48 resize-y font-mono text-xs leading-relaxed"
                  disabled={readOnly}
                  maxLength={LLM_PROMPT_MAX_LENGTH}
                  placeholder={llm.data?.effectivePrompts.gatekeeper}
                  {...form.register("gatekeeperPrompt")}
                />
                <div className="flex justify-between text-[11px] text-slate-600">
                  <button
                    type="button"
                    disabled={readOnly}
                    className="flex items-center gap-1 hover:text-slate-300"
                    onClick={() => form.setValue("gatekeeperPrompt", "", { shouldDirty: true })}
                  >
                    <RotateCcw className="size-3" />
                    Use default
                  </button>
                  <span>
                    {gatekeeperLength.toLocaleString()} / {LLM_PROMPT_MAX_LENGTH.toLocaleString()}
                  </span>
                </div>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Limits and retention</CardTitle>
              <CardDescription>Bound context size, output length, and retained conversation data.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3">
              <FormField
                label="Retention days"
                description={`Blank inherits the bot profile value (${llm.data?.effective.retentionDays.toLocaleString() ?? "unavailable"}).`}
              >
                <Input
                  disabled={readOnly}
                  type="number"
                  placeholder={llm.data ? String(llm.data.effective.retentionDays) : undefined}
                  {...form.register("retentionDays", { setValueAs: parseNullableNumberInput })}
                />
              </FormField>
              <FormField
                label="Max input characters"
                description={`Blank inherits the bot profile value (${llm.data?.effective.maxInputChars.toLocaleString() ?? "unavailable"}).`}
              >
                <Input
                  disabled={readOnly}
                  type="number"
                  placeholder={llm.data ? String(llm.data.effective.maxInputChars) : undefined}
                  {...form.register("maxInputChars", { setValueAs: parseNullableNumberInput })}
                />
              </FormField>
              <FormField
                label="Max output tokens"
                description={`Blank inherits the bot profile value (${llm.data?.effective.maxOutputTokens.toLocaleString() ?? "unavailable"}).`}
              >
                <Input
                  disabled={readOnly}
                  type="number"
                  placeholder={llm.data ? String(llm.data.effective.maxOutputTokens) : undefined}
                  {...form.register("maxOutputTokens", { setValueAs: parseNullableNumberInput })}
                />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className={isPlatformAdmin ? "border-violet-300/15" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {isPlatformAdmin ? (
                  <ShieldCheck className="size-4 text-violet-300" />
                ) : (
                  <LockKeyhole className="size-4 text-slate-500" />
                )}
                Assigned model
              </CardTitle>
              <CardDescription>
                {isPlatformAdmin
                  ? "Platform-controlled model assignment."
                  : "Only a platform administrator can change this assignment."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPlatformAdmin ? (
                <Select
                  value={settings?.defaultModel}
                  onValueChange={(defaultModel) => platformPolicy.mutate({ defaultModel })}
                  disabled={readOnly || platformPolicy.isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.data?.items.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  readOnly
                  value={settings?.defaultModel ?? ""}
                  className="font-mono text-xs text-slate-400"
                />
              )}
            </CardContent>
          </Card>

          {isPlatformAdmin ? (
            <Card className="border-violet-300/15">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BrainCircuit className="size-4 text-violet-300" />
                  Platform AI access
                </CardTitle>
                <CardDescription>
                  This override is checked before any OpenAI provider request.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {settings?.platformEnabled ? "Access allowed" : "Access suspended"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      Suspension preserves guild settings while preventing provider expense.
                    </p>
                  </div>
                  <Switch
                    checked={settings?.platformEnabled ?? false}
                    disabled={readOnly || platformPolicy.isPending}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        platformPolicy.mutate({ platformEnabled: true });
                      } else {
                        setConfirmSuspend(true);
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Effective state</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Guild preference</span>
                <Badge variant={settings?.enabled ? "default" : "secondary"}>
                  {settings?.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Platform access</span>
                <Badge variant={settings?.platformEnabled ? "default" : "destructive"}>
                  {settings?.platformEnabled ? "Allowed" : "Suspended"}
                </Badge>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="font-medium text-slate-300">Effective AI</span>
                <Badge variant={llm.data?.effectiveAiEnabled ? "default" : "secondary"}>
                  {llm.data?.effectiveAiEnabled ? "Active" : "Inactive"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend AI access for this guild?</AlertDialogTitle>
            <AlertDialogDescription>
              The bot will stop making OpenAI requests for this guild immediately. Guild prompts,
              channel rules, and preferences will remain stored for later restoration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => platformPolicy.mutate({ platformEnabled: false })}>
              Suspend AI access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
