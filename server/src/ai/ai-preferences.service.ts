import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfig } from '../config/configuration';
import { AiClient, type AiEndpoint } from './ai-client.service';
import { AI_CONSTANTS } from './ai.constants';
import { AiError, type AiOperation } from './ai.types';

/** Where a field's effective value comes from. */
export type AiFieldSource = 'user' | 'environment' | 'none';

export interface AiPreferences {
  enabled: boolean;
  taggingEnabled: boolean;
  spellingEnabled: boolean;
  onSaveEnabled: boolean;
  autoApplyTags: boolean;
  locale: string;
  /** The provider configuration the person last agreed to. */
  consentedConfigKey: string | null;
  /** True when the destination changed since that agreement. */
  consentRequired: boolean;
  /** Effective destination: the person's value when set, otherwise the server's. */
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  source: {
    baseUrl: AiFieldSource;
    model: AiFieldSource;
    apiKey: AiFieldSource;
  };
}

/**
 * A person's effective AI configuration: their own endpoint, model and key
 * when set, otherwise the server's environment. The raw key is internal;
 * clients see `hasApiKey`.
 */
export interface AiEffectiveConfig {
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  timeoutMs: number;
  configured: boolean;
  source: {
    baseUrl: AiFieldSource;
    model: AiFieldSource;
    apiKey: AiFieldSource;
  };
}

export interface AiPreferencesPatch {
  enabled?: boolean;
  taggingEnabled?: boolean;
  spellingEnabled?: boolean;
  onSaveEnabled?: boolean;
  autoApplyTags?: boolean;
  locale?: string;
  /** Endpoint override; an empty string clears it. */
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  consent?: boolean;
}

type AiOverrideRow = {
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
};

function fieldSource(
  override: string | null,
  env: string | null,
): AiFieldSource {
  if (override) return 'user';
  if (env) return 'environment';
  return 'none';
}

function resolveEffective(
  row: AiOverrideRow | null,
  config: ConfigType<typeof AiConfig>,
): AiEffectiveConfig {
  const baseUrl = row?.baseUrl || config.baseUrl || null;
  const model = row?.model || config.model || null;
  const apiKey = row?.apiKey ?? config.apiKey;
  return {
    baseUrl,
    model,
    apiKey,
    timeoutMs: config.timeoutMs,
    configured: !config.explicitlyDisabled && !!baseUrl && !!model,
    source: {
      baseUrl: fieldSource(row?.baseUrl ?? null, config.baseUrl || null),
      model: fieldSource(row?.model ?? null, config.model || null),
      apiKey: fieldSource(row?.apiKey ?? null, config.apiKey),
    },
  };
}

/** The effective values as the client's `AiEndpoint` shape. */
export function endpointFrom(
  effective: AiEffectiveConfig,
): AiEndpoint {
  return {
    baseUrl: effective.baseUrl ?? '',
    model: effective.model ?? '',
    apiKey: effective.apiKey,
    timeoutMs: effective.timeoutMs,
  };
}

@Injectable()
export class AiPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiClient,
    @Inject(AiConfig.KEY)
    private readonly config: ConfigType<typeof AiConfig>,
  ) {}

  async effectiveConfig(userId: string): Promise<AiEffectiveConfig> {
    const row = await this.prisma.userAiPreferences.findUnique({
      where: { userId },
    });
    return resolveEffective(row, this.config);
  }

  async find(userId: string): Promise<AiPreferences> {
    const row = await this.prisma.userAiPreferences.findUnique({
      where: { userId },
    });
    const effective = resolveEffective(row, this.config);
    const configKey = this.client.configKey(endpointFrom(effective));
    return {
      enabled: row?.enabled ?? false,
      taggingEnabled: row?.taggingEnabled ?? true,
      spellingEnabled: row?.spellingEnabled ?? true,
      onSaveEnabled: row?.onSaveEnabled ?? false,
      autoApplyTags: row?.autoApplyTags ?? false,
      locale: row?.locale ?? AI_CONSTANTS.DEFAULT_LOCALE,
      consentedConfigKey: row?.consentedConfigKey ?? null,
      // Consent is about a destination; with none configured there is
      // nothing to agree to yet.
      consentRequired:
        (row?.enabled ?? false) &&
        effective.configured &&
        row?.consentedConfigKey !== configKey,
      configured: effective.configured,
      baseUrl: effective.baseUrl,
      model: effective.model,
      hasApiKey: effective.apiKey !== null,
      source: effective.source,
    };
  }

  /**
   * Enabling, or consenting, records the person's effective destination and
   * model, so a later change shows up as consent that no longer applies.
   */
  async update(
    userId: string,
    patch: AiPreferencesPatch,
  ): Promise<AiPreferences> {
    const row = await this.prisma.userAiPreferences.findUnique({
      where: { userId },
    });
    const current = {
      enabled: false,
      taggingEnabled: true,
      spellingEnabled: true,
      onSaveEnabled: false,
      autoApplyTags: false,
      locale: AI_CONSTANTS.DEFAULT_LOCALE,
      ...row,
    };
    const consenting =
      patch.consent === true ||
      (patch.enabled === true && !(current.enabled ?? false));
    const data: {
      enabled: boolean;
      taggingEnabled: boolean;
      spellingEnabled: boolean;
      onSaveEnabled: boolean;
      autoApplyTags: boolean;
      locale: string;
      consentedConfigKey?: string;
    } & Partial<AiOverrideRow> = {
      enabled: patch.enabled ?? (current.enabled ?? false),
      taggingEnabled: patch.taggingEnabled ?? (current.taggingEnabled ?? true),
      spellingEnabled:
        patch.spellingEnabled ?? (current.spellingEnabled ?? true),
      onSaveEnabled: patch.onSaveEnabled ?? (current.onSaveEnabled ?? false),
      autoApplyTags: patch.autoApplyTags ?? (current.autoApplyTags ?? false),
      locale: patch.locale ?? (current.locale ?? AI_CONSTANTS.DEFAULT_LOCALE),
    };

    // An empty string clears the override; absent leaves it untouched.
    const overrides: Partial<AiOverrideRow> = {};
    if (patch.baseUrl !== undefined)
      overrides.baseUrl = patch.baseUrl.trim() || null;
    if (patch.model !== undefined)
      overrides.model = patch.model.trim() || null;
    if (patch.apiKey !== undefined)
      overrides.apiKey = patch.apiKey.trim() || null;
    Object.assign(data, overrides);

    if (consenting) {
      const next = resolveEffective(
        {
          baseUrl: overrides.baseUrl ?? (row?.baseUrl ?? null),
          model: overrides.model ?? (row?.model ?? null),
          apiKey: overrides.apiKey ?? (row?.apiKey ?? null),
        },
        this.config,
      );
      data.consentedConfigKey = this.client.configKey(endpointFrom(next));
    }

    await this.prisma.userAiPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return this.find(userId);
  }

  /** Whether this person may send note content for this operation right now. */
  async assertAllowed(
    userId: string,
    operation: AiOperation,
  ): Promise<AiPreferences> {
    const prefs = await this.find(userId);
    if (!prefs.configured) {
      throw new AiError(
        'AI_DISABLED',
        'Local AI is not configured on this server.',
      );
    }
    if (!prefs.enabled) {
      throw new AiError(
        'AI_NOT_OPTED_IN',
        'Turn on AI for your account first.',
      );
    }
    if (prefs.consentRequired) {
      throw new AiError(
        'AI_NOT_OPTED_IN',
        'The AI destination changed. Review and allow it again.',
      );
    }
    if (operation === 'tags' && !prefs.taggingEnabled) {
      throw new AiError(
        'AI_OPERATION_DISABLED',
        'Tag suggestions are turned off for your account.',
      );
    }
    if (operation === 'spelling' && !prefs.spellingEnabled) {
      throw new AiError(
        'AI_OPERATION_DISABLED',
        'Spelling checks are turned off for your account.',
      );
    }
    return prefs;
  }
}
