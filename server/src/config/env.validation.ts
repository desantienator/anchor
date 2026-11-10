import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(16, {
    message:
      'JWT_SECRET must be at least 16 characters. Set a strong, random value.',
  })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  APP_URL?: string;

  @IsOptional()
  @IsString()
  DATA_DIR?: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsIn(['disabled', 'enabled', 'review'])
  USER_SIGNUP?: string;

  @IsOptional()
  @IsString()
  OIDC_ENABLED?: string;

  @IsOptional()
  @IsString()
  OIDC_PROVIDER_NAME?: string;

  @IsOptional()
  @IsString()
  OIDC_ISSUER_URL?: string;

  @IsOptional()
  @IsString()
  OIDC_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  OIDC_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  DISABLE_INTERNAL_AUTH?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AI_ENABLED?: string;

  // The API root including any prefix, for example http://ollama:11434/v1.
  @IsOptional()
  @IsString()
  AI_BASE_URL?: string;

  @IsOptional()
  @IsString()
  AI_MODEL?: string;

  @IsOptional()
  @IsString()
  AI_API_KEY?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(600000)
  AI_TIMEOUT_MS?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(512)
  @Max(2000000)
  AI_CONTEXT_TOKENS?: number;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // The container forwards AI_* even when unset (empty string). Treat those as
  // absent so numeric validation sees "not provided", not zero.
  const normalized = Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        !(key.startsWith('AI_') && typeof value === 'string' && !value.trim()),
    ),
  );

  const validated = plainToInstance(EnvironmentVariables, normalized, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}
