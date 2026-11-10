import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { RejectUnknownFields } from '../../common/decorators/reject-unknown-fields.decorator';

@RejectUnknownFields()
export class UpdateAiPreferencesDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  taggingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  spellingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  onSaveEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  autoApplyTags?: boolean;

  // A few language tags include a region ("en-AU"), which ISO 639-1 alone
  // would reject, so validate the shape and let the model interpret it.
  @IsOptional()
  @IsString()
  @Length(2, 20)
  @Matches(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  locale?: string;

  /** Explicit agreement to send note content to the configured endpoint. */
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class AnalyzeNoteDto {
  @IsOptional()
  @IsIn(['tags', 'spelling'])
  operation?: 'tags' | 'spelling';
}
