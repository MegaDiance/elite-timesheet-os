# SimpleHours

Rostering, timesheets and payroll-hours reporting for organisations with one or more branches.

## Who signs in

SimpleHours has exactly two kinds of account:

| Role | Scope | Does |
|---|---|---|
| **Organisation Owner** | the whole organisation | organisation settings and security, branches, Branch Admins, ownership, audit log — and all roster/timesheet work in every branch |
| **Branch Admin** | the branches assigned to them | workers, roster, timesheets, locks and reports of those branches |

Workers (the people who are rostered and paid) are records, not accounts: they never sign in.
See [agent.md](agent.md) and [docs/](docs/) for the full specification.

## Stack

React 19 + TypeScript + Vite + Tailwind v4 (`frontend/`), Node 22 + Express 5 + TypeScript (`backend/`),
PostgreSQL 16 (schema owned by `backend/migrations`), npm workspaces.

## Local development

```bash
npm install
cp .env.example .env
docker compose up -d db
npm run migrate:up --workspace=backend
npm run dev
```

- Frontend: http://localhost:3000 · API: http://localhost:4000
- Create an organisation at http://localhost:3000/signup — with `EMAIL_PROVIDER=mock` the set-up link is printed in the API console.
  Or set `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` and run `npm run bootstrap --workspace=backend` after `npm run build`.

## Checks

```bash
docker compose up -d db-test   # disposable PostgreSQL 16 used by the test suite
npm run typecheck              # backend tsc + frontend tsc/vite build
npm test                       # backend tests, run against a database built from the migrations
npm run lint --workspace=frontend
```

Deployment: see [DEPLOY.md](DEPLOY.md).
