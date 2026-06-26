# Tailor Backend — QA Testing Guide

This document covers manual testing of every API endpoint. All requests use `curl`. Run them in order — some tests depend on values from earlier responses (e.g., the access token).

---

## Setup

### Prerequisites

- Server running: `pnpm start:dev` → `http://localhost:3001`
- PostgreSQL + Redis running: `docker compose up -d`

### Get a dev token (fastest way to authenticate)

```bash
curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected response (201):**
```json
{
  "data": {
    "userId": "00000000-0000-0000-0000-000000000001",
    "email": "dev@tailor.test",
    "access_token": "eyJhbGci...",
    "refresh_token": "some-uuid",
    "expires_in": 900
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

Save the token:
```bash
TOKEN="paste_access_token_here"
REFRESH="paste_refresh_token_here"
```

### Standard response envelope

Every successful response returns:
```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-06-20T10:00:00.000Z"
  }
}
```

Every error returns:
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [{ "message": "..." }],
  "requestId": "uuid",
  "timestamp": "2026-06-20T10:00:00.000Z"
}
```

---

## 1. Auth Endpoints

### 1.1 Dev Login — `POST /api/auth/dev/login`

**Purpose:** Get a JWT without going through OAuth. Only works when `NODE_ENV !== 'production'`.

**Test: default dev user**
```bash
curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```
**Expect:** 201, `data.userId` = `00000000-0000-0000-0000-000000000001`

**Test: custom email**
```bash
curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qa@example.com","fullName":"QA Tester"}' | jq .
```
**Expect:** 201, `data.email` = `qa@example.com`

**Test: blocked in production**
```bash
NODE_ENV=production pnpm start:prod  # (would return 403)
```
**Expect:** 403 Forbidden

---

### 1.2 OAuth Authorize — `GET /api/auth/:provider/authorize`

**Purpose:** Start the OAuth login flow. Returns a URL to redirect the user to.

**Test: valid provider**
```bash
curl -s "http://localhost:3001/api/auth/google/authorize" | jq .
```
**Expect:** 200, `data.authUrl` contains a URL

**Test: invalid provider**
```bash
curl -s "http://localhost:3001/api/auth/twitter/authorize" | jq .
```
**Expect:** 400, `message` mentions "Unknown provider"

---

### 1.3 Token Refresh — `POST /api/auth/refresh`

**Purpose:** Exchange a refresh token for a new access token. The old refresh token is invalidated.

**Test: valid refresh token**
```bash
curl -s -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=$REFRESH" | jq .
```
**Expect:** 200, `data.access_token` is a new JWT, `data.expires_in` = 900

Check: a `Set-Cookie` header with the new `refresh_token` value should be in the response headers:
```bash
curl -si -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=$REFRESH" | grep -i "set-cookie"
```
**Expect:** `set-cookie: refresh_token=new-uuid; HttpOnly; ...`

**Test: old token cannot be reused (rotation)**
```bash
# Use the token once (saves new token internally but we capture old)
FIRST=$(curl -s -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=$REFRESH" | jq -r '.data.access_token')

# Try to use the old refresh token again
curl -s -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=$REFRESH" | jq .
```
**Expect:** 401, `message` = "Session expired. Please log in again."

**Test: no cookie**
```bash
curl -s -X POST http://localhost:3001/api/auth/refresh | jq .
```
**Expect:** 401

**Test: invalid/fake token**
```bash
curl -s -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=fake-token-that-doesnt-exist" | jq .
```
**Expect:** 401

---

### 1.4 Logout — `POST /api/auth/logout`

**Purpose:** Invalidate the current session. Destroys the refresh token and blacklists the JWT ID.

```bash
# First, get fresh tokens
LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" -d '{}')
AT=$(echo $LOGIN | jq -r '.data.access_token')
RT=$(echo $LOGIN | jq -r '.data.refresh_token')

# Logout
curl -si -X POST http://localhost:3001/api/auth/logout \
  -H "Authorization: Bearer $AT" \
  -H "Cookie: refresh_token=$RT"
```
**Expect:** 204 No Content, `set-cookie: refresh_token=; Max-Age=0`

**Test: refresh token is dead after logout**
```bash
curl -s -X POST http://localhost:3001/api/auth/refresh \
  -H "Cookie: refresh_token=$RT" | jq .
```
**Expect:** 401

**Test: no token**
```bash
curl -s -X POST http://localhost:3001/api/auth/logout | jq .
```
**Expect:** 401

---

## 2. User Endpoints

### 2.1 Get Profile — `GET /api/users/me`

```bash
curl -s http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" | jq .
```
**Expect:** 200
```json
{
  "data": {
    "id": "00000000-0000-0000-0000-000000000001",
    "email": "dev@tailor.test",
    "fullName": "Dev User",
    "avatarUrl": null,
    "role": "user",
    "createdAt": "..."
  }
}
```

**Test: no token**
```bash
curl -s http://localhost:3001/api/users/me | jq .
```
**Expect:** 401

**Test: invalid token**
```bash
curl -s http://localhost:3001/api/users/me \
  -H "Authorization: Bearer eyBad.Token.Here" | jq .
```
**Expect:** 401

---

### 2.2 Update Profile — `PUT /api/users/me`

**Test: valid update**
```bash
curl -s -X PUT http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Updated Name"}' | jq .data.fullName
```
**Expect:** `"Updated Name"`

**Test: whitespace trimming**
```bash
curl -s -X PUT http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"  Trimmed  "}' | jq .data.fullName
```
**Expect:** `"Trimmed"` (leading/trailing whitespace removed)

**Test: empty fullName (should fail)**
```bash
curl -s -X PUT http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":""}' | jq .
```
**Expect:** 400, validation error

**Test: fullName too long (> 255 chars)**
```bash
curl -s -X PUT http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fullName\":\"$(python3 -c 'print("A"*256)')\"}" | jq .statusCode
```
**Expect:** 400

**Test: unknown field rejected (whitelist)**
```bash
curl -s -X PUT http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Valid","role":"admin"}' | jq .
```
**Expect:** 400, message about extra field `role`

**Test: privilege escalation attempt — role stays 'user'**
```bash
# Even if the extra field were somehow accepted, the DTO strips it
# Then verify the DB wasn't changed:
curl -s http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $TOKEN" | jq .data.role
```
**Expect:** `"user"` (never `"admin"`)

---

### 2.3 Delete Account — `DELETE /api/users/me`

```bash
# Get fresh tokens first (the original $TOKEN still works after delete for 15 min)
LOGIN=$(curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" -d '{}')
AT=$(echo $LOGIN | jq -r '.data.access_token')

curl -s -X DELETE http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $AT" -w "%{http_code}"
```
**Expect:** 204 No Content

**Test: user is invisible immediately after soft delete**
```bash
curl -s http://localhost:3001/api/users/me \
  -H "Authorization: Bearer $AT" | jq .statusCode
```
**Expect:** 404 (the JWT is still valid but user is soft-deleted)

**Test: re-login recreates the user (dev endpoint upserts)**
```bash
curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" -d '{}' | jq .data.userId
# Then check profile again with new token
```
**Expect:** user is back with same UUID

---

## 3. Analysis Endpoints

### 3.1 Submit Analysis — `POST /api/analysis`

Create a test PDF file first:
```bash
# Create a minimal test PDF (for real testing use an actual resume PDF)
echo '%PDF-1.4' > /tmp/test-resume.pdf
cat >> /tmp/test-resume.pdf << 'EOF'
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>
endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
217
%%EOF
EOF
```

**Test: authenticated analysis (paste mode)**
```bash
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/test-resume.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=Senior Software Engineer - Backend (Node.js). We are looking for a senior backend engineer with 5+ years of Node.js experience to join our platform team. You will design and build scalable microservices, work closely with product teams, and help shape our technical roadmap. Requirements: Node.js TypeScript PostgreSQL Redis Docker Kubernetes AWS CI/CD. Experience with distributed systems required." \
  | jq .
```
**Expect:** 202
```json
{
  "data": {
    "jobId": "some-uuid",
    "status": "pending",
    "pollUrl": "/api/analysis/some-uuid"
  }
}
```

Save the jobId:
```bash
JOB_ID="paste_job_id_here"
```

**Test: anonymous analysis (no token)**
```bash
curl -s -X POST http://localhost:3001/api/analysis \
  -F "resume=@/tmp/test-resume.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=Senior Software Engineer - Backend (Node.js). We are looking for a senior backend engineer with 5+ years of Node.js experience. Requirements: Node.js TypeScript PostgreSQL Redis Docker Kubernetes AWS CI/CD distributed systems." \
  | jq .data.status
```
**Expect:** 202 (anonymous submissions are allowed)

**Test: missing inputMode (validation)**
```bash
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/test-resume.pdf;type=application/pdf" \
  -F "jdText=Some job description here" \
  | jq .statusCode
```
**Expect:** 400

**Test: jdText too short (< 60 chars)**
```bash
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/test-resume.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=Too short" \
  | jq .statusCode
```
**Expect:** 400

**Test: no file**
```bash
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "inputMode=paste" \
  -F "jdText=Senior Software Engineer - Backend (Node.js). We are looking for a senior backend engineer with 5+ years of Node.js experience. Requirements: Node.js TypeScript PostgreSQL Redis Docker Kubernetes AWS." \
  | jq .statusCode
```
**Expect:** 400

**Test: wrong MIME type**
```bash
echo "this is plain text" > /tmp/fake.pdf
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/fake.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=Senior Software Engineer - Backend (Node.js). We are looking for a senior backend engineer with 5+ years of Node.js experience. Requirements: Node.js TypeScript PostgreSQL Redis Docker Kubernetes AWS." \
  | jq .statusCode
```
**Expect:** 415 Unsupported Media Type (magic bytes don't match PDF)

---

### 3.2 Poll Analysis Status — `GET /api/analysis/:jobId`

```bash
# Poll immediately (should be pending or processing)
curl -s "http://localhost:3001/api/analysis/$JOB_ID" | jq .data.status
```
**Expect:** `"pending"` or `"processing"` or `"completed"`

**Poll until complete:**
```bash
while true; do
  STATUS=$(curl -s "http://localhost:3001/api/analysis/$JOB_ID" | jq -r '.data.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done
```

**Check completed result:**
```bash
curl -s "http://localhost:3001/api/analysis/$JOB_ID" | jq .data.result
```
**Expect:** Full `AnalysisResult` object:
```json
{
  "roleTitle": "Senior Software Engineer",
  "company": "Company Name",
  "overallScore": 82,
  "stats": { "strongMatches": 12, "gapsFound": 3, "atsCoverage": 75 },
  "issues": [...],
  "keywords": [...],
  "rewrites": [...]
}
```

**Test: unknown jobId**
```bash
curl -s "http://localhost:3001/api/analysis/does-not-exist" | jq .statusCode
```
**Expect:** 404

---

### 3.3 List Analyses — `GET /api/analysis`

```bash
curl -s "http://localhost:3001/api/analysis" \
  -H "Authorization: Bearer $TOKEN" | jq .
```
**Expect:** 200, `data` is an array of analysis summaries (no `result` payload)

**Test: pagination**
```bash
curl -s "http://localhost:3001/api/analysis?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```
**Expect:** at most 5 items

**Test: filter by status**
```bash
curl -s "http://localhost:3001/api/analysis?status=completed" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].status'
```
**Expect:** all items are `"completed"`

**Test: no token**
```bash
curl -s "http://localhost:3001/api/analysis" | jq .statusCode
```
**Expect:** 401

---

## 4. History Endpoints

First, make sure you have completed at least one analysis (the system auto-creates a history entry for authenticated users when an analysis completes).

Or insert one directly via the dev user:
```bash
# Check existing history
curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```

### 4.1 List History — `GET /api/history`

```bash
curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" | jq .
```
**Expect:** 200, `data` is array of history entries

Each entry shape:
```json
{
  "id": "uuid",
  "userId": "uuid",
  "role": "Senior Software Engineer",
  "company": "Acme Corp",
  "location": "Remote",
  "score": 82,
  "status": "not_applied",
  "tagLabel": "Strong Fit",
  "tagVariant": "sage",
  "createdAt": "..."
}
```

**Test: search**
```bash
curl -s "http://localhost:3001/api/history?q=engineer" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].role'
```
**Expect:** only entries with "engineer" in role or company

**Test: filter by status**
```bash
curl -s "http://localhost:3001/api/history?status=applied" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].status'
```
**Expect:** only `"applied"` entries

**Test: pagination**
```bash
curl -s "http://localhost:3001/api/history?page=1&limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```
**Expect:** at most 3 entries

**Test: no token**
```bash
curl -s "http://localhost:3001/api/history" | jq .statusCode
```
**Expect:** 401

---

### 4.2 Update History Entry — `PUT /api/history/:id`

First get an entry ID:
```bash
HISTORY_ID=$(curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
echo "History ID: $HISTORY_ID"
```

**Test: update status**
```bash
curl -s -X PUT "http://localhost:3001/api/history/$HISTORY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"applied"}' | jq .data.status
```
**Expect:** `"applied"`

**Test: update tag**
```bash
curl -s -X PUT "http://localhost:3001/api/history/$HISTORY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tag":{"label":"Dream Job","variant":"sage"}}' | jq '.data | {tagLabel, tagVariant}'
```
**Expect:** `{ "tagLabel": "Dream Job", "tagVariant": "sage" }`

**Test: non-existent ID**
```bash
curl -s -X PUT "http://localhost:3001/api/history/00000000-0000-0000-0000-000000000099" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"applied"}' | jq .statusCode
```
**Expect:** 404

**Test: IDOR — try to update another user's entry**

(This requires setting up a second user via `POST /auth/dev/login` with a different email, creating a history entry for them via the DB, then trying to update it with the first user's token.)

```bash
# Create second user and get their token
TOKEN2=$(curl -s -X POST http://localhost:3001/api/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{"email":"other@example.com"}' | jq -r '.data.access_token')

# Submit an analysis as user 2 to create a history entry
# ... (submit analysis, wait for completion)
# Then get user 2's history entry ID
HISTORY_ID2=$(curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN2" | jq -r '.data[0].id')

# Try to update user 2's entry with user 1's token
curl -s -X PUT "http://localhost:3001/api/history/$HISTORY_ID2" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"applied"}' | jq .statusCode
```
**Expect:** 404 (not 403 — we don't reveal that the entry exists)

---

### 4.3 Delete History Entry — `DELETE /api/history/:id`

```bash
curl -s -X DELETE "http://localhost:3001/api/history/$HISTORY_ID" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
```
**Expect:** 204 No Content

**Verify it's gone:**
```bash
curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```
**Expect:** one fewer entry

**Test: non-existent ID**
```bash
curl -s -X DELETE "http://localhost:3001/api/history/00000000-0000-0000-0000-000000000099" \
  -H "Authorization: Bearer $TOKEN" | jq .statusCode
```
**Expect:** 404

---

### 4.4 Clear All History — `DELETE /api/history`

```bash
curl -s -X DELETE "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" -w "%{http_code}"
```
**Expect:** 204 No Content

**Verify cleared:**
```bash
curl -s "http://localhost:3001/api/history" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```
**Expect:** 0

**Test: no token**
```bash
curl -s -X DELETE "http://localhost:3001/api/history" | jq .statusCode
```
**Expect:** 401

---

## 5. Templates Endpoints

### 5.1 List Templates — `GET /api/templates`

**Test: public endpoint (no token required)**
```bash
curl -s "http://localhost:3001/api/templates" | jq .
```
**Expect:** 200, `data` is an array of templates

Each template:
```json
{
  "id": "uuid",
  "icon": "💻",
  "iconVariant": "sage",
  "name": "Software Engineer",
  "description": "...",
  "uses": 2180,
  "sampleJd": "We are hiring...",
  "sortOrder": 1,
  "isActive": true
}
```

**Test: authenticated request also works**
```bash
curl -s "http://localhost:3001/api/templates" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```
**Expect:** same result as unauthenticated

**Test: response envelope**
```bash
curl -s "http://localhost:3001/api/templates" | jq '{hasData: (.data != null), hasMeta: (.meta != null)}'
```
**Expect:** `{ "hasData": true, "hasMeta": true }`

**Test: sorted by sortOrder**
```bash
curl -s "http://localhost:3001/api/templates" | jq '[.data[].sortOrder]'
```
**Expect:** ascending order `[0, 1, 2, ...]`

---

## 6. Swagger UI

Open in browser: `http://localhost:3001/api/docs`

**What to verify:**
- All endpoints are listed with their correct HTTP methods and paths
- Auth endpoints show up under the `auth` tag
- Protected endpoints show the lock icon
- Request body schemas are correct for POST/PUT endpoints
- You can click "Try it out" and execute requests directly

---

## 7. Security Checks

### 7.1 CORS

```bash
# Cross-origin request without allowed origin
curl -s -H "Origin: http://evil.com" \
  "http://localhost:3001/api/templates" -v 2>&1 | grep -i "access-control"
```
**Expect:** No `Access-Control-Allow-Origin: http://evil.com` in response (CORS blocked)

```bash
# Allowed origin
curl -s -H "Origin: http://localhost:5173" \
  "http://localhost:3001/api/templates" -v 2>&1 | grep -i "access-control"
```
**Expect:** `Access-Control-Allow-Origin: http://localhost:5173`

### 7.2 Security headers

```bash
curl -si "http://localhost:3001/api/templates" | grep -E "x-frame|x-content|strict-transport|content-security"
```
**Expect:**
- `x-frame-options: DENY`
- `x-content-type-options: nosniff`
- `strict-transport-security: max-age=31536000; includeSubDomains; preload`
- `content-security-policy: ...`

### 7.3 Rate limiting

```bash
# Hit a rate-limited endpoint many times rapidly
for i in $(seq 1 25); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/templates")
  echo "Request $i: $STATUS"
done
```
**Expect:** First N requests return 200, then 429 Too Many Requests with `Retry-After` header

Check rate limit headers:
```bash
curl -si "http://localhost:3001/api/templates" | grep -i "retry-after\|x-ratelimit"
```

### 7.4 MIME type bypass attempt

```bash
# Try to upload a .txt file disguised as a PDF
echo "I am not a PDF" > /tmp/malicious.pdf
curl -s -X POST http://localhost:3001/api/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/malicious.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=Senior Software Engineer Backend Node.js 5+ years experience required microservices PostgreSQL Redis distributed systems AWS Docker Kubernetes CI/CD." \
  | jq .statusCode
```
**Expect:** 415 (magic bytes don't match PDF, even though Content-Type says application/pdf)

### 7.5 JWT tampering

```bash
# Try a modified token (change one character in the payload)
BAD_TOKEN=$(echo $TOKEN | sed 's/\./X./2')
curl -s "http://localhost:3001/api/users/me" \
  -H "Authorization: Bearer $BAD_TOKEN" | jq .statusCode
```
**Expect:** 401

### 7.6 Input whitelist

```bash
# Extra field on DTO
curl -s -X PUT "http://localhost:3001/api/users/me" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Valid","injectedField":"bad_value"}' | jq .statusCode
```
**Expect:** 400 (forbidNonWhitelisted)

---

## 8. End-to-End Happy Path

Run through the complete user journey:

```bash
#!/bin/bash
set -e
BASE="http://localhost:3001/api"

echo "=== 1. Login ==="
LOGIN=$(curl -s -X POST $BASE/auth/dev/login \
  -H "Content-Type: application/json" -d '{}')
TOKEN=$(echo $LOGIN | jq -r '.data.access_token')
REFRESH=$(echo $LOGIN | jq -r '.data.refresh_token')
echo "Token obtained: ${TOKEN:0:20}..."

echo "=== 2. Get profile ==="
curl -s $BASE/users/me -H "Authorization: Bearer $TOKEN" | jq .data.email

echo "=== 3. Get templates ==="
TMPL_COUNT=$(curl -s $BASE/templates | jq '.data | length')
echo "Templates: $TMPL_COUNT"

echo "=== 4. Submit analysis ==="
JD="Senior Software Engineer Backend Node.js We are looking for a senior backend engineer with 5 plus years of Node.js and TypeScript experience to join our platform team building scalable distributed systems."
JOB=$(curl -s -X POST $BASE/analysis \
  -H "Authorization: Bearer $TOKEN" \
  -F "resume=@/tmp/test-resume.pdf;type=application/pdf" \
  -F "inputMode=paste" \
  -F "jdText=$JD")
JOB_ID=$(echo $JOB | jq -r '.data.jobId')
echo "Job submitted: $JOB_ID"

echo "=== 5. Poll until complete ==="
for i in $(seq 1 30); do
  STATUS=$(curl -s "$BASE/analysis/$JOB_ID" | jq -r '.data.status')
  echo "  Poll $i: $STATUS"
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 2
done

echo "=== 6. Check result ==="
SCORE=$(curl -s "$BASE/analysis/$JOB_ID" | jq '.data.result.overallScore')
echo "Score: $SCORE"

echo "=== 7. Check history was auto-created ==="
H_COUNT=$(curl -s "$BASE/history" -H "Authorization: Bearer $TOKEN" | jq '.data | length')
echo "History entries: $H_COUNT"

echo "=== 8. Update history status ==="
H_ID=$(curl -s "$BASE/history" -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
curl -s -X PUT "$BASE/history/$H_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"applied"}' | jq .data.status

echo "=== 9. Refresh token ==="
NEW_AT=$(curl -s -X POST $BASE/auth/refresh \
  -H "Cookie: refresh_token=$REFRESH" | jq -r '.data.access_token')
echo "New token: ${NEW_AT:0:20}..."

echo "=== 10. Update profile ==="
curl -s -X PUT $BASE/users/me \
  -H "Authorization: Bearer $NEW_AT" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"QA Test User"}' | jq .data.fullName

echo "=== 11. Logout ==="
curl -s -X POST $BASE/auth/logout \
  -H "Authorization: Bearer $NEW_AT" \
  -H "Cookie: refresh_token=$REFRESH" -w "%{http_code}"

echo ""
echo "=== All steps complete ==="
```

---

## 9. Checklist for Each Release

Before marking a release as ready, verify:

### Auth
- [ ] Google OAuth authorize returns a valid Google URL
- [ ] GitHub OAuth authorize returns a valid GitHub URL  
- [ ] Token refresh returns a new access token and new cookie
- [ ] Old refresh token is rejected after rotation
- [ ] Logout invalidates both the JWT (JTI blacklist) and the refresh token
- [ ] Dev login is accessible in dev/test, blocked in production

### Analysis
- [ ] PDF upload returns 202 with a jobId
- [ ] Polling the jobId returns correct statuses (pending → processing → completed)
- [ ] Completed result includes overallScore, issues, keywords, rewrites
- [ ] Anonymous submission works (no token, returns 202)
- [ ] Anonymous submission does NOT create a history entry
- [ ] Authenticated submission auto-creates a history entry on completion
- [ ] Wrong file type returns 415
- [ ] Short JD text returns 400
- [ ] Missing file returns 400
- [ ] List endpoint is paginated and scoped to the authenticated user

### Users
- [ ] GET /users/me returns the correct profile
- [ ] PUT /users/me trims whitespace
- [ ] PUT /users/me rejects empty fullName
- [ ] PUT /users/me rejects extra fields
- [ ] DELETE /users/me returns 204 and the user is invisible afterwards

### History
- [ ] List returns only the authenticated user's entries
- [ ] Search by ?q= filters correctly
- [ ] Status filter works
- [ ] PUT updates status and tag in DB
- [ ] DELETE /history/:id removes the specific entry
- [ ] DELETE /history clears all entries for the user only
- [ ] IDOR: another user's entry returns 404 (not 403)

### Templates
- [ ] GET /templates works without authentication
- [ ] Results are sorted by sortOrder ascending
- [ ] Inactive templates are not returned

### Security
- [ ] Cross-origin requests from unknown origins are blocked
- [ ] Security headers present (CSP, HSTS, X-Frame-Options, etc.)
- [ ] Rate limiting kicks in after threshold
- [ ] MIME type bypass returns 415
- [ ] JWT tampering returns 401

---

## 10. Known Limitations / Out of Scope

| Feature | Status | Notes |
|---|---|---|
| Apple Sign In | Not implemented | Complex due to POST callback and private relay emails |
| JD URL scraping (Playwright) | Implemented | Some sites may block automated access |
| Email notifications | Not implemented | No email service integrated |
| Admin endpoints | Not implemented | Role enforcement is in place but no admin-only routes exist yet |
| File size > 10 MB | Rejected at Multer layer (413) | By design |
| DOCX upload | Implemented | Uses mammoth library for text extraction |
| Anonymous analysis history | Not persisted | By design (stateless for anonymous users) |
