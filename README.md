# Tailor — Backend API

AI-powered resume analysis backend. Upload a resume + job description, get a structured fit score, keyword gaps, and rewrite suggestions in under 60 seconds.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Architecture Diagram](#architecture-diagram)
- [Completed Flows](#completed-flows)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Running Tests](#running-tests)
- [API Overview](#api-overview)
- [Security Model](#security-model)

---

## Quick Start

**Prerequisites:** Node 22, pnpm, PostgreSQL 16, Redis 7

```bash
# 1. Clone and install
pnpm install

# 2. Start infrastructure (PostgreSQL + Redis)
docker compose up -d
# OR use your local installs:
brew services start postgresql@16 redis

# 3. Set up environment
cp .env.example .env
# Fill in DATABASE_URL, REDIS_URL, JWT keys, LLM API key

# 4. Generate RSA keys for JWT signing
pnpm keys:generate          # writes keys/private.pem + keys/public.pem

# 5. Migrate DB and seed templates
node_modules/.bin/prisma migrate dev --url "$DATABASE_URL"
pnpm prisma:seed

# 6. Start dev server
pnpm start:dev
# → http://localhost:3001/api
# → http://localhost:3001/api/docs  (Swagger UI)
```

---

## How It Works

### The Core Analysis Flow

```
User uploads resume.pdf + pastes JD text
            │
            ▼
POST /api/analysis
  [1] Multer receives file buffer in RAM (never touches disk)
  [2] file-type reads magic bytes — rejects if MIME ≠ PDF/DOCX
  [3] pdf-parse or mammoth extracts plain text from buffer
  [4] Buffer is released — NEVER stored anywhere
  [5] Analysis row created in PostgreSQL (status: "pending")
  [6] BullMQ job enqueued with { analysisId, resumeText, jdText }
  [7] Returns { jobId, pollUrl } immediately (HTTP 202)
            │
            ▼ (asynchronous — in BullMQ worker)
BullMQ Worker (AnalysisProcessor)
  [8]  status → "processing"
  [9]  LLM call: GPT-4o / Claude Sonnet (10–45 seconds)
  [10] JSON result parsed and validated
  [11] status → "completed", result stored as JSONB in PostgreSQL
  [12] If user is authenticated: auto-create history entry
            │
            ▼ (client polls)
GET /api/analysis/:jobId
  → { status: "pending" | "processing" | "completed" | "failed" }
  → On "completed": full AnalysisResult payload included
```

### Why No S3?

The resume file has no value after parsing. Only the extracted text (2–8 KB) is stored. There is no file download, no file viewer, no S3 — just plain text in a `TEXT` column in PostgreSQL. Re-analysis means re-uploading.

### Authentication Flow

```
1. Frontend → GET /api/auth/google/authorize
   Backend generates CSRF state, stores in Redis (TTL 5 min)
   Returns { authUrl: "https://accounts.google.com/..." }

2. User approves at Google

3. Google → GET /api/auth/google/callback?code=...&state=...
   Backend: validates CSRF state (consumed from Redis)
           exchanges code for id_token at Google
           verifies id_token signature
           upserts user in PostgreSQL
           issues RS256 JWT (15 min) + opaque refresh token (30 days)
           refresh token stored in Redis: SET refresh:{uuid} {userId}
           Sets HttpOnly cookie: refresh_token={uuid}
   Redirects → {FRONTEND_URL}/auth/callback?access_token=...&expires_in=900

4. Frontend stores access_token in memory (NOT localStorage)
   Sends on all requests: Authorization: Bearer {access_token}

5. On 401 or token expiry → POST /api/auth/refresh
   Browser automatically sends the HttpOnly refresh_token cookie
   Backend: rotates refresh token atomically in Redis
           issues new access_token
           sets new refresh_token cookie

6. POST /api/auth/logout
   Backend: DEL refresh:{token} from Redis (immediate kill)
           Adds JTI to blacklist in Redis (TTL = remaining access token TTL)
           Clears cookie
```

---

## Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                            │
│  React SPA — stores access_token in memory, refresh_token in       │
│  HttpOnly cookie (JS cannot read it)                               │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                    NestJS API Server (Port 3001)                   │
│                                                                    │
│  ┌─────────────────── Middleware Stack ───────────────────────┐   │
│  │ [1] Helmet → CSP, HSTS, nosniff, frame-deny               │   │
│  │ [2] CORS  → strict origin allowlist, credentials: true     │   │
│  │ [3] RequestIdMiddleware → X-Request-ID on every request    │   │
│  │ [4] ThrottlerGuard → rate limits via Redis counters        │   │
│  │ [5] JwtAuthGuard → RS256 verify + JTI blacklist check      │   │
│  │ [6] RolesGuard → @Roles() decorator enforcement            │   │
│  │ [7] ValidationPipe → whitelist + forbidNonWhitelisted      │   │
│  │ [8] ParseFilePipe → MIME magic bytes check on uploads      │   │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │ AuthModule   │  │ UsersModule  │  │    AnalysisModule     │   │
│  │              │  │              │  │                       │   │
│  │ /auth/*      │  │ /users/me    │  │ /analysis (POST)      │   │
│  │ Google OAuth │  │ GET/PUT/DEL  │  │ /analysis/:jobId (GET)│   │
│  │ GitHub OAuth │  │              │  │ /analysis (GET list)  │   │
│  │ FB OAuth     │  │              │  │                       │   │
│  │ JWT issue    │  │              │  │ ┌─────────────────┐   │   │
│  │ Refresh rot. │  │              │  │ │ ResumeParser    │   │   │
│  └──────────────┘  └──────────────┘  │ │ pdf-parse/mamm.│   │   │
│                                       │ └────────┬────────┘   │   │
│  ┌──────────────┐  ┌──────────────┐  │          │            │   │
│  │HistoryModule │  │TemplatesModule│  │ ┌────────▼────────┐   │   │
│  │              │  │               │  │ │  BullMQ Queue   │   │   │
│  │ /history     │  │ /templates    │  │ │  (Redis-backed) │   │   │
│  │ GET/PUT/DEL  │  │ GET (public)  │  │ └────────┬────────┘   │   │
│  │ IDOR safe    │  │ Redis cached  │  │          │            │   │
│  └──────────────┘  └──────────────┘  │ ┌────────▼────────┐   │   │
│                                       │ │AnalysisProcessor│   │   │
│                                       │ │ LlmService      │   │   │
│                                       │ │ OpenAI/Anthropic│   │   │
│                                       │ └─────────────────┘   │   │
│                                       └───────────────────────┘   │
└──────────────────────┬───────────────────────┬────────────────────┘
                       │                       │
           ┌───────────▼──────────┐  ┌─────────▼──────────────┐
           │   PostgreSQL 16      │  │      Redis 7            │
           │                      │  │                         │
           │  users               │  │  refresh:{uuid}         │
           │  oauth_accounts      │  │  csrf:{state}           │
           │  analyses (JSONB)    │  │  jti_blacklist:{jti}    │
           │  history_entries     │  │  bull:analysis:*        │
           │  templates           │  │  templates:all          │
           │                      │  │  throttle counters      │
           └──────────────────────┘  └─────────────────────────┘
                                                │
                                     ┌──────────▼──────────────┐
                                     │   External LLM APIs      │
                                     │  OpenAI GPT-4o           │
                                     │  Anthropic Claude Sonnet │
                                     └─────────────────────────┘
```

### Request Lifecycle (single request)

```
Browser request
    │
    ├─ Helmet sets security headers on response
    ├─ CORS preflight validated
    ├─ X-Request-ID attached (from header or generated)
    ├─ Rate limit checked against Redis counter
    ├─ JWT verified (RS256 public key + JTI blacklist)
    ├─ Role checked if route has @Roles()
    ├─ DTO validated (whitelist strips unknown fields)
    ├─ File MIME checked via magic bytes (upload routes)
    ├─ Controller handler executes
    ├─ TransformInterceptor wraps response in { data, meta }
    └─ LoggingInterceptor logs duration + status code
```

---

## Completed Flows

### Flow 1 — New User Sign-In (Google OAuth)

```
[Browser]           [Backend]                  [Google]          [PostgreSQL] [Redis]
    │                   │                          │                   │          │
    │──GET /authorize──▶│                          │                   │          │
    │                   │──generate CSRF state─────│                   │          │
    │                   │──SET csrf:{state}────────│───────────────────│─────────▶│
    │◀──{ authUrl }─────│                          │                   │          │
    │                   │                          │                   │          │
    │──redirect to Google OAuth page───────────────▶                   │          │
    │◀──user approves, redirect to /callback?code=...&state=...        │          │
    │                   │                          │                   │          │
    │──GET /callback────▶│                         │                   │          │
    │                   │──GET csrf:{state}────────│───────────────────│─────────▶│
    │                   │◀─ "1" (valid) ───────────│───────────────────│──────────│
    │                   │──DEL csrf:{state}────────│───────────────────│─────────▶│
    │                   │──POST token exchange─────▶                   │          │
    │                   │◀── id_token ─────────────                    │          │
    │                   │──verify id_token sig─────▶                   │          │
    │                   │──UPSERT user─────────────│──────────────────▶│          │
    │                   │──issue JWT + refresh──────│                   │          │
    │                   │──SET refresh:{uuid} userId│───────────────────│─────────▶│
    │◀─302 + Set-Cookie: refresh_token (HttpOnly)───│                   │          │
    │──location: /auth/callback?access_token=...    │                   │          │
```

### Flow 2 — Resume Analysis (Authenticated)

```
[Browser]           [Backend HTTP]         [BullMQ Worker]    [PostgreSQL] [OpenAI]
    │                   │                        │                  │          │
    │──POST /analysis───▶│                       │                  │          │
    │  (PDF + JD text)   │                       │                  │          │
    │                   │──[validate MIME]        │                  │          │
    │                   │──[parse PDF text]       │                  │          │
    │                   │──INSERT analysis────────│─────────────────▶│          │
    │                   │   { status: pending }   │                  │          │
    │                   │──queue.add(analysisId)─▶│                  │          │
    │◀─ 202 { jobId }───│                         │                  │          │
    │                   │                         │──status→processing│          │
    │──GET /analysis/:jobId (poll) ──────────────▶│                  │          │
    │◀─ { status: "processing" }──────────────────│                  │          │
    │                   │                         │──POST chat/completions──────▶│
    │                   │                         │◀── JSON result ─────────────│
    │                   │                         │──status→completed│           │
    │                   │                         │──INSERT history_entry        │
    │──GET /analysis/:jobId (poll) ──────────────▶│                  │          │
    │◀─ { status: "completed", result: {...} }─────│                  │          │
```

### Flow 3 — Token Refresh (Silent)

```
[Browser]              [Backend]                          [Redis]
    │                      │                                 │
    │  (access_token expires or 401 received)                │
    │──POST /auth/refresh──▶│                                │
    │  Cookie: refresh_token={uuid}                          │
    │                      │──GET refresh:{uuid}────────────▶│
    │                      │◀─ {userId} ─────────────────────│
    │                      │──DEL refresh:{old_uuid}─────────▶│
    │                      │──SET refresh:{new_uuid} {userId}▶│
    │◀─ 200 { access_token, expires_in: 900 }               │
    │  Set-Cookie: refresh_token={new_uuid}                  │
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Built-in `crypto.randomUUID()`, native fetch, long-term support |
| Framework | NestJS 11 | Modules, DI, decorators, Passport integration, first-class TypeScript |
| Language | TypeScript 5.7 | Type-safe request/response contracts across the full stack |
| Database | PostgreSQL 16 | Relational integrity for users ↔ analyses ↔ history; JSONB for LLM output |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Type-safe generated client; clean migration workflow |
| Cache + Sessions | Redis 7 | Refresh tokens, CSRF state, JTI blacklist, rate limit counters, template cache |
| Job Queue | BullMQ (Redis-backed) | Decouples HTTP from 10–45s LLM calls; prevents timeouts; retries on failure |
| Auth | JWT RS256 + OAuth 2.0 | Asymmetric signing; OAuth for Google/GitHub/Facebook; no passwords stored |
| LLM | OpenAI GPT-4o / Anthropic Claude (switchable) | `LLM_PROVIDER` env var switches providers with zero code change |
| File Parsing | `pdf-parse@1` + `mammoth` | In-memory extraction; no disk writes; no S3 |
| Validation | `class-validator` + `class-transformer` | Declarative DTO decorators; `whitelist: true` strips unknown fields |
| Security | Helmet, `@nestjs/throttler` | CSP headers, rate limiting, HSTS |

---

## Project Structure

```
src/
├── main.ts                          # Server bootstrap (Helmet, CORS, cookie-parser, Swagger)
├── app.module.ts                    # Root module — wires everything together
│
├── config/
│   └── env.validation.ts            # Joi schema — server refuses to start with missing vars
│
├── prisma/
│   ├── prisma.module.ts             # Global PrismaModule (available everywhere)
│   └── prisma.service.ts            # PrismaClient with PG adapter + shutdown hooks
│
├── common/
│   ├── decorators/
│   │   └── current-user.decorator.ts    # @CurrentUser() → req.user
│   ├── filters/
│   │   └── http-exception.filter.ts     # Maps Prisma errors + all exceptions → standard shape
│   ├── interceptors/
│   │   ├── transform.interceptor.ts     # Wraps 2xx in { data, meta }
│   │   └── logging.interceptor.ts       # Logs method + URL + duration + status
│   ├── middleware/
│   │   └── request-id.middleware.ts     # Attaches X-Request-ID to every request
│   └── pipes/
│       └── parse-file.pipe.ts           # MIME magic-byte validation for uploads
│
└── modules/
    ├── auth/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts           # /authorize, /callback, /refresh, /logout
    │   ├── auth.service.ts              # Token issuance, refresh rotation, CSRF state
    │   ├── strategies/
    │   │   ├── jwt.strategy.ts          # Passport RS256 JWT — validates Bearer tokens
    │   │   ├── google.strategy.ts       # passport-google-oauth20
    │   │   ├── github.strategy.ts       # passport-github2
    │   │   └── facebook.strategy.ts     # passport-facebook
    │   ├── guards/
    │   │   ├── jwt-auth.guard.ts        # Global guard — enforces JWT; skips @Public() routes
    │   │   ├── optional-jwt.guard.ts    # For routes that accept both anon + auth
    │   │   └── roles.guard.ts           # @Roles('admin') enforcement
    │   ├── decorators/
    │   │   ├── public.decorator.ts      # @Public() — skips JwtAuthGuard
    │   │   └── roles.decorator.ts       # @Roles('admin')
    │   └── dev-auth/
    │       └── dev-auth.controller.ts   # POST /auth/dev/login (non-production only)
    │
    ├── users/
    │   ├── users.controller.ts          # GET/PUT/DELETE /users/me
    │   ├── users.service.ts
    │   └── users.repository.ts          # All Prisma queries for users table
    │
    ├── analysis/
    │   ├── analysis.controller.ts       # POST /analysis, GET /analysis/:jobId, GET /analysis
    │   ├── analysis.service.ts          # Orchestrates: parse → enqueue → return jobId
    │   ├── analysis.repository.ts       # All Prisma queries for analyses table
    │   ├── analysis.processor.ts        # BullMQ worker: LLM call → persist result
    │   ├── parsers/
    │   │   ├── resume-parser.service.ts # Routes to PDF or DOCX parser
    │   │   ├── pdf.parser.ts            # pdf-parse library
    │   │   └── docx.parser.ts           # mammoth library
    │   ├── scraper/
    │   │   └── jd-scraper.service.ts    # Playwright — scrapes JD from URL with SSRF protection
    │   └── llm/
    │       ├── llm.interface.ts         # ILlmService contract + AnalysisResult type
    │       ├── llm.module.ts            # Binds provider via LLM_PROVIDER env
    │       ├── openai.service.ts        # GPT-4o with JSON mode
    │       ├── anthropic.service.ts     # Claude Sonnet
    │       └── prompt.ts                # Versioned prompt builder
    │
    ├── history/
    │   ├── history.controller.ts        # GET/PUT/DELETE /history and /history/:id
    │   ├── history.service.ts
    │   └── history.repository.ts
    │
    └── templates/
        ├── templates.controller.ts      # GET /templates (public, Redis-cached)
        └── templates.service.ts
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. The server refuses to start if required variables are missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development \| staging \| production \| test` |
| `PORT` | No | `3001` | HTTP listen port |
| `FRONTEND_URL` | **Yes** | — | Exact origin for CORS (e.g. `http://localhost:5173`) |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `REDIS_URL` | **Yes** | — | Redis connection string |
| `JWT_PRIVATE_KEY` | **Yes** | — | RS256 private key PEM (newlines as `\n`) |
| `JWT_PUBLIC_KEY` | **Yes** | — | RS256 public key PEM (newlines as `\n`) |
| `JWT_ACCESS_TOKEN_TTL` | No | `900` | Access token lifetime in seconds |
| `JWT_REFRESH_TOKEN_TTL` | No | `2592000` | Refresh token lifetime in seconds (30 days) |
| `LLM_PROVIDER` | No | `openai` | `openai \| anthropic` |
| `OPENAI_API_KEY` | If using OpenAI | — | `sk-proj-...` |
| `ANTHROPIC_API_KEY` | If using Anthropic | — | `sk-ant-...` |
| `GOOGLE_CLIENT_ID` | For Google OAuth | — | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | For Google OAuth | — | |
| `GITHUB_CLIENT_ID` | For GitHub OAuth | — | From GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | For GitHub OAuth | — | |

Generate RSA keys:
```bash
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
# Then paste the PEM content with newlines replaced by \n in your .env
```

---

## Running Tests

```bash
# Start infrastructure first
docker compose up -d   # OR: brew services start postgresql@16 redis

# Run all 67 integration tests (real HTTP, real DB, real Redis, mocked LLM)
pnpm test:integration
```

The integration tests:
- Start a full NestJS app (real DB, real Redis, real BullMQ)
- Mock only the LLM provider (to avoid API costs and flakiness)
- Mock the PDF parser (to avoid needing valid PDFs in tests)
- Clean the database between every test
- Use a fixed dev user UUID `00000000-0000-0000-0000-000000000001`

---

## API Overview

All endpoints are prefixed with `/api`. All responses use `{ data: ..., meta: { requestId, timestamp } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/:provider/authorize` | Public | Start OAuth flow |
| GET | `/auth/:provider/callback` | Public | OAuth callback handler |
| POST | `/auth/refresh` | Cookie | Rotate refresh token |
| POST | `/auth/logout` | JWT | Invalidate session |
| POST | `/auth/dev/login` | Public (non-prod) | Get token for dev user |
| GET | `/users/me` | JWT | Get own profile |
| PUT | `/users/me` | JWT | Update full name |
| DELETE | `/users/me` | JWT | Soft-delete account |
| POST | `/analysis` | Optional JWT | Submit resume + JD |
| GET | `/analysis/:jobId` | Optional JWT | Poll analysis status |
| GET | `/analysis` | JWT | List own analyses |
| GET | `/history` | JWT | List history (filterable) |
| PUT | `/history/:id` | JWT | Update status/tag |
| DELETE | `/history/:id` | JWT | Delete single entry |
| DELETE | `/history` | JWT | Clear all history |
| GET | `/templates` | Public | List active templates |
| GET | `/api/docs` | Public | Swagger UI |

---

## Security Model

- **No passwords** — OAuth only (Google, GitHub, Facebook). Never store user credentials.
- **Short-lived JWTs** — 15-minute access tokens. Stolen tokens expire quickly.
- **Rotating refresh tokens** — every use issues a new token and destroys the old one. A stolen token self-invalidates on the next legitimate use.
- **HttpOnly cookies** — the refresh token lives in an HttpOnly cookie. JavaScript cannot read it.
- **RS256 (asymmetric JWT)** — private key signs, public key verifies. Future services can verify tokens without access to the signing secret.
- **SSRF protection** — JD URL scraping validates that the resolved IP is not RFC1918/localhost.
- **IDOR protection** — all user-data queries include `WHERE user_id = req.user.userId`. A mismatch returns 404, not 403 (doesn't leak existence).
- **Input whitelist** — `ValidationPipe` with `whitelist: true` strips any fields not declared in the DTO. `forbidNonWhitelisted: true` returns 400 if extra fields are sent.
- **Magic-byte MIME validation** — file uploads are checked against actual byte signatures, not just the declared `Content-Type` header.
- **Rate limiting** — all routes have per-IP or per-user rate limits backed by Redis counters.
# backend
