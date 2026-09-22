# Deploying to Railway

This app deploys as **one Railway service**: the Express backend serves the built
React app, so there is a single URL and no CORS configuration. A Railway
Postgres service sits behind it.

Status: the repo is deploy-ready. Build, migrations, bootstrap and the main API
write paths have been verified against a real PostgreSQL 16.

> **This is a staging deployment.** Read "Before real data" at the bottom before
> loading real worker or payroll data.

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
| `PUBLIC_URL` | the app's public URL (used in every emailed link) |
| `SEED_OWNER_EMAIL` | optional — your email, to create a first organisation on an empty database |
| `SEED_OWNER_PASSWORD` | optional — 8+ chars, at least one letter and one digit |
| `SEED_ORGANISATION_NAME` | optional — e.g. `Monash Demo Clinic` |

Notes:

- **`NODE_ENV=production` is not optional.** The app refuses to start in production
  with the placeholder JWT secret, and only allows local CORS origins outside production.
- **`NPM_CONFIG_INCLUDE=dev` is also not optional.** `NODE_ENV=production` makes
  npm skip devDependencies, which would leave the build without TypeScript and Vite.
- TLS to the database is disabled automatically for `*.railway.internal` hosts.
  Set `DB_SSL=true` only if you point at an external Postgres that requires it.

Email (organisation sign-up, Branch Admin invitations, password resets, 2FA codes):

```
EMAIL_PROVIDER=smtp
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=587
SMTP_SECURE=tls
SMTP_USERNAME=noreply@yourdomain.com
SMTP_PASSWORD=...
EMAIL_FROM=SimpleHours <noreply@yourdomain.com>
```

(`EMAIL_PROVIDER=resend` with `RESEND_API_KEY=re_...`, or `EMAIL_PROVIDER=postmark` with
`POSTMARK_SERVER_TOKEN=...`, both still work if you'd rather use an HTTP API provider.)

Without these, nothing that needs an emailed link works: sign-up is refused and
invitations are created but not delivered. Links are never shown in the app or
returned by the API, and mail is never sent anywhere but the named recipient.

## 5. Deploy and generate a domain

Trigger a redeploy. Then **Settings → Networking → Generate Domain** to get a
`*.up.railway.app` URL, and set `PUBLIC_URL` to that URL.

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

- **With `SEED_OWNER_*` set:** the deploy logs print the organisation's private
  sign-in link (`/login/<random code>`). Sign in there as the Organisation Owner.
- **Without it:** open `https://<your-app>/signup`, enter your email, and follow the
  emailed link to create the organisation — you become its Owner.

The Owner then adds branches (Branches page) and invites Branch Admins (Branch
Admins page). Each invitation is emailed, expires after 7 days and works once.
There is no platform-wide administrator account.

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
| `backend/src/index.ts` | Serves `frontend/dist` with an SPA fallback so client-side routes survive a refresh; adds `/health`; returns JSON (not HTML) for unknown `/api` routes; binds `0.0.0.0`. |
| `backend/src/services/db.ts` | Disables TLS automatically for `*.railway.internal` and localhost, so the Railway private network connects without extra configuration. |
| `backend/src/scripts/bootstrap.ts` (new) | A freshly migrated database has no users at all. Optionally creates a first organisation and its Owner from `SEED_OWNER_*`. Idempotent. |
| `frontend/src/services/apiClient.ts` | The API base defaults to the relative `/api` in production builds, keeping the dev behaviour (`localhost:4000`) intact. |
| `package.json`, `backend/package.json` | Root `build` and `start` scripts, a `release` step that migrates and bootstraps, Node 22 pinned, and `node-pg-migrate` moved to runtime dependencies because the release step needs it. |
| `railway.json` (new) | Build command, start command, `/health` check, restart policy. |

## Before real data

The seven issues previously listed here were fixed in the two-role rebuild
(`refactor/two-role-model`), each with a regression test. Still to do before
real worker or payroll data:

1. Rotate `JWT_SECRET`, and configure email with a verified
   sending domain and `EMAIL_FROM`.
2. Confirm which of the two Railway Postgres services `DATABASE_URL` points at,
   and turn on backups with a tested restore.
3. Rate limiting is in memory, so it resets on restart and is per instance. Keep
   the service at one replica until it is moved to a shared store.
4. The suspicious-login check has no real IP geolocation, so it rarely triggers.
   Two-step verification (Settings → My account) is the dependable second factor.
5. After the two-role migrations have been checked on the deployed data,
   `legacy_archive` (a JSON copy of every dropped legacy row) can be dropped.
