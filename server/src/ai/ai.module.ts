import { Module } from '@nestjs/common';
import { NotesModule } from '../notes/notes.module';
import { AuthModule } from '../auth/auth.module';
import { AiClient } from './ai-client.service';
import { AiPreferencesService } from './ai-preferences.service';
import { AiAnalysisService } from './ai-analysis.service';
import { AiController } from './ai.controller';
import { AdminAiController } from './admin-ai.controller';

@Module({
  imports: [AuthModule, NotesModule],
  controllers: [AiController, AdminAiController],
  providers: [AiClient, AiPreferencesService, AiAnalysisService],
  exports: [AiClient, AiPreferencesService, AiAnalysisService],
})
export class AiModule {}
