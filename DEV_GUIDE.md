# Tailor Backend — Developer Guide

This guide is for engineers working on the backend codebase. It covers architecture decisions, module internals, common tasks, debugging, and contribution conventions.

---

## Table of Contents

- [Local Environment Setup](#local-environment-setup)
- [Project Architecture](#project-architecture)
- [Module Internals](#module-internals)
  - [Auth Module](#auth-module)
  - [Analysis Module](#analysis-module)
  - [Users Module](#users-module)
  - [History Module](#history-module)
  - [Templates Module](#templates-module)
- [Database](#database)
- [Redis Usage Map](#redis-usage-map)
- [BullMQ Job Queue](#bullmq-job-queue)
- [LLM Integration](#llm-integration)
- [Security Layers](#security-layers)
- [Request Lifecycle](#request-lifecycle)
- [Common Development Tasks](#common-development-tasks)
- [Debugging](#debugging)
- [Code Conventions](#code-conventions)
- [Adding a New Endpoint](#adding-a-new-endpoint)
- [Running Integration Tests](#running-integration-tests)

---

## Local Environment Setup

### 1. Prerequisites

```bash
node --version  # must be >= 22
pnpm --version  # must be >= 9
```

### 2. Infrastructure

```bash
# Option A: Docker (recommended)
docker compose up -d
# Creates: tailor_postgres (5432), tailor_redis (6379)

# Option B: Homebrew (macOS)
brew install postgresql@16 redis
brew services start postgresql@16 redis
psql postgres -c "CREATE USER tailor WITH PASSWORD 'tailor';"
psql postgres -c "CREATE DATABASE tailor_db OWNER tailor;"
psql postgres -c "ALTER USER tailor CREATEDB;"
```

### 3. Environment

```bash
cp .env.example .env
```

Fill in at minimum:
- `DATABASE_URL` — e.g. `postgresql://tailor:tailor@localhost:5432/tailor_db`
- `REDIS_URL` — `redis://localhost:6379`
- `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` — see below
- `LLM_PROVIDER` + appropriate API key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`)
- `FRONTEND_URL` — `http://localhost:5173`

### 4. Generate RSA keys

```bash
pnpm keys:generate
# Writes keys/private.pem and keys/public.pem
# These are gitignored. Never commit private.pem.
```

Then paste the content of each key into your `.env`, replacing real newlines with `\n`:
```bash
# Shortcut (macOS):
cat keys/private.pem | awk '{printf "%s\\n", $0}' | pbcopy
# Paste as JWT_PRIVATE_KEY=...
```

### 5. Database migration and seed

```bash
DATABASE_URL="postgresql://tailor:tailor@localhost:5432/tailor_db" \
  node_modules/.bin/prisma migrate dev

pnpm prisma:seed
# Seeds: 3 job templates + dev user (00000000-0000-0000-0000-000000000001)
```

### 6. Start dev server

```bash
pnpm start:dev
# Starts with --watch (auto-reload on file changes)
# http://localhost:3001/api
# http://localhost:3001/api/docs  (Swagger)
```

---

## Project Architecture

### Dependency graph

```
AppModule
├── ConfigModule (global)        → process.env access everywhere
├── RedisModule (global)         → @InjectRedis() DI token
├── ThrottlerModule              → rate limiting
├── BullModule (global)          → BullMQ queue connection
├── PrismaModule (global)        → PrismaService DI token
├── AuthModule
│   ├── JwtModule                → RS256 signing/verification
│   ├── PassportModule
│   ├── JwtStrategy, GoogleStrategy, GithubStrategy, FacebookStrategy
│   └── DevAuthModule (non-prod)
├── UsersModule
├── AnalysisModule
│   └── LlmModule                → OpenAiService or AnthropicService (bound by env)
├── HistoryModule
└── TemplatesModule
```

### Global providers (registered in AppModule)

| Provider token | Class | Effect |
|---|---|---|
| `APP_PIPE` | `ValidationPipe` | Runs on every controller method automatically |
| `APP_GUARD` | `JwtAuthGuard` | All routes require JWT unless decorated `@Public()` |
| `APP_GUARD` | `RolesGuard` | Routes with `@Roles('admin')` check req.user.role |
| `APP_FILTER` | `HttpExceptionFilter` | Catches all exceptions; returns standard error shape |
| `APP_INTERCEPTOR` | `TransformInterceptor` | Wraps 2xx responses in `{ data, meta }` |
| `APP_INTERCEPTOR` | `LoggingInterceptor` | Logs method, URL, status, duration per request |

Because these are registered via `APP_*` tokens in AppModule, they are automatically active in integration tests too — you do not need to manually call `useGlobalPipes()` etc. when bootstrapping in tests.

---

## Module Internals

### Auth Module

**Files:** `src/modules/auth/`

#### How JWT RS256 works here

The private key is loaded from `JWT_PRIVATE_KEY` env var (PEM format with `\n` literals). The `JwtModule.registerAsync` factory replaces `\n` literals with actual newlines before passing to `jsonwebtoken`:

```ts
privateKey: config.get<string>('JWT_PRIVATE_KEY')!.replace(/\\n/g, '\n'),
publicKey:  config.get<string>('JWT_PUBLIC_KEY')!.replace(/\\n/g, '\n'),
signOptions: { algorithm: 'RS256' },
```

**JWT payload:**
```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "user",
  "jti": "unique-per-token-uuid",
  "iat": 1718000000,
  "exp": 1718000900
}
```

The `jti` (JWT ID) is used for blacklisting on logout: `SETEX jti_blacklist:{jti} 900 "1"`.

#### JwtAuthGuard — the key piece

The global guard does double duty:
1. For **protected routes** (default): verifies JWT, populates `req.user`, rejects 401 if missing/invalid
2. For **`@Public()` routes**: *tries* to verify JWT silently (populates `req.user` if valid token present) but always returns `true` — anonymous requests pass through with `req.user = undefined`

```ts
async canActivate(context) {
  const isPublic = this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [...]);
  if (isPublic) {
    try { await super.canActivate(context); } catch { /* ignore */ }
    return true;  // always allow
  }
  return super.canActivate(context);  // enforce JWT
}
```

This is how `POST /analysis` works for both authenticated and anonymous users — the same route, but `req.user` may or may not be set.

#### OAuth callback flow

Each OAuth provider (Google, GitHub, Facebook) has a Passport strategy in `strategies/`. The strategies return a normalized user object:
```ts
{ provider: 'google', providerUserId: '...', email: '...', fullName: '...', avatarUrl: '...' }
```

`AuthService.handleOAuthCallback()` then:
1. Looks up `oauth_accounts` by `(provider, providerUserId)`
2. If not found: checks if a user with the same email exists (cross-provider account linking)
3. If still not found: creates a new user + oauth_account row
4. Issues JWT + refresh token

#### Refresh token rotation

```ts
async refreshTokens(oldToken: string) {
  const userId = await this.redis.get(`refresh:${oldToken}`);
  // ...
  const newToken = crypto.randomUUID();
  
  // Atomic: delete old, write new in a pipeline
  const pipeline = this.redis.pipeline();
  pipeline.del(`refresh:${oldToken}`);
  pipeline.set(`refresh:${newToken}`, userId, 'EX', refreshTtl);
  await pipeline.exec();
  // ...
}
```

If two requests arrive with the same refresh token simultaneously (theft detection scenario), one will get `null` from Redis and the other will succeed. The null case returns 401, which should trigger the client to re-authenticate fully.

---

### Analysis Module

**Files:** `src/modules/analysis/`

This is the core of the product. The flow:

```
HTTP layer (analysis.controller.ts)
  → File validated (ParseFilePipe, MIME magic bytes)
  → DTO validated (CreateAnalysisDto)
  → analysis.service.ts.create()

Service layer (analysis.service.ts)
  → ResumeParserService.parse(buffer)          ← pdf-parse or mammoth
  → If inputMode='link': JdScraperService.scrape(url)  ← Playwright
  → INSERT analysis row (status: pending, jobId: UUID)
  → BullMQ queue.add('analyze', { analysisId, resumeText, jdText })
  → Returns { jobId, pollUrl } immediately

Worker (analysis.processor.ts) — runs asynchronously
  → UPDATE analyses SET status='processing'
  → LlmService.analyze(resumeText, jdText)     ← OpenAI or Anthropic
  → Parse JSON response
  → UPDATE analyses SET status='completed', result={...}
  → If userId: INSERT history_entries
```

#### Job ID design

The `jobId` field on the analysis row is a UUID generated by the service (`crypto.randomUUID()`). This is NOT the BullMQ internal job ID — it's a stable client-facing poll ID. Clients use it to poll `GET /analysis/:jobId`.

The analysis row is created BEFORE enqueueing the job, so `analysisId` is included in the initial BullMQ job payload:
```ts
const analysis = await this.repo.create({ ..., jobId: pollId });
await this.queue.add('analyze', { analysisId: analysis.id, ... });
```

This avoids the race condition where the worker picks up the job before the DB row is written.

#### File parsing — in-memory only

```ts
// Multer: memoryStorage() — file buffer lives in RAM
// Never touches disk, never stored in S3
const text = await parser.parse(file.buffer, file.originalname);
// Buffer is released after this line
// Only `text` (a string) moves forward
```

The `ParseFilePipe` reads the first few bytes (magic bytes) via `file-type` to detect the real MIME type, rejecting anything that isn't PDF or DOCX regardless of the declared `Content-Type` header.

#### SSRF protection for URL mode

When `inputMode='link'`, before Playwright fetches the URL:
1. URL must be valid and HTTPS only
2. Hostname is resolved to an IP via `dns.lookup()`
3. IP is checked against private/reserved ranges:
   - `127.0.0.0/8` (localhost), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918)
   - `169.254.0.0/16` (link-local / AWS metadata endpoint at `169.254.169.254`)
   - IPv6 `::1`, `fc00:`, `fe80:`

---

### Users Module

**Files:** `src/modules/users/`

Simple CRUD on the authenticated user's own row. Key points:

- `DELETE /users/me` is a **soft delete**: sets `deleted_at = NOW()`. The row stays in the DB for 30 days to satisfy GDPR erasure grace periods.
- After soft delete, `findById` uses `WHERE deleted_at IS NULL`, so the user becomes "invisible" to the application immediately. Their access token still passes JWT verification (the guard doesn't hit the DB), but `UsersService.getMe()` returns 404.
- A scheduled cleanup job (not yet implemented) would hard-delete rows after 30 days.

---

### History Module

**Files:** `src/modules/history/`

All queries include `user_id = req.user.userId` in the WHERE clause. This is the IDOR protection:

```ts
findOneOwned(id: string, userId: string) {
  return this.prisma.historyEntry.findFirst({ where: { id, userId } });
}
```

If entry exists but belongs to another user: `findFirst` returns `null`, service throws `NotFoundException` with a 404 — not a 403. This deliberately doesn't reveal whether the ID exists at all.

---

### Templates Module

**Files:** `src/modules/templates/`

Templates are seeded data (run `pnpm prisma:seed`). The `GET /templates` endpoint is public and cached in Redis for 1 hour:

```ts
const CACHE_KEY = 'templates:all';
const CACHE_TTL = 3600; // 1 hour

async findAll() {
  const cached = await this.redis.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const templates = await this.prisma.template.findMany({ where: { isActive: true } });
  await this.redis.set(CACHE_KEY, JSON.stringify(templates), 'EX', CACHE_TTL);
  return templates;
}
```

To bust the cache after updating templates: `redis-cli DEL templates:all`

---

## Database

### Schema overview

```
users
  id UUID PK
  email VARCHAR(320) UNIQUE
  full_name VARCHAR(255)
  avatar_url TEXT
  role ENUM(user, admin) DEFAULT 'user'
  deleted_at TIMESTAMPTZ NULL    ← soft delete
  created_at, updated_at TIMESTAMPTZ

oauth_accounts
  id UUID PK
  user_id UUID FK → users(id) CASCADE
  provider ENUM(google, apple, github, facebook)
  provider_user_id VARCHAR(255)
  provider_email VARCHAR(320) NULL
  UNIQUE(provider, provider_user_id)

analyses
  id UUID PK
  user_id UUID FK → users(id) CASCADE, NULL  ← NULL for anonymous
  job_id VARCHAR(64) UNIQUE                   ← client poll ID
  status ENUM(pending, processing, completed, failed)
  resume_text TEXT NULL                        ← extracted plain text
  resume_filename VARCHAR(255) NULL
  jd_text TEXT NOT NULL
  jd_source_url TEXT NULL
  input_mode ENUM(paste, link)
  result JSONB NULL                            ← full LLM output
  prompt_version VARCHAR(20)
  llm_tokens_used INT NULL
  error_message TEXT NULL
  created_at TIMESTAMPTZ
  completed_at TIMESTAMPTZ NULL

history_entries
  id UUID PK
  user_id UUID FK → users(id) CASCADE
  analysis_id UUID FK → analyses(id) SET NULL, NULL
  role VARCHAR(255)
  company VARCHAR(255)
  location VARCHAR(255) NULL
  score SMALLINT CHECK(0-100)
  status ENUM(not_applied, applied, interviewing, offer, rejected)
  tag_label VARCHAR(100) NULL
  tag_variant ENUM(sage, clay, amber) NULL
  applied_at TIMESTAMPTZ NULL
  created_at, updated_at TIMESTAMPTZ

templates
  id UUID PK
  icon VARCHAR(10)
  icon_variant ENUM(amber, sage, clay, ink)
  name VARCHAR(255)
  description TEXT
  uses INT DEFAULT 0
  sample_jd TEXT
  sort_order SMALLINT DEFAULT 0
  is_active BOOLEAN DEFAULT true
```

### Migrations

```bash
# Create and apply a new migration
DATABASE_URL="..." node_modules/.bin/prisma migrate dev --name describe_the_change

# Apply existing migrations (production / CI)
DATABASE_URL="..." node_modules/.bin/prisma migrate deploy

# Regenerate Prisma client after schema change
DATABASE_URL="..." node_modules/.bin/prisma generate

# Open Prisma Studio (visual DB browser)
pnpm prisma:studio
```

### Useful raw queries

```sql
-- See all analyses for a user
SELECT id, job_id, status, created_at, completed_at
FROM analyses WHERE user_id = '...' ORDER BY created_at DESC;

-- See failed analyses
SELECT id, job_id, error_message, created_at
FROM analyses WHERE status = 'failed';

-- Manually soft-delete a user
UPDATE users SET deleted_at = NOW() WHERE email = 'user@example.com';

-- Count analyses by status
SELECT status, COUNT(*) FROM analyses GROUP BY status;
```

---

## Redis Usage Map

| Key pattern | Type | TTL | Written by | Used for |
|---|---|---|---|---|
| `refresh:{uuid}` | STRING | 30 days | `auth.service.ts` | Refresh token → userId mapping |
| `csrf:{state}` | STRING | 5 min | `auth.service.ts` | OAuth CSRF state (one-time) |
| `jti_blacklist:{jti}` | STRING | 15 min | `auth.service.ts` | Logout token blacklist |
| `templates:all` | STRING | 60 min | `templates.service.ts` | Template list cache |
| `throttle:*` | varies | per window | `@nestjs/throttler` | Rate limit counters |
| `bull:analysis:*` | hash/list | varies | BullMQ | Job queue internals |

```bash
# See all keys (development only — don't run on large production Redis)
redis-cli KEYS "*"

# Check if a refresh token is valid
redis-cli GET "refresh:some-uuid"

# Manually bust template cache
redis-cli DEL "templates:all"

# See all pending BullMQ jobs
redis-cli LRANGE "bull:analysis:wait" 0 -1
```

---

## BullMQ Job Queue

### Queue configuration

```ts
BullModule.registerQueueAsync({
  name: 'analysis',
  useFactory: (config) => ({
    connection: { url: config.get('REDIS_URL') },
    defaultJobOptions: {
      attempts: 3,                              // 3 total tries
      backoff: { type: 'fixed', delay: 5000 }, // 5s between retries
      removeOnComplete: { age: 86400 * 2 },    // keep completed jobs 48h
      removeOnFail: { age: 86400 * 2 },        // keep failed jobs 48h
    },
  }),
})
```

### Job flow states

```
added → wait → active → completed
                      → failed (up to 3 times, then stays failed)
```

### Monitoring queue health

```bash
# Check queue depth (how many jobs waiting)
redis-cli LLEN "bull:analysis:wait"

# See active jobs (being processed now)
redis-cli LLEN "bull:analysis:active"

# See failed jobs count
redis-cli ZCARD "bull:analysis:failed"
```

### Manually retrying a failed job

Currently requires direct Redis manipulation or a Bull Dashboard integration. To re-queue a failed analysis for debugging:
```bash
# In development: just re-submit the analysis via the API
```

---

## LLM Integration

### Switching providers

Set `LLM_PROVIDER=openai` or `LLM_PROVIDER=anthropic` in `.env`. No code changes needed. The `LlmModule` factory binds the correct service:

```ts
{
  provide: LLM_SERVICE,
  useFactory: (config, openai, anthropic) =>
    config.get('LLM_PROVIDER') === 'anthropic' ? anthropic : openai,
  inject: [ConfigService, OpenAiService, AnthropicService],
}
```

### Prompt versioning

The prompt is in `src/modules/analysis/llm/prompt.ts`. The `PROMPT_VERSION` constant (driven by `LLM_PROMPT_VERSION` env) is stored on every analysis row in `prompt_version`. This lets you compare result quality across prompt iterations in the DB.

```ts
export const PROMPT_VERSION = process.env.LLM_PROMPT_VERSION || 'v1.0';
```

### Adding a new LLM provider

1. Create `src/modules/analysis/llm/myprovider.service.ts` implementing `ILlmService`
2. Add it to `LlmModule` providers
3. Update the factory function to bind it on a new `LLM_PROVIDER` value
4. Add the env var to `env.validation.ts`

The `ILlmService` interface is the only contract:
```ts
interface ILlmService {
  analyze(resumeText: string, jdText: string): Promise<AnalysisResult>;
}
```

---

## Security Layers

### Layer-by-layer

```
1. Network: CORS (strict origin allowlist, no wildcard)
2. Transport: HTTPS (enforced by HSTS in Helmet)
3. Application: Helmet (CSP, X-Frame-Options, nosniff, etc.)
4. Rate limiting: @nestjs/throttler with Redis counters
5. Auth: JWT RS256 + JTI blacklist + rotating refresh tokens
6. Authorization: Role-based guard + ownership checks in every query
7. Input: class-validator whitelist (strips extra fields) + magic-byte MIME validation
8. Data: Prisma parameterized queries (no raw SQL injection risk)
9. SSRF: IP range blocking on JD URL scraping
```

### What each Helmet directive does

```ts
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],          // blocks all by default
      scriptSrc: ["'self'"],           // only our JS
      connectSrc: ["'self'"],          // only our API
      imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // allows CSS-in-JS
      frameAncestors: ["'none'"],       // blocks iframe embedding (clickjacking)
      upgradeInsecureRequests: [],      // force HTTPS on mixed-content
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
})
```

---

## Request Lifecycle

Every HTTP request goes through these steps in order:

```
1. CORS preflight check (app.enableCors)
2. Helmet adds security headers to response
3. cookie-parser parses Cookie header → req.cookies
4. RequestIdMiddleware: reads X-Request-ID or generates uuid4, attaches to req + response header
5. ThrottlerGuard: checks Redis rate limit counter. Returns 429 if exceeded.
6. JwtAuthGuard:
   a. If @Public(): try to verify JWT (silently), always return true
   b. If protected: verify RS256 signature, check JTI blacklist, reject 401 if invalid
7. RolesGuard: if @Roles() on route, check req.user.role. Reject 403 if insufficient.
8. ValidationPipe: validate+transform DTO. Strip unknown fields. Reject 400 if invalid.
9. ParseFilePipe (upload routes): read file magic bytes, reject 415 if not PDF/DOCX.
10. Controller method executes → returns data
11. TransformInterceptor wraps return value in { data, meta }
12. LoggingInterceptor logs the request (method, URL, status, duration, requestId)

If any step throws:
→ HttpExceptionFilter catches it
→ Maps Prisma P2002 → 409, P2025 → 404
→ Maps ValidationError → 400 with field-level errors
→ Returns standard error shape { statusCode, message, requestId, timestamp }
```

---

## Common Development Tasks

### Add a new column to a table

1. Edit `prisma/schema.prisma` — add the field
2. Run `node_modules/.bin/prisma migrate dev --name add_column_name`
3. Run `node_modules/.bin/prisma generate` to update the client types
4. Update affected repository/service files to include the new field

### Change the LLM prompt

1. Edit `src/modules/analysis/llm/prompt.ts`
2. Bump `LLM_PROMPT_VERSION` in `.env` (e.g. `v1.0` → `v1.1`)
3. New analyses will use the new prompt and be tagged with the new version
4. Old history entries retain their `prompt_version` tag — they are not recalculated

### Add a new OAuth provider

1. Install the Passport strategy: `pnpm add passport-xyz`
2. Create `src/modules/auth/strategies/xyz.strategy.ts` following the pattern of `github.strategy.ts`
3. Add the strategy to `AuthModule` providers
4. Add env vars for CLIENT_ID, CLIENT_SECRET, CALLBACK_URL to `env.validation.ts` and `.env.example`
5. Update the `OAuthProvider` enum in `prisma/schema.prisma` and run a migration

### Seed the database fresh

```bash
# Wipe and re-seed (DEVELOPMENT ONLY — destroys all data)
DATABASE_URL="..." node_modules/.bin/prisma migrate reset
pnpm prisma:seed
```

### Check what's in the queue

```bash
# Start Redis CLI
redis-cli

# List all BullMQ keys for the analysis queue
KEYS bull:analysis:*

# See job IDs waiting to be processed
LRANGE bull:analysis:wait 0 -1

# See failed job IDs
ZRANGE bull:analysis:failed 0 -1
```

---

## Debugging

### Getting request IDs into logs

Every response includes `X-Request-ID`. Every error response body includes `requestId`. When a user reports an error, ask for the `requestId` from the response and search logs for it:

```bash
# In development: NestJS logs include the requestId
grep "requestId" server.log
```

### Tracing an analysis failure

```sql
-- 1. Find the analysis by jobId (the poll ID from the API)
SELECT id, status, error_message, created_at, completed_at, prompt_version
FROM analyses WHERE job_id = 'the-poll-uuid';

-- 2. See the full result (or lack of it)
SELECT result FROM analyses WHERE job_id = 'the-poll-uuid';
```

### 401 Unauthorized — common causes

| Symptom | Likely cause | Fix |
|---|---|---|
| All requests 401 | JWT_PRIVATE_KEY/PUBLIC_KEY mismatch | Regenerate keys pair together |
| 401 after logout | Token in JTI blacklist | Expected — user must refresh |
| 401 on token from another environment | Keys don't match | Use same key pair per environment |
| 401 on valid token | JTI blacklist Redis key expired but token not yet | Race condition edge case; token will work again in <15s |

### Checking Redis state

```bash
redis-cli

# Is a specific refresh token valid?
GET "refresh:some-uuid-here"
# → "user-uuid-here" if valid, nil if expired/deleted

# Is a JWT blacklisted?
GET "jti_blacklist:some-jti-here"
# → "1" if blacklisted, nil if valid

# See template cache
GET "templates:all" | head -c 200
```

---

## Code Conventions

### File naming

- `*.module.ts` — NestJS module
- `*.controller.ts` — HTTP layer only; no business logic
- `*.service.ts` — business logic
- `*.repository.ts` — database queries only (no business logic)
- `*.processor.ts` — BullMQ job handler
- `*.dto.ts` — Data Transfer Object (validated input shape)
- `*.interface.ts` — TypeScript interfaces and constants

### What belongs where

| Layer | Rules |
|---|---|
| Controller | HTTP-specific: extract params, call service, return value. No Prisma, no Redis. |
| Service | Business logic. Calls repository and other services. No HTTP concepts. |
| Repository | Prisma queries only. No `if` statements, no transformations. |
| Processor | BullMQ job handler. Calls service or LLM. Updates DB status. |

### Comments

Write no comments by default. Only comment when the WHY is non-obvious:
- A hidden constraint or invariant
- A workaround for a specific library bug
- Something that would confuse a reader a year later

Do not write comments describing WHAT the code does (readable names do that).

### Error handling

- **Throw NestJS built-in exceptions** in services: `NotFoundException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`
- **Never throw raw `Error`** in controllers or services — always use the typed NestJS exceptions
- **The HttpExceptionFilter** handles everything automatically
- **Don't add `try/catch`** unless you're intentionally handling a specific failure case (like the JwtAuthGuard silently ignoring invalid tokens on `@Public()` routes)

---

## Adding a New Endpoint

Walk-through example: adding `GET /api/analysis/:jobId/export` that returns analysis text.

### Step 1 — DTO (if needed)

No request body needed for a GET, so skip.

### Step 2 — Repository

```ts
// analysis.repository.ts
findResultById(id: string, userId: string) {
  return this.prisma.analysis.findFirst({
    where: { id, userId },    // ownership check
    select: { result: true, status: true },
  });
}
```

### Step 3 — Service

```ts
// analysis.service.ts
async exportResult(jobId: string, userId: string) {
  const analysis = await this.repo.findByJobId(jobId);
  if (!analysis || analysis.userId !== userId) throw new NotFoundException();
  if (analysis.status !== 'completed') throw new BadRequestException('Analysis not complete yet.');
  return analysis.result;
}
```

### Step 4 — Controller

```ts
// analysis.controller.ts
@Get(':jobId/export')
exportResult(@Param('jobId') jobId: string, @CurrentUser() user: any) {
  return this.analysisService.exportResult(jobId, user.userId);
}
```

### Step 5 — Tests

Add a test in `test/integration/analysis.spec.ts`:
```ts
it('exports completed analysis result', async () => {
  // submit + wait for completion
  // GET /:jobId/export
  // assert shape
});
```

---

## Running Integration Tests

The integration tests use a real PostgreSQL + Redis. They mock only the LLM provider and the PDF parser.

```bash
# Prerequisites: PostgreSQL and Redis must be running
# Migration is run automatically by Jest globalSetup

pnpm test:integration

# Run a single test file
node_modules/.bin/jest --config jest.integration.json "auth.spec"

# Run a single test by name
node_modules/.bin/jest --config jest.integration.json -t "returns the authenticated user profile"
```

### Test structure

```
test/integration/
├── setup.ts              # bootstrapApp(), cleanTestData(), getDevToken()
├── global-setup.ts       # Runs prisma migrate deploy before all suites
├── global-teardown.ts    # Noop (cleanup is in afterAll hooks)
├── fixtures/
│   └── minimal.pdf.ts    # Mock PDF buffer + sample JD text
├── auth.spec.ts          # 10 tests: dev login, refresh rotation, logout
├── users.spec.ts         # 12 tests: get/put/delete profile
├── analysis.spec.ts      # 19 tests: upload, poll, completion, IDOR, pagination
├── history.spec.ts       # 19 tests: CRUD, search, filter, IDOR
└── templates.spec.ts     #  7 tests: public endpoint, sort, cache, envelope
```

### Why the PDF parser is mocked

`pdf-parse` requires valid PDF binary structure. Rather than ship a real PDF binary in the test fixtures and couple the tests to actual PDF parsing, the `ResumeParserService` is overridden in `bootstrapApp()`:

```ts
.overrideProvider(ResumeParserService)
.useValue({
  parse: jest.fn().mockResolvedValue('John Doe | Software Engineer\nNode.js TypeScript...'),
})
```

This keeps tests fast, deterministic, and focused on HTTP/DB behavior rather than PDF parsing.

### Dev user

A fixed UUID `00000000-0000-0000-0000-000000000001` is the default test user. It is upserted at the start of every test via `cleanTestData()`. To get a valid JWT for this user: `POST /api/auth/dev/login` (only available when `NODE_ENV !== 'production'`).
