# Tailor Backend — Architecture Document

> **Generated from frontend reverse-engineering audit.**
> Frontend path: `/tailor-app` | Backend scaffold: NestJS 11 (Node.js + TypeScript)

---

## 1. Executive Summary

### What the App Does

**Tailor** is an AI-powered resume analysis tool. Users upload a resume (PDF/DOCX) and provide a job description (pasted text or a URL). The backend extracts plain text from the resume in-memory, feeds both texts to an LLM, scores the match, identifies keyword gaps and phrasing issues, and returns a structured analysis result. Users can persist results in a history, manage their profile, and authenticate via social OAuth providers.

### Why No S3 / File Storage?

This is a deliberate decision worth explaining in full:

> **S3 is for storing files. We are not storing files. We are storing extracted text.**

The workflow is:
```
User uploads PDF/DOCX
        │
        ▼
Multer receives file buffer in server RAM (never touches disk)
        │
        ▼
pdf-parse / mammoth extracts plain text from the buffer
        │
        ▼
Buffer is discarded — it is never saved anywhere
        │
        ▼
Extracted plain text (a few KB of characters) → stored in PostgreSQL TEXT column
```

**Why this is correct for Tailor:**
- The raw resume file has no value after text extraction. We only need the words.
- Storing files in S3 would mean: setting up IAM roles, managing presigned URLs, paying per-GB, running cleanup jobs, and handling GDPR deletion of binary blobs. All unnecessary complexity.
- A resume in plain text is 2–8 KB. Storing that in Postgres costs nothing and keeps the system simple.
- If a user wants to re-analyse with the same resume, they re-upload the file. This is expected UX for a tool like this.

**When you WOULD need S3:** If you let users download their original PDF back, display the resume in a viewer, or store profile photos. None of that is in the current product scope.

### Tech Stack Chosen

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22 LTS | Matches existing NestJS scaffold; strong ecosystem for file parsing and HTTP |
| Framework | NestJS 11 | Scaffold already committed; enforces modular architecture; first-class TypeScript; built-in DI |
| Language | TypeScript 5.7 | Type safety across request/response contracts; mirrors frontend types |
| Database | PostgreSQL 16 | Relational model suits users ↔ analyses ↔ history; JSONB for flexible LLM output; TEXT for resume content |
| ORM | Prisma 6 | Type-safe generated client; clean migration workflow; prevents raw SQL by default |
| Auth | JWT (RS256) + rotating refresh tokens + OAuth 2.0 PKCE | Asymmetric signing enables future microservices to verify tokens without the private key |
| Cache + Rate Limit | Redis 7 | Refresh token store, rate limit counters, CSRF state, result cache — one dependency handles all |
| Job Queue | BullMQ (Redis-backed) | Analysis is LLM-bound (10–45 s); async queue decouples HTTP from LLM latency; prevents timeouts |
| LLM | OpenAI GPT-4o / Anthropic Claude (switchable) | Provider-agnostic interface; frontier model quality needed for nuanced scoring |
| Web Scraping | Playwright (headless Chromium) | "Use a link" mode needs JS-rendered job pages; handles SPAs that Axios/Cheerio cannot |
| Validation | class-validator + class-transformer | Native NestJS integration; declarative DTOs; strips unknown fields automatically |

### Key Architectural Decisions

1. **No file storage** — resumes are parsed in-memory and only the extracted text is persisted in PostgreSQL.
2. **RS256 JWT** (asymmetric) instead of HS256 — private key signs, public key verifies. Allows future read-only services to validate tokens without access to the signing secret.
3. **Analysis is async** — `POST /api/analysis` enqueues a BullMQ job and returns a `jobId` immediately. Client polls `GET /api/analysis/:jobId`. This prevents HTTP timeouts on LLM calls.
4. **Refresh token rotation** — every use of a refresh token issues a new one and atomically invalidates the old one in Redis. Stolen tokens self-invalidate on the next legitimate use.
5. **Defence in depth** — security controls exist at every layer: network (CORS), protocol (HTTPS/HSTS), application (Helmet, rate limiting, validation), data (parameterised queries), and auth (short-lived JWTs, HttpOnly cookies).

---

## 2. Tech Stack

```
Runtime:         Node.js 22 LTS
Framework:       NestJS 11
Language:        TypeScript 5.7
Database:        PostgreSQL 16 (primary), Redis 7 (sessions + cache + queue)
ORM:             Prisma 6
File Storage:    NONE — extracted text stored in PostgreSQL TEXT columns
Auth:            JWT (RS256, asymmetric), OAuth 2.0 PKCE (Google, Apple, GitHub, Facebook)
LLM:             OpenAI GPT-4o / Anthropic Claude Sonnet (switchable via env)
Queue:           BullMQ (backed by Redis)
Scraper:         Playwright (JD URL extraction)
Validation:      class-validator + class-transformer
Security:        Helmet, @nestjs/throttler, express-mongo-sanitize, hpp
Logging:         pino + pino-http (structured JSON)
Testing:         Jest (unit), Supertest (e2e)
```

---

## 3. Project Structure

```
backend/
├── src/
│   ├── main.ts                            # Bootstrap: Helmet, CORS, pipes, Swagger, shutdown hooks
│   ├── app.module.ts                      # Root module
│   │
│   ├── config/
│   │   ├── config.module.ts               # NestJS ConfigModule with env validation
│   │   └── env.validation.ts              # Joi schema — startup fails if required vars missing
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts         # /authorize, /callback, /refresh, /logout
│   │   │   ├── auth.service.ts            # Token issuance, refresh rotation, CSRF state
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts        # Passport JWT — validates RS256 Bearer tokens
│   │   │   │   ├── google.strategy.ts     # passport-google-oauth20
│   │   │   │   ├── apple.strategy.ts      # passport-apple
│   │   │   │   ├── github.strategy.ts     # passport-github2
│   │   │   │   └── facebook.strategy.ts   # passport-facebook
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts      # Enforce JWT on protected routes
│   │   │   │   ├── optional-jwt.guard.ts  # Allow anon but attach user if token present
│   │   │   │   └── roles.guard.ts         # Enforce @Roles() decorator
│   │   │   ├── decorators/
│   │   │   │   ├── public.decorator.ts    # @Public() — skip JwtAuthGuard
│   │   │   │   └── roles.decorator.ts     # @Roles('admin')
│   │   │   └── dto/
│   │   │       ├── oauth-callback.dto.ts
│   │   │       └── token-response.dto.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts        # GET/PUT/DELETE /users/me
│   │   │   ├── users.service.ts
│   │   │   ├── users.repository.ts        # All Prisma queries for users table
│   │   │   └── dto/
│   │   │       └── update-profile.dto.ts
│   │   │
│   │   ├── analysis/
│   │   │   ├── analysis.module.ts
│   │   │   ├── analysis.controller.ts     # POST /analysis, GET /analysis/:jobId, GET /analysis
│   │   │   ├── analysis.service.ts        # Orchestrates: parse → scrape → enqueue → store
│   │   │   ├── analysis.repository.ts     # All Prisma queries for analyses table
│   │   │   ├── analysis.processor.ts      # BullMQ worker: parse → LLM → persist
│   │   │   ├── parsers/
│   │   │   │   ├── resume-parser.service.ts   # Routes to PDF or DOCX parser
│   │   │   │   ├── pdf.parser.ts              # pdf-parse library
│   │   │   │   └── docx.parser.ts             # mammoth library
│   │   │   ├── scraper/
│   │   │   │   └── jd-scraper.service.ts      # Playwright — scrape JD from URL
│   │   │   ├── llm/
│   │   │   │   ├── llm.interface.ts           # ILlmService contract
│   │   │   │   ├── llm.module.ts              # Binds provider via LLM_PROVIDER env
│   │   │   │   ├── openai.service.ts
│   │   │   │   └── anthropic.service.ts
│   │   │   └── dto/
│   │   │       ├── create-analysis.dto.ts
│   │   │       └── analysis-result.dto.ts
│   │   │
│   │   ├── history/
│   │   │   ├── history.module.ts
│   │   │   ├── history.controller.ts      # GET /history, PUT /history/:id, DELETE /history(/:id)
│   │   │   ├── history.service.ts
│   │   │   └── history.repository.ts
│   │   │
│   │   └── templates/
│   │       ├── templates.module.ts
│   │       ├── templates.controller.ts    # GET /templates (public)
│   │       └── templates.service.ts       # Returns DB-seeded templates; Redis-cached
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts  # @CurrentUser() → req.user
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts   # Global error → standard shape
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts     # Log duration + status per request
│   │   │   └── transform.interceptor.ts   # Wrap 2xx in { data, meta }
│   │   ├── middleware/
│   │   │   └── request-id.middleware.ts   # Attach X-Request-ID (uuid4) to every request
│   │   └── pipes/
│   │       └── parse-file.pipe.ts         # Validate MIME type + file size on upload
│   │
│   └── prisma/
│       ├── prisma.module.ts               # Global PrismaModule (forRoot)
│       └── prisma.service.ts              # PrismaClient with shutdown hooks
│
├── prisma/
│   ├── schema.prisma                      # Source of truth for all DB tables
│   ├── seed.ts                            # Seed templates table
│   └── migrations/
│
├── test/
│   ├── auth.e2e-spec.ts
│   ├── analysis.e2e-spec.ts
│   └── jest-e2e.json
│
├── keys/
│   ├── private.pem                        # RS256 signing key — NEVER commit; gitignored
│   └── public.pem                         # RS256 verification key — can be public
│
├── .env.example                           # All vars with comments; no real values
├── .gitignore                             # Must include: .env, keys/private.pem, dist/
├── Dockerfile
└── ARCHITECTURE.md                        # ← this file
```

---

## 4. Database Schema

### Design Principles

- No binary file data stored anywhere — all `TEXT` columns contain plain strings.
- `resume_text` and `jd_text` store only the extracted plain text, not the original file.
- `analyses.result` is `JSONB` — the LLM response shape may evolve; JSONB avoids schema migrations on prompt changes.
- Soft delete via `deleted_at` on the `users` table to support GDPR 30-day purge windows.

---

### `users`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `email` | `VARCHAR(320)` | UNIQUE, NOT NULL |
| `full_name` | `VARCHAR(255)` | NOT NULL |
| `avatar_url` | `TEXT` | NULLABLE |
| `role` | `ENUM('user','admin')` | NOT NULL, DEFAULT `'user'` |
| `deleted_at` | `TIMESTAMPTZ` | NULLABLE — soft delete; purge after 30 days |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() |

**Indexes:** `email` (unique), `deleted_at` (partial index: `WHERE deleted_at IS NULL` for all live-user queries)

---

### `oauth_accounts`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id` ON DELETE CASCADE |
| `provider` | `ENUM('google','apple','github','facebook')` | NOT NULL |
| `provider_user_id` | `VARCHAR(255)` | NOT NULL |
| `provider_email` | `VARCHAR(320)` | NULLABLE — email returned by provider |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() |

> **Note:** Provider access tokens and refresh tokens are NOT stored. They are used only during the OAuth callback to fetch the user profile and then discarded. We have no need to act on the user's behalf with the provider after signup.

**Indexes:** `(provider, provider_user_id)` UNIQUE composite; `user_id` FK

---

### `analyses`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id` ON DELETE CASCADE, NULLABLE (anonymous) |
| `job_id` | `VARCHAR(64)` | UNIQUE — BullMQ job ID used by client to poll |
| `status` | `ENUM('pending','processing','completed','failed')` | NOT NULL, DEFAULT `'pending'` |
| `resume_text` | `TEXT` | NULLABLE — extracted plain text from uploaded file |
| `resume_filename` | `VARCHAR(255)` | NULLABLE — original filename for display only |
| `jd_text` | `TEXT` | NOT NULL — pasted text or scraped from URL |
| `jd_source_url` | `TEXT` | NULLABLE — set when input_mode = 'link' |
| `input_mode` | `ENUM('paste','link')` | NOT NULL |
| `result` | `JSONB` | NULLABLE — full `AnalysisResult` payload from LLM |
| `prompt_version` | `VARCHAR(20)` | NOT NULL — e.g., `'v1.2'`; allows comparing results across prompt iterations |
| `llm_tokens_used` | `INTEGER` | NULLABLE — for cost tracking |
| `error_message` | `TEXT` | NULLABLE |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() |
| `completed_at` | `TIMESTAMPTZ` | NULLABLE |

**Indexes:** `user_id`, `job_id` (unique), `status`, `created_at DESC`, `prompt_version`

---

### `history_entries`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | FK → `users.id` ON DELETE CASCADE |
| `analysis_id` | `UUID` | FK → `analyses.id` ON DELETE SET NULL, NULLABLE |
| `role` | `VARCHAR(255)` | NOT NULL |
| `company` | `VARCHAR(255)` | NOT NULL |
| `location` | `VARCHAR(255)` | NULLABLE |
| `score` | `SMALLINT` | CHECK (`score BETWEEN 0 AND 100`) |
| `status` | `ENUM('not-applied','applied','interviewing','offer','rejected')` | NOT NULL, DEFAULT `'not-applied'` |
| `tag_label` | `VARCHAR(100)` | NULLABLE |
| `tag_variant` | `ENUM('sage','clay','amber')` | NULLABLE |
| `applied_at` | `TIMESTAMPTZ` | NULLABLE |
| `created_at` | `TIMESTAMPTZ` | DEFAULT NOW() |
| `updated_at` | `TIMESTAMPTZ` | DEFAULT NOW() |

**Indexes:** `user_id`, `(user_id, created_at DESC)` composite, `status`

---

### `templates`

| Column | Type | Constraints |
|---|---|---|
| `id` | `UUID` | PK |
| `icon` | `VARCHAR(10)` | NOT NULL |
| `icon_variant` | `ENUM('amber','sage','clay','ink')` | NOT NULL |
| `name` | `VARCHAR(255)` | NOT NULL |
| `description` | `TEXT` | NOT NULL |
| `uses` | `INTEGER` | NOT NULL, DEFAULT 0 |
| `sample_jd` | `TEXT` | NOT NULL |
| `sort_order` | `SMALLINT` | NOT NULL, DEFAULT 0 |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT true |

---

### ERD (ASCII)

```
┌─────────────────────┐
│        users        │
│─────────────────────│
│ id (PK)             │
│ email               │
│ full_name           │
│ avatar_url          │
│ role                │
│ deleted_at          │
└────────┬────────────┘
         │ 1
         │
    ┌────┴────────────────────────────────────────┐
    │                                             │
    │ *                                           │ *
┌───┴──────────────────┐          ┌───────────────┴──────────┐
│    oauth_accounts    │          │       analyses            │
│──────────────────────│          │───────────────────────────│
│ id (PK)              │          │ id (PK)                   │
│ user_id (FK)         │          │ user_id (FK, nullable)    │
│ provider             │          │ job_id (unique)           │
│ provider_user_id     │          │ status                    │
│ provider_email       │          │ resume_text  ← TEXT       │
└──────────────────────┘          │ resume_filename           │
                                  │ jd_text      ← TEXT       │
                                  │ jd_source_url             │
                                  │ result       ← JSONB      │
                                  │ prompt_version            │
                                  └──────────┬────────────────┘
                                             │ 1
                                             │
                                             │ 0..1
                              ┌──────────────┴────────────┐
                              │      history_entries       │
                              │────────────────────────────│
                              │ id (PK)                    │
                              │ user_id (FK)               │
                              │ analysis_id (FK, nullable) │
                              │ role, company, location    │
                              │ score, status, tag_*       │
                              └────────────────────────────┘

                              ┌────────────────┐
                              │   templates    │  (independent — no FK)
                              │────────────────│
                              │ id, name, icon │
                              │ sample_jd      │
                              └────────────────┘
```

---

## 5. Authentication & Authorization

### Overview

The auth system has four hard security requirements:
1. **No passwords stored** — OAuth only; we never touch user credentials.
2. **Short-lived access tokens** — 15-minute JWTs. A stolen token expires quickly.
3. **Rotating refresh tokens** — every use issues a new token and kills the old one. A stolen refresh token self-invalidates the moment the real user makes any request.
4. **HttpOnly cookies for refresh tokens** — JavaScript cannot read the refresh token, defeating XSS-based token theft.

### JWT Design: RS256 (Asymmetric)

We use RS256 instead of HS256 (symmetric HMAC) because:
- The **private key** lives only on the auth service and signs tokens.
- The **public key** can be distributed to any future service that needs to verify tokens without being able to issue them.
- If a read-only microservice (e.g., a future notification service) gets compromised, it cannot forge tokens.

```
JWT Payload:
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "user",               ← embedded to avoid a DB round-trip per request
  "jti": "unique-token-id",     ← JWT ID for blacklisting on forced logout
  "iat": 1718000000,
  "exp": 1718000900             ← 15 minutes after iat
}
```

### OAuth PKCE Flow (Full)

```
STEP 1 — Frontend initiates login
──────────────────────────────────
  Frontend → GET /api/auth/google/authorize
  Backend:
    a. Generates state = crypto.randomUUID() (CSRF token)
    b. Stores state in Redis: SET csrf:{state} "1" EX 300  (5 min TTL)
    c. Returns { authUrl: "https://accounts.google.com/o/oauth2/v2/auth?
                            client_id=...&redirect_uri=...&state={state}&
                            scope=openid+email+profile&response_type=code" }

STEP 2 — User approves at provider
────────────────────────────────────
  Provider → GET /api/auth/google/callback?code={code}&state={state}
  Backend:
    a. Validates state:
         EXISTS csrf:{state} in Redis → if missing: 400 "Invalid CSRF state"
         DEL csrf:{state}  (one-time use — consumed immediately)
    b. Exchanges code for tokens:
         POST https://oauth2.googleapis.com/token { code, client_id, client_secret, ... }
         → { access_token, id_token }
    c. Verifies id_token signature (do not trust without verifying)
    d. Extracts: { sub: providerUserId, email, name, picture }
    e. Upserts user:
         FIND oauth_accounts WHERE provider='google' AND provider_user_id={sub}
         IF found → load user
         IF NOT found:
           FIND users WHERE email={email}  (link accounts across providers)
           IF found → create oauth_accounts row, link to existing user
           IF NOT found → INSERT users row, INSERT oauth_accounts row
    f. Issues tokens:
         access_token  = sign RS256 JWT { sub, email, role, jti } exp=15min
         refresh_token = crypto.randomUUID()  (opaque — not a JWT)
         SETEX refresh:{refresh_token} {JWT_REFRESH_TTL} {userId}  (Redis)
    g. Sets cookie:
         Set-Cookie: refresh_token={refresh_token};
           HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000
    h. Redirects to:
         {FRONTEND_URL}/auth/callback?access_token={access_token}&expires_in=900

STEP 3 — Subsequent API requests
──────────────────────────────────
  Frontend → ANY protected endpoint
    Authorization: Bearer {access_token}
  Backend (JwtAuthGuard):
    a. Extracts Bearer token from header
    b. Verifies RS256 signature using public key
    c. Checks exp — rejects if expired
    d. Attaches { userId, email, role } to req.user
    e. Continues to route handler

STEP 4 — Silent token refresh
──────────────────────────────
  Frontend (triggered when access_token expires or on 401 response)
    → POST /api/auth/refresh
    Cookie: refresh_token={uuid}
  Backend:
    a. Reads refresh_token cookie
    b. GET Redis: refresh:{token} → userId
       If missing/expired → 401 "Session expired. Please log in again."
    c. Atomic rotation (Redis transaction):
         DEL refresh:{old_token}
         SETEX refresh:{new_token} {TTL} {userId}
    d. Returns:
         { access_token: "eyJ...", expires_in: 900 }
         Set-Cookie: refresh_token={new_token}; HttpOnly; Secure; ...

STEP 5 — Logout
─────────────────
  Frontend → POST /api/auth/logout
    Authorization: Bearer {access_token}
    Cookie: refresh_token={uuid}
  Backend:
    a. DEL refresh:{token} from Redis (immediate session kill)
    b. OPTIONAL: add jti to a short-lived blacklist (covers the 15-min access token window)
         SETEX jti_blacklist:{jti} 900 "1"
    c. Clears cookie: Set-Cookie: refresh_token=; Max-Age=0; HttpOnly; ...
    d. Returns 204

CONCURRENT SESSION DETECTION (theft detection)
────────────────────────────────────────────────
  If two requests arrive with the same refresh_token simultaneously
  (one from attacker, one from real user):
    - The first succeeds and rotates to a new token
    - The second finds the old token gone → 401
  Backend response to this 401:
    - Invalidate ALL refresh tokens for this user (DEL refresh:* matching userId)
    - This forces a full re-login on all devices, alerting the real user
```

### Role / Permission Model

| Role | Who | What they can do |
|---|---|---|
| `user` | Any authenticated user (default) | Own data only: analyses, history, profile |
| `admin` | Internal team | Manage templates, view platform analytics, access any user's data |

Role is embedded in the JWT — no DB lookup per request. Role changes take effect after the next token refresh (at most 15 minutes delay).

### Guard Execution Order

```
Every request
    ↓
ThrottlerGuard     ← Rate limit checked FIRST (before any auth work)
    ↓
JwtAuthGuard       ← Verify token; populate req.user
    ↓               (skip if @Public() decorator on route)
RolesGuard         ← Check req.user.role against @Roles() decorator
    ↓               (skip if no @Roles() on route)
Route Handler
```

---

## 6. API Endpoints

**Global prefix:** `/api`

**Standard response envelope (all 2xx):**
```json
{
  "data": { ... },
  "meta": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2026-06-20T10:00:00.000Z"
  }
}
```

**Standard error envelope (all 4xx / 5xx):**
```json
{
  "statusCode": 422,
  "message": "Validation failed",
  "errors": [
    { "field": "fullName", "message": "must be shorter than or equal to 255 characters" }
  ],
  "requestId": "550e8400-...",
  "timestamp": "2026-06-20T10:00:00.000Z"
}
```

---

### Auth — `/api/auth`

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| GET | `/auth/:provider/authorize` | Public | 20 req / min per IP |
| GET | `/auth/:provider/callback` | Public | 20 req / min per IP |
| POST | `/auth/refresh` | Cookie | 10 req / min per IP |
| POST | `/auth/logout` | JWT | 20 req / min per user |

#### `GET /api/auth/:provider/authorize`
- **Params:** `provider` ∈ `google | apple | github | facebook` (validated at controller level — 400 if unknown)
- **Response 200:** `{ "data": { "authUrl": "https://..." } }`
- **Errors:** 400 unknown provider

#### `GET /api/auth/:provider/callback`
- **Query:** `code` (string), `state` (string)
- **Success:** `302` redirect to `{FRONTEND_URL}/auth/callback?access_token=...&expires_in=900`
- **Errors:** 400 invalid/expired CSRF state; 502 provider token exchange failed

#### `POST /api/auth/refresh`
- **Cookie:** `refresh_token` (HttpOnly — browser sends automatically)
- **Body:** none
- **Response 200:**
  ```json
  { "data": { "access_token": "eyJ...", "expires_in": 900 } }
  ```
  Plus new `Set-Cookie: refresh_token=...`
- **Errors:** 401 token missing / expired / already rotated

#### `POST /api/auth/logout`
- **Headers:** `Authorization: Bearer <token>`
- **Response 204:** No body; clears refresh_token cookie
- **Errors:** 401 unauthenticated

---

### Users — `/api/users`

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| GET | `/users/me` | JWT | 60 req / min per user |
| PUT | `/users/me` | JWT | 10 req / min per user |
| DELETE | `/users/me` | JWT | 3 req / min per user |

#### `GET /api/users/me`
- **Response 200:**
  ```json
  {
    "data": {
      "id": "uuid",
      "email": "user@example.com",
      "fullName": "Jane Doe",
      "avatarUrl": "https://lh3.googleusercontent.com/...",
      "role": "user",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
  ```
- **Errors:** 401

#### `PUT /api/users/me`
- **Body:**
  ```json
  { "fullName": "Jane Doe" }
  ```
- **Validation:** `fullName`: string, 1–255 chars, stripped of leading/trailing whitespace
- **Response 200:** Updated user object (same shape as GET)
- **Errors:** 400 validation, 401

#### `DELETE /api/users/me`
- **Response 204**
- **Behaviour:** Sets `deleted_at = NOW()` on the user row (soft delete). A scheduled job purges the row and all cascade data after 30 days. This satisfies GDPR erasure requests with a grace-period window.
- **Errors:** 401

---

### Analysis — `/api/analysis`

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| POST | `/analysis` | Optional JWT | 10 req / 15 min per IP (anon); 30 req / 15 min per user |
| GET | `/analysis/:jobId` | Optional JWT | 120 req / min per IP (polling) |
| GET | `/analysis` | JWT | 30 req / min per user |

#### `POST /api/analysis`
- **Content-Type:** `multipart/form-data`
- **Body fields:**

  | Field | Type | Validation |
  |---|---|---|
  | `resume` | File | Required; MIME: `application/pdf` or OOXML DOCX; max 10 MB |
  | `jdText` | string | Required if `inputMode=paste`; min 60 chars, max 20,000 chars |
  | `jdUrl` | string | Required if `inputMode=link`; valid URL; not RFC1918/localhost (SSRF protection) |
  | `inputMode` | string | Required; enum: `paste` or `link` |

- **File processing (server-side, in-memory):**
  1. Multer holds the file buffer in RAM (no disk write, `memoryStorage()`)
  2. `file-type` library reads the magic bytes — rejects if MIME doesn't match declared type
  3. `pdf-parse` or `mammoth` extracts plain text from the buffer
  4. Buffer is released; only the text string proceeds

- **Response 202:**
  ```json
  {
    "data": {
      "jobId": "bull-abc123",
      "status": "pending",
      "pollUrl": "/api/analysis/bull-abc123"
    }
  }
  ```
- **Errors:** 400 validation, 413 file > 10 MB, 415 unsupported MIME type

#### `GET /api/analysis/:jobId`
- **Auth:** Optional — anonymous users can poll their own job (no ownership check needed since jobId is a secret UUID)
- **Response 200 (pending / processing):**
  ```json
  { "data": { "jobId": "...", "status": "pending" } }
  ```
- **Response 200 (completed):**
  ```json
  {
    "data": {
      "jobId": "...",
      "status": "completed",
      "result": {
        "roleTitle": "Senior Product Designer",
        "company": "Acme Corp",
        "location": "Remote",
        "source": "Applied via paste",
        "overallScore": 82,
        "stats": { "strongMatches": 14, "gapsFound": 3, "atsCoverage": 78 },
        "issues": [
          {
            "id": "issue-1",
            "variant": "clay",
            "tag": "critical",
            "headline": "Missing quantified impact",
            "description": "3 of 5 bullet points lack measurable outcomes.",
            "priority": 1,
            "action": "Add numbers: 'reduced load time by 40%'"
          }
        ],
        "keywords": [
          { "label": "Figma", "status": "have" },
          { "label": "A/B Testing", "status": "missing" }
        ],
        "rewrites": [
          {
            "before": "Led design work on mobile app",
            "after": "Led end-to-end design for iOS app serving 200K MAU"
          }
        ]
      }
    }
  }
  ```
- **Response 200 (failed):**
  ```json
  { "data": { "jobId": "...", "status": "failed", "error": "Analysis failed. Please try again." } }
  ```
- **Errors:** 404 job not found

#### `GET /api/analysis`
- **Auth:** JWT required
- **Query:** `page` (default 1), `limit` (default 20, max 50), `status`
- **Response 200:** Paginated list of analysis summaries (no `result` payload — only metadata)

---

### History — `/api/history`

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| GET | `/history` | JWT | 60 req / min per user |
| PUT | `/history/:id` | JWT | 30 req / min per user |
| DELETE | `/history/:id` | JWT | 30 req / min per user |
| DELETE | `/history` | JWT | 5 req / min per user |

#### `GET /api/history`
- **Query:** `page`, `limit`, `status`, `q` (full-text search on `role` + `company`)
- **Response 200:** Paginated `HistoryEntry[]`

#### `PUT /api/history/:id`
- **Body:** `{ "status": "applied", "tag": { "label": "Strong Match", "variant": "sage" } }`
- **Ownership check:** `WHERE id = :id AND user_id = :userId` — 404 if not found (prevents IDOR)
- **Response 200:** Updated entry
- **Errors:** 400, 401, 404

#### `DELETE /api/history/:id`
- **Ownership check:** Same as PUT — `user_id` must match
- **Response 204**
- **Errors:** 401, 404

#### `DELETE /api/history`
- **Deletes all history entries for the authenticated user only**
- **Response 204**
- **Errors:** 401

---

### Templates — `/api/templates`

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| GET | `/templates` | Public | 60 req / min per IP |

#### `GET /api/templates`
- **Cache:** Redis TTL 1 hour
- **Response 200:** `Template[]` (see schema)

---

## 7. Middleware Stack

### Global Request Lifecycle

```
Incoming HTTPS Request
          │
          ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [1] Helmet                                                │
  │     Sets all security headers on every response.          │
  │     Configured explicitly — not default Helmet.           │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [2] CORS                                                  │
  │     origin: [process.env.FRONTEND_URL]  ← strict list     │
  │     methods: GET,POST,PUT,DELETE,OPTIONS                  │
  │     credentials: true  ← needed for HttpOnly cookie       │
  │     allowedHeaders: Content-Type, Authorization           │
  │     maxAge: 86400  ← preflight cached 24 h               │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [3] RequestIdMiddleware                                   │
  │     Reads X-Request-ID header if present, else generates  │
  │     a new uuid4. Attaches to req and to response header.  │
  │     All logs and error responses include this ID.         │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [4] pino-http Logger                                      │
  │     Logs: method, url, requestId, userId (if present),   │
  │     userAgent, ip. Does NOT log request bodies (PII).    │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [5] ThrottlerGuard  (@nestjs/throttler)                  │
  │     Per-route rate limits enforced against Redis.         │
  │     Key: IP for anon, userId for authenticated.           │
  │     Returns 429 with Retry-After header.                  │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [6] JwtAuthGuard                                          │
  │     Reads Authorization: Bearer header.                   │
  │     Verifies RS256 signature using public key.            │
  │     Checks jti against blacklist in Redis.                │
  │     Attaches { userId, email, role } to req.user.         │
  │     Routes marked @Public() skip this guard.              │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [7] RolesGuard                                            │
  │     Reads @Roles() metadata from route handler.           │
  │     Compares req.user.role to required role.              │
  │     Returns 403 Forbidden if insufficient.                │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [8] Global ValidationPipe                                 │
  │     whitelist: true  → strips fields not in DTO           │
  │     forbidNonWhitelisted: true  → 400 if extra fields     │
  │     transform: true  → coerces types (string→number etc)  │
  │     transformOptions: { enableImplicitConversion: true }  │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [9] ParseFilePipe (upload routes only)                    │
  │     Validates MIME via magic bytes (file-type library).   │
  │     Rejects if actual MIME ≠ declared extension.          │
  │     Enforces max size.                                    │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
               Controller Handler
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [10] TransformInterceptor                                 │
  │      Wraps all 2xx responses in { data, meta } envelope.  │
  └───────────────────┬───────────────────────────────────────┘
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [11] LoggingInterceptor                                   │
  │      Logs: statusCode, responseTime in ms, requestId.     │
  └───────────────────┬───────────────────────────────────────┘
                      │
          (if exception thrown anywhere above)
                      │
                      ▼
  ┌───────────────────────────────────────────────────────────┐
  │ [12] HttpExceptionFilter (global)                         │
  │      Prisma P2002 → 409 Conflict                          │
  │      Prisma P2025 → 404 Not Found                         │
  │      ValidationError → 400 with field-level errors        │
  │      UnauthorizedException → 401                          │
  │      ForbiddenException → 403                             │
  │      Unknown errors → 500; log full stack; return generic │
  └───────────────────────────────────────────────────────────┘
```

### Error Handling Rules

| Condition | HTTP Status | Logged At | Client Message |
|---|---|---|---|
| DTO validation failure | 400 | `debug` | Field-level error array |
| Invalid/expired JWT | 401 | `warn` | "Unauthorised" |
| Insufficient role | 403 | `warn` | "Forbidden" |
| Resource not found | 404 | `info` | "Not found" |
| IDOR ownership mismatch | 404 | `warn` | "Not found" (deliberately same as 404 — don't leak existence) |
| Rate limit exceeded | 429 | `info` | "Too many requests. Retry after N seconds." |
| LLM call failed | — | `error` | Job marked `failed`; no HTTP error to client |
| Unexpected server error | 500 | `error` (full stack) | "Something went wrong. Please try again." |

---

## 8. External Integrations

### OAuth Providers

| Provider | Passport Strategy | Scopes | Notes |
|---|---|---|---|
| Google | `passport-google-oauth20` | `openid email profile` | Most reliable; do first |
| GitHub | `passport-github2` | `read:user user:email` | Email may need separate `/user/emails` call |
| Facebook | `passport-facebook` | `email public_profile` | App review required for email scope in production |
| Apple | `passport-apple` | `name email` | POST callback (not GET); private relay emails; implement last |

**Provider tokens are NOT stored.** They are used during the callback only to fetch the user's email and name, then discarded. We have no ongoing need to act on the user's behalf with any provider.

### LLM (OpenAI / Anthropic)

```
LlmService interface:
  analyze(resumeText: string, jdText: string): Promise<AnalysisResult>

OpenAI implementation:
  model: gpt-4o
  response_format: { type: "json_object" }  ← enforces JSON output
  max_tokens: 2048
  timeout: 60_000ms
  retry: 1 attempt on 5xx, 2s backoff

Anthropic implementation:
  model: claude-sonnet-4-6
  Tool-calling or system prompt with JSON schema constraint
  Same timeout and retry policy

Prompt versioning:
  All prompts tagged with VERSION constant (e.g. "v1.2")
  Stored in analyses.prompt_version for result comparability
```

### Secret Management

| Environment | Method |
|---|---|
| Local development | `.env` file (gitignored) |
| Staging / Production | Environment injection via hosting platform (Railway, Render, Fly.io) or AWS Secrets Manager |
| CI | GitHub Actions secrets |

Rules:
- Never log env vars or secrets
- Never commit `.env` or `keys/private.pem`
- `config.get<string>('KEY')` wrapper used everywhere — never `process.env.KEY` directly in business logic
- Application fails to start if any required env var is missing (validated at boot via Joi schema)

---

## 9. Security — Production Hardening

### 9.1 Helmet Configuration (Explicit)

Default Helmet enables many headers but misconfigures CSP. We set every directive explicitly:

```
Content-Security-Policy:
  default-src 'none';
  script-src 'self';
  connect-src 'self';
  img-src 'self' data: https://lh3.googleusercontent.com;
  style-src 'self' 'unsafe-inline';  ← only if needed for Swagger UI
  font-src 'self' https://fonts.gstatic.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests

Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0           ← disabled (modern browsers ignore it; old value '1' caused bugs)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

### 9.2 Rate Limiting — Full Table

All limits use Redis as the counter store (`@nestjs/throttler` with `ThrottlerStorageRedisService`).

| Endpoint Group | Window | Limit (Anon / User) | Key |
|---|---|---|---|
| Auth — `/auth/*/authorize` | 1 min | 20 / 20 | IP |
| Auth — `/auth/*/callback` | 1 min | 20 / 20 | IP |
| Auth — `/auth/refresh` | 1 min | 10 / 10 | IP |
| Auth — `/auth/logout` | 1 min | 20 / 20 | userId |
| Analysis — `POST /analysis` | 15 min | 10 / 30 | IP / userId |
| Analysis — `GET /analysis/:jobId` | 1 min | 120 / 120 | IP |
| History — all | 1 min | — / 60 | userId |
| Templates — `GET /templates` | 1 min | 60 / 60 | IP |
| Users — `GET /users/me` | 1 min | — / 60 | userId |
| Users — `PUT /users/me` | 1 min | — / 10 | userId |
| Users — `DELETE /users/me` | 1 min | — / 3 | userId |
| **Global fallback** | 1 min | 100 / 200 | IP / userId |

**429 response:** Includes `Retry-After` header with seconds until window resets.

### 9.3 Input Validation

Every endpoint uses a dedicated DTO class with `class-validator` decorators:

| Validator | Applied to |
|---|---|
| `@IsString()`, `@Length(min, max)` | All text fields |
| `@IsEmail()` | N/A — we read email from OAuth provider, not user input |
| `@IsEnum(EnumType)` | `status`, `inputMode`, `provider`, `role`, `tag_variant` |
| `@IsUrl({ protocols: ['https'] })` | `jdUrl` |
| `@IsUUID('4')` | All `:id` path params |
| `@IsInt()`, `@Min(1)`, `@Max(50)` | Pagination `page`, `limit` |
| `@MaxLength(20000)` | `jdText` — prevent oversized LLM prompts |

`ValidationPipe` global config:
```ts
{
  whitelist: true,               // Strips undeclared fields silently
  forbidNonWhitelisted: true,    // 400 if unknown fields present (attack signal)
  transform: true,               // Coerce types from query strings
  disableErrorMessages: false,   // Return field-level errors in dev/staging
}
```

### 9.4 SQL Injection Prevention

- All DB access via Prisma's generated client — parameterised queries by default.
- Raw SQL is **prohibited** except via `prisma.$queryRaw` with tagged template literals (which are parameterised).
- ESLint rule: flag any string concatenation in Prisma calls.

### 9.5 SSRF Prevention (JD URL scraping)

When `inputMode = 'link'`, before Playwright fetches the URL:

```
Validation chain:
  1. URL must parse as valid (class-validator @IsUrl)
  2. Protocol must be 'https' only
  3. Hostname resolved to IP — reject if IP falls in:
       - 127.0.0.0/8     (localhost)
       - 10.0.0.0/8      (RFC1918)
       - 172.16.0.0/12   (RFC1918)
       - 192.168.0.0/16  (RFC1918)
       - 169.254.0.0/16  (link-local / AWS metadata endpoint)
       - ::1             (IPv6 localhost)
  4. Domain allowlist (optional): only permit known job sites in v1
```

### 9.6 File Upload Security

```
Upload security layers (applied in order):
  1. Multer memoryStorage() — file never written to disk
  2. File size limit enforced by Multer (before any parsing):
       limits: { fileSize: 10 * 1024 * 1024 }  // 10 MB
  3. MIME validation via file-type magic bytes (not just extension):
       Allowed: application/pdf
                application/vnd.openxmlformats-officedocument.wordprocessingml.document
  4. File content parsed and buffer released — no persistence
  5. Extracted text truncated at 50,000 chars before LLM call (prevent prompt injection via oversized resume)
```

### 9.7 CORS Policy

```ts
app.enableCors({
  origin: [process.env.FRONTEND_URL],    // e.g., 'https://tailor.app'
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,                     // Required for HttpOnly cookie exchange
  maxAge: 86400,                         // Preflight cached for 24 hours
});
```

Wildcard `*` is never used. Adding `credentials: true` with a wildcard origin is a browser security error and intentionally blocked.

### 9.8 CSRF Protection

No traditional CSRF token is needed for JSON API + Bearer token authentication. The CORS `SameSite=Strict` cookie combined with the `Authorization: Bearer` header requirement means:
- API requests require an `Authorization` header that a cross-site form cannot set.
- The refresh token cookie is `SameSite=Strict` — browsers will not attach it on cross-site requests.

The CSRF token mentioned in the OAuth flow is a **state parameter** used to prevent OAuth redirect attacks (not the same as CSRF on regular API endpoints).

### 9.9 IDOR Prevention

All queries that access user-owned resources include `user_id = req.user.userId` in the WHERE clause. If a record exists but belongs to another user, the query returns nothing and the response is 404 (not 403 — we do not leak the existence of other users' data).

### 9.10 Secrets and Key Management

| Secret | Storage | Rotation |
|---|---|---|
| `JWT_PRIVATE_KEY` (RS256) | Environment variable (PEM string) | Rotate quarterly; public key has zero-downtime update |
| `JWT_PUBLIC_KEY` | Environment variable | Distributed to any service that verifies tokens |
| OAuth `CLIENT_SECRET` (per provider) | Environment variable | Rotate if leaked; providers support this without downtime |
| `DATABASE_URL` | Environment variable | Rotate via Prisma migration connection + reconnect |
| Redis password | Environment variable | Rotate with Redis AUTH |
| LLM API keys | Environment variable | Rotate via provider dashboard |

**Key rotation for JWT:**
1. Generate new `private.pem` + `public.pem`
2. Deploy with BOTH old and new public keys accepted (grace period = access token TTL = 15 min)
3. After 15 min all old tokens have expired; remove old public key

### 9.11 Dependency Security

- `npm audit` runs on every CI pipeline; build fails on `high` or `critical` severity
- GitHub Dependabot enabled for automated PRs on dependency updates
- `package-lock.json` committed and integrity-checked in CI
- No `npm install --legacy-peer-deps` or similar flag that bypasses resolution checks

### 9.12 Logging Security

- Request bodies are **never logged** (may contain resume text = PII, or job description)
- `Authorization` headers are never logged
- Refresh token values are never logged
- Logs include: `requestId`, `method`, `path`, `statusCode`, `responseTimeMs`, `userId` (not email)
- Error logs include: `requestId`, `error.message`, `error.stack` — never the full request body

---

## 10. Scalability & Performance Notes

### Caching Strategy

| Data | Store | TTL | Invalidation Trigger |
|---|---|---|---|
| Templates list | Redis | 60 min | Manual cache bust on admin update |
| Completed analysis result (by jobId) | Redis | 24 h | Immutable once set |
| OAuth CSRF state tokens | Redis | 5 min | Consumed on use (DEL) |
| JWT refresh tokens | Redis | 30 days | DEL on logout / rotation |
| Rate limit counters | Redis | Per-window | Auto-expire |
| JTI blacklist (forced logout) | Redis | 15 min | Auto-expire (= access token TTL) |

### Background Analysis Job (BullMQ)

```
POST /api/analysis received
        │
        ▼
analysis.service.ts:
  1. Validate file (MIME, size)
  2. Extract text in-memory (pdf-parse / mammoth)
  3. If inputMode='link': call jd-scraper.service.ts (Playwright)
  4. Create analyses row: { status: 'pending', resume_text, jd_text, job_id }
  5. Enqueue BullMQ job: { analysisId, resumeText, jdText }
  6. Return { jobId, status: 'pending' }
        │
        ▼ (async, in BullMQ worker)
analysis.processor.ts:
  1. Update analyses.status = 'processing'
  2. Call LlmService.analyze(resumeText, jdText)
  3. Parse and validate LLM JSON response
  4. UPDATE analyses SET status='completed', result={...}, completed_at=NOW()
  5. INSERT history_entries row (if user is authenticated)

Concurrency: ANALYSIS_WORKER_CONCURRENCY (default: 3)
Retry policy: 2 retries; backoff: 5s, 15s
Stalled job timeout: 120s (if worker crashes mid-job)
Failed jobs retained: 48 h (visible in Bull Dashboard for debugging)
```

### Horizontal Scaling

- Application is stateless — all state in PostgreSQL + Redis. Run N replicas.
- BullMQ workers can run as separate processes/containers, scaled independently.
- Playwright (JD scraper) is CPU/memory heavy — isolate in a dedicated container if scraping volume grows.
- DB connections: use `pgbouncer` in transaction mode to cap connections at scale.
- No shared disk, no in-memory cache that would cause split-brain — Redis is the single source of truth for all ephemeral state.

---

## 11. Environment Variables

```dotenv
# ─────────────────────────────────────────────────────
# Server
# ─────────────────────────────────────────────────────
NODE_ENV=development                    # development | staging | production | test
PORT=3001                               # HTTP port for the NestJS server

# ─────────────────────────────────────────────────────
# CORS / Frontend
# ─────────────────────────────────────────────────────
FRONTEND_URL=http://localhost:5173      # Exact origin for CORS allowlist

# ─────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/tailor_db
                                        # Prisma connection string

# ─────────────────────────────────────────────────────
# Redis
# ─────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379        # Used for: BullMQ, rate limits, refresh tokens, cache
# REDIS_URL=redis://:password@host:6379 # With auth for production

# ─────────────────────────────────────────────────────
# JWT — RS256 Asymmetric Keys
# Use: openssl genrsa -out private.pem 2048
#      openssl rsa -in private.pem -pubout -out public.pem
# Store PEM content as single-line with \n literals or use base64 encoding
# ─────────────────────────────────────────────────────
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
JWT_ACCESS_TOKEN_TTL=900                # seconds (15 minutes)
JWT_REFRESH_TOKEN_TTL=2592000           # seconds (30 days)

# ─────────────────────────────────────────────────────
# OAuth — Google
# https://console.cloud.google.com/apis/credentials
# ─────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/api/auth/google/callback

# ─────────────────────────────────────────────────────
# OAuth — GitHub
# https://github.com/settings/developers
# ─────────────────────────────────────────────────────
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3001/api/auth/github/callback

# ─────────────────────────────────────────────────────
# OAuth — Apple (complex setup — implement last)
# https://developer.apple.com/account/resources/identifiers/
# ─────────────────────────────────────────────────────
APPLE_CLIENT_ID=                        # Service ID (com.yourcompany.tailor)
APPLE_TEAM_ID=                          # 10-character Team ID from Apple Developer
APPLE_KEY_ID=                           # Key ID from the .p8 file
APPLE_PRIVATE_KEY=                      # Full PEM content of the .p8 key
APPLE_CALLBACK_URL=http://localhost:3001/api/auth/apple/callback

# ─────────────────────────────────────────────────────
# OAuth — Facebook
# https://developers.facebook.com/apps/
# ─────────────────────────────────────────────────────
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_CALLBACK_URL=http://localhost:3001/api/auth/facebook/callback

# ─────────────────────────────────────────────────────
# LLM Provider
# ─────────────────────────────────────────────────────
LLM_PROVIDER=openai                     # openai | anthropic
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
LLM_REQUEST_TIMEOUT_MS=60000           # 60 seconds before giving up
LLM_PROMPT_VERSION=v1.0                # Stored in analyses.prompt_version for tracking

# ─────────────────────────────────────────────────────
# Analysis Worker
# ─────────────────────────────────────────────────────
ANALYSIS_WORKER_CONCURRENCY=3          # Parallel BullMQ jobs
ANALYSIS_MAX_FILE_SIZE_BYTES=10485760  # 10 MB in bytes
ANALYSIS_MAX_TEXT_CHARS=50000          # Truncate resume text before LLM call

# ─────────────────────────────────────────────────────
# Rate Limiting
# ─────────────────────────────────────────────────────
THROTTLE_TTL_MS=60000                  # Global window: 1 minute
THROTTLE_LIMIT=200                     # Global fallback limit per window (authenticated)
ANALYSIS_THROTTLE_TTL_MS=900000        # 15-minute window for POST /analysis
ANALYSIS_THROTTLE_LIMIT_ANON=10        # Anonymous: 10 analyses per 15 min
ANALYSIS_THROTTLE_LIMIT_USER=30        # Authenticated: 30 analyses per 15 min
```

---

## 12. Open Questions

| # | Question | Context | Recommended Default |
|---|---|---|---|
| 1 | **Anonymous analyses** — should unauthenticated users be able to submit a resume? | Frontend has no auth gate on the upload panel | Allow it (rate limited to 10/15 min per IP); results are not persisted to history |
| 2 | **JD URL scraping — which sites?** | Frontend accepts any URL | Start with LinkedIn, Greenhouse, Lever, Workday. Fail gracefully for others with a clear error message |
| 3 | **History auto-population** — auto-create a history entry after every completed analysis, or only on explicit "Save"? | Frontend `HistoryPage` lists past results | Auto-create on completion for logged-in users; deletable |
| 4 | **Template `uses` counter** — real or cosmetic? | `mockTemplates` has static counts | Real: increment atomically in DB when a template's `sampleJd` is used to populate the JD field |
| 5 | **GDPR erasure window** — hard delete immediately on account deletion, or soft delete + 30-day purge? | `ProfilePage` has "Clear history" action | Soft delete; 30-day window; send email confirmation (requires email integration) |
| 6 | **Account linking across providers** — if a user signs in with Google (email A), then tries GitHub (same email A), should accounts auto-link? | Current design links on email match | Yes, auto-link on matching verified email. Apple uses private relay emails — cannot link by email for Apple accounts |
| 7 | **Multi-resume versions** — store the last N resumes for quick re-analysis? | Frontend always uploads fresh | Out of scope for v1. Resume text is cheap to store; can add "saved resumes" table later |
| 8 | **LLM cost controls** — what is the monthly LLM budget? | No budget info in frontend | Implement per-user daily analysis limit (configurable) and token usage logging from day one |
| 9 | **Apple Sign In complexity** — Apple requires POST callback, handles private relay emails, and has a more complex JWT verification flow | AuthPage lists it as a provider | Deprioritise; ship Google + GitHub first |
| 10 | **Prompt versioning — backwards compatibility** — if prompt v2 produces different score scales, are v1 results still shown in history? | `prompt_version` column added to schema | Display prompt_version badge on history entries; no recalculation of old results |
