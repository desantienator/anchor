"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";
import * as React from "react";
import { LoadFailedRow } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  Row,
  RowText,
  SaveStatus,
  Section,
  useSaveStatus,
} from "@/features/settings/components/settings-blocks";
import { useRetry } from "@/lib/hooks/use-retry";
import { cn } from "@/lib/utils";
import {
  type AiCapabilities,
  type AiFieldSource,
  type AiPreferences,
  type AiPreferencesPatch,
  getAiCapabilities,
  getAiPreferences,
  testAiConnection,
  updateAiPreferences,
} from "../api";

export const aiKeys = {
  capabilities: ["ai", "capabilities"] as const,
  preferences: ["ai", "preferences"] as const,
};

/** The server's own message when it sends one. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HTTPError) return error.message;
  return fallback;
}

/** Host and path only, matching what the server displays. */
function displayedOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function sourceText(source: AiFieldSource): string {
  if (source === "user") return "Set on this device.";
  if (source === "environment") return "From the server.";
  return "Not set on the server.";
}

const RESET_BUTTON =
  "cursor-pointer border-0 bg-transparent p-0 font-semibold underline decoration-current/35 underline-offset-3";

/**
 * The destination is shown before it is used, and every switch starts off.
 * Content leaves the device only when a person enables it here.
 */
export function AiSettingsSection() {
  const queryClient = useQueryClient();
  const [saveStatus, setSaveStatus] = useSaveStatus();
  const capabilities = useQuery({
    queryKey: aiKeys.capabilities,
    queryFn: getAiCapabilities,
  });
  const preferences = useQuery({
    queryKey: aiKeys.preferences,
    queryFn: getAiPreferences,
  });
  const retry = useRetry(async () => {
    await Promise.all([capabilities.refetch(), preferences.refetch()]);
  });

  // Destination fields, pre-filled with the effective values. The API key is
  // null until the person touches it: the raw key is never sent back, so an
  // untouched field means "no change" and a cleared one means "remove it".
  const [endpoint, setEndpoint] = React.useState("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const [baseline, setBaseline] = React.useState({
    endpoint: "",
    model: "",
  });
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    { ok: true; model: string } | { ok: false; message: string } | null
  >(null);

  React.useEffect(() => {
    const caps = capabilities.data;
    if (!caps) return;
    setEndpoint(caps.baseUrl ?? "");
    setModel(caps.model ?? "");
    setBaseline({ endpoint: caps.baseUrl ?? "", model: caps.model ?? "" });
  }, [capabilities.data]);

  const save = useMutation({
    mutationFn: (patch: AiPreferencesPatch) => updateAiPreferences(patch),
    onMutate: async (patch) => {
      const before = queryClient.getQueryData<AiPreferences>(
        aiKeys.preferences,
      );
      if (before)
        queryClient.setQueryData(aiKeys.preferences, { ...before, ...patch });
      return { before };
    },
    onSuccess: (next) => {
      queryClient.setQueryData(aiKeys.preferences, next);
      // The preferences answer carries the same destination facts, so both
      // caches stay in sync without a second request.
      queryClient.setQueryData<AiCapabilities>(
        aiKeys.capabilities,
        (caps) =>
          caps && {
            ...caps,
            configured: next.configured,
            baseUrl: next.baseUrl ? displayedOrigin(next.baseUrl) : null,
            model: next.model,
            hasApiKey: next.hasApiKey,
            source: next.source,
          },
      );
      // The raw key only travels one way, so the field goes back to its
      // "saved or empty" state once the change lands.
      setApiKey(null);
      setSaveStatus("saved");
      setTestResult(null);
    },
    onError: (error, patch, context) => {
      if (context?.before)
        queryClient.setQueryData(aiKeys.preferences, context.before);
      toast.error(errorMessage(error, "Couldn’t save that setting."), {
        retry: () => save.mutate(patch),
      });
    },
  });

  const caps = capabilities.data;
  const prefs = preferences.data;
  const consentStale = !!prefs?.consentRequired;

  const destinationDirty =
    caps !== undefined &&
    (endpoint !== baseline.endpoint ||
      model !== baseline.model ||
      apiKey !== null);

  const saveDestination = () => {
    const patch: AiPreferencesPatch = {};
    if (endpoint !== baseline.endpoint) patch.baseUrl = endpoint.trim();
    if (model !== baseline.model) patch.model = model.trim();
    if (apiKey !== null) patch.apiKey = apiKey.trim();
    setSaveStatus("saving");
    setTestResult(null);
    save.mutate(patch);
  };

  /** Clears the person's override; the field falls back to the server's. */
  const resetField = (field: "baseUrl" | "model" | "apiKey") => {
    setSaveStatus("saving");
    setTestResult(null);
    save.mutate({ [field]: "" });
  };

  /** Toggles save immediately; the destination fields wait for Save. */
  const toggle = (patch: AiPreferencesPatch) => {
    setSaveStatus("saving");
    save.mutate(patch);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiConnection();
      setTestResult({ ok: true, model: result.model });
    } catch (error) {
      setTestResult({
        ok: false,
        message: errorMessage(error, "Couldn’t reach the endpoint."),
      });
    } finally {
      setTesting(false);
    }
  };

  const resetButton = (
    field: "baseUrl" | "model" | "apiKey",
    source: AiFieldSource,
  ) =>
    source === "user" ? (
      <button
        type="button"
        className={RESET_BUTTON}
        onClick={() => resetField(field)}
      >
        Reset
      </button>
    ) : undefined;

  return (
    <Section
      id="ai"
      title="Local AI"
      description="Tag suggestions and spelling checks from an OpenAI-compatible endpoint your server can reach."
    >
      {capabilities.isError && !caps ? (
        <LoadFailedRow
          message="Couldn’t check the local AI setup."
          onRetry={retry.retry}
          isRetrying={retry.isRetrying}
        />
      ) : capabilities.isLoading || preferences.isLoading ? (
        <Skeleton className="h-18 w-full rounded-xl" />
      ) : (
        <>
          <Row className="block">
            <div className="grid gap-3.5">
              <Field
                label="Endpoint"
                help={sourceText(caps?.source.baseUrl ?? "none")}
                aside={resetButton("baseUrl", caps?.source.baseUrl ?? "none")}
              >
                <Input
                  value={endpoint}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="http://192.168.1.97:11434/v1"
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </Field>
              <Field
                label="Model"
                help={sourceText(caps?.source.model ?? "none")}
                aside={resetButton("model", caps?.source.model ?? "none")}
              >
                <Input
                  value={model}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="qwen3"
                  onChange={(e) => setModel(e.target.value)}
                />
              </Field>
              <Field
                label="API key"
                help={
                  apiKey === null
                    ? caps?.hasApiKey
                      ? "API key saved."
                      : sourceText(caps?.source.apiKey ?? "none")
                    : caps?.hasApiKey
                      ? apiKey.trim() === ""
                        ? "Saving a blank key removes the saved one."
                        : "A new key replaces the saved one."
                      : sourceText(caps?.source.apiKey ?? "none")
                }
                aside={resetButton("apiKey", caps?.source.apiKey ?? "none")}
              >
                <PasswordInput
                  value={apiKey ?? ""}
                  autoComplete="off"
                  placeholder={caps?.hasApiKey ? "••••••" : "sk-…"}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  className="cursor-pointer rounded-md bg-foreground px-3 py-1.5 font-medium text-card text-ui disabled:opacity-40"
                  disabled={!destinationDirty || save.isPending}
                  onClick={saveDestination}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md bg-foreground/6 px-3 py-1.5 font-medium text-ui disabled:opacity-40"
                  disabled={!caps?.configured || testing}
                  onClick={() => void runTest()}
                >
                  {testing ? "Testing…" : "Test connection"}
                </button>
                {testing ? null : testResult ? (
                  <p
                    className={cn(
                      "m-0 text-meta",
                      testResult.ok ? "text-added-ink" : "text-destructive",
                    )}
                  >
                    {testResult.ok
                      ? `Connected to ${testResult.model}.`
                      : testResult.message}
                  </p>
                ) : null}
              </div>
            </div>
          </Row>

          <Row>
            <RowText
              title={<label htmlFor="ai-enabled">Use local AI</label>}
              text={
                <>
                  Notes are only sent when you ask for suggestions with{" "}
                  <b>Local AI</b> in a note, or press <b>Process</b> on the
                  notes list.
                  {caps?.configured && caps.baseUrl && caps.model ? (
                    <>
                      {" "}
                      They go to <b>{caps.model}</b> at <b>{caps.baseUrl}</b>.
                    </>
                  ) : null}
                </>
              }
              saved={<SaveStatus state={saveStatus} />}
            />
            <Switch
              id="ai-enabled"
              checked={!!prefs?.enabled}
              onCheckedChange={(on) =>
                toggle({
                  enabled: on,
                  ...(on ? { consent: true } : {}),
                })
              }
            />
          </Row>

          {consentStale && (
            <Row>
              <RowText
                title="The AI destination changed"
                text="Allow sending notes to the new endpoint before using AI again."
              />
              <button
                type="button"
                className="rounded-md bg-foreground px-3 py-1.5 font-medium text-card text-ui"
                onClick={() => toggle({ consent: true })}
              >
                Allow
              </button>
            </Row>
          )}

          {prefs?.enabled && !consentStale && (
            <>
              <Row>
                <RowText
                  title={<label htmlFor="ai-tags">Suggest tags</label>}
                  text="Offer tags from your own tag list. You choose which to add."
                />
                <Switch
                  id="ai-tags"
                  checked={prefs.taggingEnabled}
                  onCheckedChange={(on) => toggle({ taggingEnabled: on })}
                />
              </Row>
              <Row>
                <RowText
                  title={<label htmlFor="ai-spelling">Check spelling</label>}
                  text="Offer word corrections you can review one by one."
                />
                <Switch
                  id="ai-spelling"
                  checked={prefs.spellingEnabled}
                  onCheckedChange={(on) => toggle({ spellingEnabled: on })}
                />
              </Row>
              <Row>
                <RowText
                  title={
                    <label htmlFor="ai-onsave">
                      Add matching tags after saving
                    </label>
                  }
                  text="When you stop editing, suggest tags and add the matching ones. Tags are only added, never removed, and only on notes you open."
                />
                <Switch
                  id="ai-onsave"
                  checked={prefs.onSaveEnabled && prefs.autoApplyTags}
                  onCheckedChange={(on) =>
                    toggle({ onSaveEnabled: on, autoApplyTags: on })
                  }
                />
              </Row>
            </>
          )}
        </>
      )}
    </Section>
  );
}
