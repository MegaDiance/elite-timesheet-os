# Deploying to Railway

This app deploys as **one Railway service**: the Express backend serves the built
React app, so there is a single URL and no CORS configuration. A Railway
Postgres service sits behind it.

Status: the repo is deploy-ready. Build, migrations, bootstrap and the main API
write paths have been verified against a real PostgreSQL 16.

> **This is a staging deployment.** Several known security issues are still open
> (see "Before real data" at the bottom). Do not put real employee or payroll
> data in it yet.

---

## 1. Get the code to GitHub

Railway deploys from a Git repository. From Terminal on your Mac:

```bash
cd "~/Downloads/Timesheet copy"
git add -A
git commit -m "chore: prepare for Railway deployment"
```

Then create an **empty private repo** on github.com (no README, no .gitignore),
and push to it:

```bash
git remote add origin https://github.com/<your-username>/elite-timesheet.git
git branch -M main
git push -u origin main
```

Nothing sensitive is committed: `.env`, `key.rtf`, `*.sqlite`, `.db_snapshot.json`
and the `scratch_*` folders are all in `.gitignore`.

## 2. Create the Railway project

1. Sign in at railway.app with GitHub.
2. **New Project → Deploy from GitHub repo →** pick the repo.
3. The first build will fail or crash-loop until step 3 and 4 are done. That is expected.

## 3. Add Postgres

In the project: **+ New → Database → Add PostgreSQL**. Railway creates it with a
private network hostname and exposes `DATABASE_URL` on that service.

## 4. Set the variables

Open the **app service → Variables** tab and add:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NPM_CONFIG_INCLUDE` | `dev` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (use Railway's variable reference) |
| `JWT_SECRET` | 64 random hex chars — `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | another 64 random hex chars |
| `REQUIRE_SESSION_ID` | `true` |
| `PLATFORM_ADMIN_EMAIL` | your email |
| `PLATFORM_ADMIN_PASSWORD` | 8+ chars, at least one letter and one digit |
| `SEED_DEMO_ORG` | `true` |
| `DEMO_ORG_NAME` | e.g. `Monash Demo Clinic` |
| `DEMO_ADMIN_EMAIL` | a second email you can use as the org admin |
| `DEMO_ADMIN_PASSWORD` | 8+ chars, letter + digit |

Notes:

- **`NODE_ENV=production` is not optional.** Without it the app falls back to the
  placeholder JWT secret committed in the repo, and stops requiring a server-side
  session id on each request.
- **`NPM_CONFIG_INCLUDE=dev` is also not optional.** `NODE_ENV=production` makes
  npm skip devDependencies, which would leave the build without TypeScript and Vite.
- TLS to the database is disabled automatically for `*.railway.internal` hosts.
  Set `DB_SSL=true` only if you point at an external Postgres that requires it.

Optional — email (invitations, password resets, 2FA codes):

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=Elite Timesheet <noreply@yourdomain.com>
```

Without these, invites and password resets will not send. You can still create
organisations from the platform console (it exposes the invite link directly).

## 5. Deploy and generate a domain

Trigger a redeploy. Then **Settings → Networking → Generate Domain** to get a
`*.up.railway.app` URL. Optionally set `PUBLIC_URL` to that URL.

What happens on each deploy:

```
npm install            # includes devDependencies, per NPM_CONFIG_INCLUDE
npm run build          # tsc for the backend, tsc -b && vite build for the frontend
npm start              # migrate up -> bootstrap -> node dist/index.js
```

Migrations and the bootstrap script both run on every boot and are idempotent:
migrations are tracked in a `pgmigrations` table, and bootstrap does nothing once
any user exists. Railway waits for `/health` before routing traffic.

## 6. First login

- **Platform console:** `https://<your-app>/platform-gate` with
  `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`. This is the hidden gate —
  the normal login page will not accept a platform admin.
- **The app itself:** `https://<your-app>/login/<demo-org-slug>` with the demo
  admin credentials. The slug is derived from `DEMO_ORG_NAME`
  (`Monash Demo Clinic` becomes `monash-demo-clinic`); the deploy logs print it.

To add a new organisation later, use the platform console's invite flow. If email
is not configured, tick **Emergency Debug URLs** there to copy the setup link.

## 7. Day-to-day

- Push to `main` and Railway rebuilds and redeploys.
- Deploy logs and Postgres metrics are in the Railway dashboard.
- To connect to the database from your Mac, copy the **public** connection string
  from the Postgres service's Connect tab.
- Roughly US$5/month covers the app plus a small Postgres on the starter plan.

---

## What changed to make this deployable

| Change | Why |
|---|---|
| `backend/migrations/1789367660479_align_schema.js` | The template literals were written with escaped backticks, so the file was a syntax error and `node-pg-migrate` aborted. Migrations 479-481 had therefore **never run** — everything worked only because development uses an in-memory mock schema. |
| `backend/migrations/1789367660482_production_alignment.js` (new) | Converts `audit_logs.details` from JSONB to TEXT, adds `login_verification_challenges.attempts` and two `audit_logs` columns the dev schema has, and adds indexes for the hot query paths. About half of the 34 audit-log writes pass a plain string, which JSONB rejects with `22P02` — that alone broke employee creation, locking, approvals and most other mutations on real Postgres. |
| `backend/src/index.ts` | Serves `frontend/dist` with an SPA fallback so client-side routes survive a refresh; adds `/health`; returns JSON (not HTML) for unknown `/api` routes; allows `PATCH` in CORS, which `PATCH /api/announcements/permissions` needs; binds `0.0.0.0`; skips the local `key.rtf` API-key scraping in production. |
| `backend/src/services/db.ts` | Disables TLS automatically for `*.railway.internal` and localhost, so the Railway private network connects without extra configuration. |
| `backend/src/scripts/bootstrap.ts` (new) | A freshly migrated database has no users at all, so nobody could log in. Creates the first Platform Admin, and optionally a demo org with a Company Admin. Idempotent. |
| `frontend/src/services/apiClient.ts` | The API base defaults to the relative `/api` in production builds, keeping the dev behaviour (`localhost:4000`) intact. |
| `package.json`, `backend/package.json` | Root `build` and `start` scripts, a `release` step that migrates and bootstraps, Node 22 pinned, and `node-pg-migrate` moved to runtime dependencies because the release step needs it. |
| `railway.json` (new) | Build command, start command, `/health` check, restart policy. |

## Before real data

These were found during the code review and are **not** fixed:

1. `POST /api/locks` writes both lock columns on every call, so a roster-lock
   password clears `timesheet_locked` — an approved period becomes editable.
2. `POST /api/auth/verify-login` accepts a bare 6-digit code with no email or
   challenge id and issues a session for whoever owns that code.
3. `sessionService.validateSession` returns `{ valid: true }` when the sessions
   table is missing, so a schema problem silently disables session enforcement.
4. Reset and invitation lookups accept `token_hash = sha256(token) OR token_hash = token`,
   so a leaked hash works as the token itself. Org invite tokens are stored in
   plaintext with no expiry and returned by `GET /api/platform/invitations`.
5. `POST /api/employees` does not validate the `role` field against an allowlist,
   so a Company Admin can create a Platform Admin.
6. `rosterService.ts` treats Friday as a weekend and Sunday as a weekday.
7. `reportService.ts` drops `Normal` segments from the payroll breakdown and
   deducts the break a second time on hours that were already net.
