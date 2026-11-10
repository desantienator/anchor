import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiClient } from './ai-client.service';
import { AI_CONSTANTS } from './ai.constants';
import { AiError, type AiOperation } from './ai.types';

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
}

export interface AiPreferencesPatch {
  enabled?: boolean;
  taggingEnabled?: boolean;
  spellingEnabled?: boolean;
  onSaveEnabled?: boolean;
  autoApplyTags?: boolean;
  locale?: string;
  consent?: boolean;
}

@Injectable()
export class AiPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiClient,
  ) {}

  async find(userId: string): Promise<AiPreferences> {
    const row = await this.prisma.userAiPreferences.findUnique({
      where: { userId },
    });
    const configKey = this.client.configKey();
    return {
      enabled: row?.enabled ?? false,
      taggingEnabled: row?.taggingEnabled ?? true,
      spellingEnabled: row?.spellingEnabled ?? true,
      onSaveEnabled: row?.onSaveEnabled ?? false,
      autoApplyTags: row?.autoApplyTags ?? false,
      locale: row?.locale ?? AI_CONSTANTS.DEFAULT_LOCALE,
      consentedConfigKey: row?.consentedConfigKey ?? null,
      consentRequired:
        (row?.enabled ?? false) &&
        !!configKey &&
        row?.consentedConfigKey !== configKey,
    };
  }

  /**
   * Enabling, or consenting, records the current destination and model, so a
   * later configuration change shows up as consent that no longer applies.
   */
  async update(
    userId: string,
    patch: AiPreferencesPatch,
  ): Promise<AiPreferences> {
    const current = await this.find(userId);
    const consenting =
      patch.consent === true || (patch.enabled === true && !current.enabled);
    const data = {
      enabled: patch.enabled ?? current.enabled,
      taggingEnabled: patch.taggingEnabled ?? current.taggingEnabled,
      spellingEnabled: patch.spellingEnabled ?? current.spellingEnabled,
      onSaveEnabled: patch.onSaveEnabled ?? current.onSaveEnabled,
      autoApplyTags: patch.autoApplyTags ?? current.autoApplyTags,
      locale: patch.locale ?? current.locale,
      ...(consenting ? { consentedConfigKey: this.client.configKey() } : {}),
    };

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
    if (!this.client.settings.enabled) {
      throw new AiError(
        'AI_DISABLED',
        'Local AI is not configured on this server.',
      );
    }

    const prefs = await this.find(userId);
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
