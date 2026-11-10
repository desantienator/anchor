import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiClient } from './ai-client.service';
import { AiPreferencesService } from './ai-preferences.service';
import { AiAnalysisService } from './ai-analysis.service';
import { AnalyzeNoteDto, UpdateAiPreferencesDto } from './dto/ai.dto';
import { AiError } from './ai.types';

/** Aborts provider work when the client goes away. */
function abortOnDisconnect(request: Request): AbortSignal {
  const controller = new AbortController();
  request.on('close', () => controller.abort());
  return controller.signal;
}

/**
 * The analysed snapshot is identified by the `x-note-version` header, so the
 * body stays about the operation. A missing version is rejected rather than
 * silently analysing whatever happens to be current.
 */
function baseVersionOf(request: Request): number {
  const raw = request.header('x-note-version');
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new AiError(
      'AI_STALE_SNAPSHOT',
      'Reload this note before asking for suggestions.',
    );
  }
  return version;
}

/** Host and path only; credentials in a URL are never echoed to clients. */
function displayedOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

@Controller('api/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(
    private readonly preferences: AiPreferencesService,
    private readonly analysis: AiAnalysisService,
    private readonly client: AiClient,
  ) {}

  @Get('preferences')
  getPreferences(@CurrentUser('id') userId: string) {
    return this.preferences.find(userId);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAiPreferencesDto,
  ) {
    return this.preferences.update(userId, dto);
  }

  /** What the server offers, without ever revealing the key. */
  @Get('capabilities')
  capabilities() {
    const settings = this.client.settings;
    return {
      configured: settings.enabled,
      baseUrl: settings.enabled ? displayedOrigin(settings.baseUrl) : null,
      model: settings.enabled ? settings.model : null,
      timeoutMs: settings.timeoutMs,
    };
  }

  @Post('notes/:noteId/analyze')
  analyze(
    @CurrentUser('id') userId: string,
    @Param('noteId') noteId: string,
    @Body() dto: AnalyzeNoteDto,
    @Req() request: Request,
  ) {
    const operation = dto.operation ?? 'tags';
    return this.analysis.analyze(
      userId,
      noteId,
      operation,
      baseVersionOf(request),
      abortOnDisconnect(request),
    );
  }
}
