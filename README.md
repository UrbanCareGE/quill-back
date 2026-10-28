# Quill

Multi-tenant chat backend. Replaces TalkJS for urbancare; designed to be reused by future apps.

See `CLAUDE.md` for the full spec — what it is, why it exists, auth model, data model, API surface, integration shape.

## Quick start

```bash
npm ci
cp .env.example .env       # MONGO_URI, QUILL_DB_NAME, QUILL_MASTER_KEY, QUILL_ADMIN_TOKEN
npm run start:dev
```

Never point a local Quill at the production database. Operations, environments and deploy:
`../CLAUDE.md`.

Quill boots on `:8086` by default. Liveness at `GET /health`; `ops/deploy.sh` polls `GET /swagger`.

## Auth model (TL;DR)

Two callers, two credential shapes — both backed by the **same** app private key:

- **App backend → Quill** (`/internal/**` endpoints): `Authorization: Bearer <app private key>`
- **App user → Quill** (Socket.IO + user-facing REST): handshake auth `{ appId, userId, signature }` where `signature = HMAC-SHA256(userId, app private key)`

No expiry on signatures. Access is controlled by the `chat_participants` table, not by token validity. See `CLAUDE.md` for the full rationale.
