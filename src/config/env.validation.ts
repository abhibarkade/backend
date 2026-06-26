import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  PORT: Joi.number().default(3001),
  FRONTEND_URL: Joi.string().uri().required(),
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().optional().allow(''),

  JWT_PRIVATE_KEY: Joi.string().required(),
  JWT_PUBLIC_KEY: Joi.string().required(),
  JWT_ACCESS_TOKEN_TTL: Joi.number().default(900),
  JWT_REFRESH_TOKEN_TTL: Joi.number().default(2592000),

  GOOGLE_CLIENT_ID: Joi.string().optional().allow(''),
  GOOGLE_CLIENT_SECRET: Joi.string().optional().allow(''),
  GOOGLE_CALLBACK_URL: Joi.string().optional().allow(''),

  GITHUB_CLIENT_ID: Joi.string().optional().allow(''),
  GITHUB_CLIENT_SECRET: Joi.string().optional().allow(''),
  GITHUB_CALLBACK_URL: Joi.string().optional().allow(''),

  FACEBOOK_APP_ID: Joi.string().optional().allow(''),
  FACEBOOK_APP_SECRET: Joi.string().optional().allow(''),
  FACEBOOK_CALLBACK_URL: Joi.string().optional().allow(''),

  APPLE_CLIENT_ID: Joi.string().optional().allow(''),
  APPLE_TEAM_ID: Joi.string().optional().allow(''),
  APPLE_KEY_ID: Joi.string().optional().allow(''),
  APPLE_PRIVATE_KEY: Joi.string().optional().allow(''),
  APPLE_CALLBACK_URL: Joi.string().optional().allow(''),

  LLM_PROVIDER: Joi.string().valid('openai', 'anthropic').default('openai'),
  OPENAI_API_KEY: Joi.string().optional().allow(''),
  OPENAI_MODEL: Joi.string().default('gpt-4o'),
  ANTHROPIC_API_KEY: Joi.string().optional().allow(''),
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-6'),
  LLM_REQUEST_TIMEOUT_MS: Joi.number().default(60000),
  LLM_PROMPT_VERSION: Joi.string().default('v1.0'),

  ANALYSIS_WORKER_CONCURRENCY: Joi.number().default(3),
  ANALYSIS_MAX_FILE_SIZE_BYTES: Joi.number().default(10485760),
  ANALYSIS_MAX_TEXT_CHARS: Joi.number().default(50000),

  THROTTLE_TTL_MS: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(200),
  ANALYSIS_THROTTLE_TTL_MS: Joi.number().default(900000),
  ANALYSIS_THROTTLE_LIMIT_ANON: Joi.number().default(10),
  ANALYSIS_THROTTLE_LIMIT_USER: Joi.number().default(30),
});
