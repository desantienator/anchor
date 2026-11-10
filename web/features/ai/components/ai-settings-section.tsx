"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadFailedRow } from "@/components/ui/empty-state";
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
import {
  type AiPreferences,
  getAiCapabilities,
  getAiPreferences,
  updateAiPreferences,
} from "../api";

export const aiKeys = {
  capabilities: ["ai", "capabilities"] as const,
  preferences: ["ai", "preferences"] as const,
};

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

  type PreferencePatch = Partial<AiPreferences> & { consent?: boolean };

  const save = useMutation({
    mutationFn: (patch: PreferencePatch) => updateAiPreferences(patch),
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
      setSaveStatus("saved");
    },
    onError: (_error, patch, context) => {
      if (context?.before)
        queryClient.setQueryData(aiKeys.preferences, context.before);
      toast.error("Couldn’t save that setting", {
        retry: () => save.mutate(patch),
      });
    },
  });

  const prefs = preferences.data;
  const configured = capabilities.data?.configured ?? false;
  const destination = capabilities.data;
  const consentStale = !!prefs?.consentRequired;

  const set = (patch: PreferencePatch) => {
    setSaveStatus("saving");
    save.mutate(patch);
  };

  return (
    <Section
      id="ai"
      title="Local AI"
      description="Tag suggestions and spelling checks from an OpenAI-compatible endpoint your server can reach."
    >
      {capabilities.isError && !capabilities.data ? (
        <LoadFailedRow
          message="Couldn’t check the local AI setup."
          onRetry={retry.retry}
          isRetrying={retry.isRetrying}
        />
      ) : capabilities.isLoading || preferences.isLoading ? (
        <Skeleton className="h-18 w-full rounded-xl" />
      ) : !configured ? (
        <Row>
          <RowText
            title="Not configured"
            text="An administrator needs to set AI_BASE_URL and AI_MODEL on the server."
          />
        </Row>
      ) : (
        <>
          <Row>
            <RowText
              title={<label htmlFor="ai-enabled">Use local AI</label>}
              text={
                <>
                  Notes are only sent when you ask for suggestions with{" "}
                  <b>Local AI</b> in a note, or press <b>Process</b> on the
                  notes list. They go to <b>{destination?.model}</b> at{" "}
                  <b>{destination?.baseUrl}</b>.
                </>
              }
              saved={<SaveStatus state={saveStatus} />}
            />
            <Switch
              id="ai-enabled"
              checked={!!prefs?.enabled}
              onCheckedChange={(on) =>
                set({
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
                className="rounded-md bg-foreground px-3 py-1.5 font-medium text-ui text-surface"
                onClick={() => set({ consent: true })}
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
                  onCheckedChange={(on) => set({ taggingEnabled: on })}
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
                  onCheckedChange={(on) => set({ spellingEnabled: on })}
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
                    set({ onSaveEnabled: on, autoApplyTags: on })
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
