# Elite Timesheet OS Pro - Agent Guidelines & Engineering Protocol

This document outlines the architecture, engineering standards, and mandatory verification protocols for any AI agent or developer working on **Elite Timesheet OS Pro** (product name: **SimpleHours**).

---

## 📚 Source of Truth — Read Before Changing Anything

These documents are the authoritative specification for SimpleHours. Read the relevant ones before any feature, schema, auth or permission change. If code and documents disagree, raise it — do not silently "fix" either one.

| Document | Covers |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product scope, hierarchy, roles, permission matrix, known defects, deferred items |
| [docs/TRD.md](docs/TRD.md) | Architecture, authentication, role + scope + permission model, tenant/branch isolation, security, testing |
| [docs/UI-UX-DESIGN.md](docs/UI-UX-DESIGN.md) | Information architecture, navigation by role, screen behaviour, design system |
| [docs/APP-FLOW.md](docs/APP-FLOW.md) | Every important flow with its backend action, authorisation check and failure states |
| [docs/BACKEND-SCHEMA.md](docs/BACKEND-SCHEMA.md) | Current schema assessment, target schema, constraints, migration strategy |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Phased delivery order, completion criteria, open decisions |
| [docs/ROLES-AND-PERMISSIONS.md](docs/ROLES-AND-PERMISSIONS.md) | **Current** roles, permissions, scope, escalation rules, organisation switching and the API. Wins over the six documents above wherever they describe roles differently. |

`docs/security/hierarchy-audit-and-design.md` is an earlier audit and design proposal. Its findings are mapped into `docs/PRD.md` §12, and its design is reconciled in `docs/IMPLEMENTATION-PLAN.md` §R. Where it differs from the six documents, the six documents win.

Documents label everything **[CURRENT] / [REQUIRED] / [PROPOSED] / [DEFERRED]**. Never describe or treat planned functionality as already implemented.

### Non-negotiable architecture rules

1. **The hierarchy is fixed:** Organisation → Branch → User → Assignment → Role → Scope → Permission → Resource. Do not change it without updating the documents and getting approval. An assignment is one person holding one role *with its scope*; effective access is the union of a person's assignments (`docs/ROLES-AND-PERMISSIONS.md`).
2. **Roles and scopes are separate.** A role is only a set of permissions; where it applies (the entire organisation, or chosen branches) belongs to each assignment. Organisation-level permissions (users, roles, audit, security, organisation settings, branches) only count from an entire-organisation assignment.
3. **One person, one account.** A user may hold many assignments (e.g. Admin at one branch, Payroll Manager at another) and be an employee as well. Never require a second account.
4. **Authorisation is server-side only.** Every protected request checks authentication → session → organisation membership → assignments → scope → permission → resource relationship. Frontend hiding is **not** security.
5. **Organisation isolation is mandatory.** The active organisation comes from the server session only. Never trust a client-supplied `organisation_id`.
6. **Branch isolation is mandatory.** Authorise against the resource's own branch as stored in the database. Never trust a client-supplied `location_id`/`branch_id`/`x-location-id` to choose permissions.
7. **Ask for permissions, never for roles.** Code asks "does this caller hold permission P (in branch B)?" (`requirePermission`, `loadWorker`, `resolveBranchFilter` in `services/policy.ts`). Never branch on a role name or `system_key` outside role administration; a test enforces it. The Owner is `organisations.owner_user_id` and holds every permission organisation-wide; the Employee role is the linked worker record and holds only the employee-portal permissions; everyone else has exactly what their assignments grant.
8. **Deny by default.** Errors, missing data or ambiguous scope must deny, never `next()`.
9. **No self-escalation.** Nobody gives, changes or takes away access they do not hold themselves; nobody edits their own access; nobody assigns or removes the owner (`services/roleAdmin.ts`). Ownership moves only through the owner's password-confirmed, audited transfer. Nobody approves their own timesheet or leave.
10. **Never destructively delete production data without verification** — follow the expand → migrate → verify → contract process in `docs/BACKEND-SCHEMA.md` §9, with a backup and explicit approval.
11. **Authorisation changes require tests** — add or update cases in the authorisation matrix (`tests/security/authorisation_matrix.test.ts`), the per-permission tests (`permission_enforcement.test.ts`) and the escalation tests (cross-organisation, cross-branch, IDOR, escalation). Tests run against real PostgreSQL.
12. **A new permission arrives with the feature it guards**, in three places at once: `services/permissions.ts`, a migration that seeds the `permissions` table (a test compares the two), and the route that uses it. Do not add permissions for capabilities the product does not have.
13. **Organisation switching needs the account password again** (`POST /auth/reauthenticate`, then `/auth/switch-organisation`); the frontend reloads and clears all remembered branch state afterwards.

---

## 🔐 Private sign-in links — `/login` is not a sign-in page

- `/login` is intentionally **not** a public authentication entry point. The server answers it (and every unknown page, and any invalid `/login/<token>`) with a real HTTP **404**; an expired link gets **410**. Never add a login form, link or redirect at `/login`.
- People sign in only through their organisation's private link, `/login/<token>`. The token is 128-bit, looked up by SHA-256 hash, kept AES-256-GCM encrypted (never in plain text), optionally expiring, and revoked by regenerating. All of it lives in `backend/src/services/portalLink.ts`; page statuses in `backend/src/services/pageRoutes.ts`. Details: `docs/TRD.md` §4.1a.
- Adding a frontend route? Add its path to `PAGE_PATHS` in `pageRoutes.ts` too — a test compares it with `App.tsx`, and a missing path would be a 404.
- The link is only ever returned to the Owner (and as `portal_path` in the sign-in response). Don't add it to `/auth/me` or other shared responses.

## 🧭 UX conventions (see `docs/UI-UX-DESIGN.md` §15a)

- Navigation shows only what the person can use — leave items out, never show them disabled. Frontend hiding is never the security: the API must refuse too.
- Timesheet status: always `TimesheetStatusBadge` (Draft → Approved → Locked); leave status: `LeaveStatusBadge`. Never colour alone.
- Errors: `friendlyError()` from `services/errors.ts` — no raw codes, `403`, or field names in front of users. A failed load shows an error with "Try again", never an empty state.
- Empty states say what is missing, why it matters, and offer the next action.
- The walkthrough targets `data-tour="…"` attributes and listens for `tourSignal(...)` events (`components/tour/`). Keep them when you change those screens.

---

## 🛠 Tech Stack & Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router v7.
  - Theming: Full CSS theme variable support (`var(--bg)`, `var(--panel)`, `var(--text)`, `var(--border)`, `var(--input-bg)`). Both Dark and Light modes must look clean and high-contrast.
- **Backend**: Node.js, Express, TypeScript, JWT auth with bcrypt password hashing.
- **Database**: PostgreSQL only — the schema is owned by `backend/migrations` (node-pg-migrate). The in-memory `pg-mem` option was removed; locally run `docker compose up -d db` (dev) or `db-test` (port 55432, used by `npm test`).
- **Core Services**:
  - `timeParser.ts`: Smart flexible time input parsing (`9` -> `09:00`, `9a` -> `09:00`, `1700` -> `17:00`) and break deduction calculations.
  - `periodUtils.ts`: Fortnight boundary anchor calculations.
  - `rosterService.ts`: Auto-Roster, Auto-Log, Variance, and Leave stats calculations.

---

## ⚠️ MANDATORY VERIFICATION PROTOCOL (MUST RUN BEFORE FINISHING)

Before completing any task or user request, you **MUST** run the TypeScript debugging check:

```bash
# 1. Run TypeScript Typecheck & Build across both backend and frontend workspaces
npm run typecheck

# 2. Run backend unit tests (using bypass sandbox if needed for loopback sockets)
npm test
```

### Requirements:
1. **Zero TypeScript Errors**: Both `backend` (`tsc`) and `frontend` (`tsc -b && vite build`) must exit with code 0.
2. **Zero Unused Imports/Variables**: Strict TS mode forbids unused imports/variables.
3. **Preserve Existing Functionality**:
   - Rostering shifts must NEVER overwrite or delete existing timesheet actuals (`actual_in`, `actual_out`, `actual_hours`).
   - Default roster templates must autosave instantly without requiring a separate manual save click.
   - Shift overlaps must be prevented with a clear user alert.
   - Color coding must reflect timesheet actuals and highlight unplanned shifts/exceptions.
   - Date range selector must open the calendar picker (`showPicker()`).
   - All interactive buttons must trigger their full end-to-end API workflows.
4. **Mandatory Automated End-to-End & Regression Test Suite**:
   - Every API flow, database modification, and invitation/auth lifecycle MUST have automated integration tests executed (`npm test`) covering happy paths, edge cases (invalid tokens, reuse, unauthorized calls), and schema consistency.
   - Any background dev server running old in-memory code must be cleanly restarted and verified against real HTTP endpoints before handing work back to the user.

---

## 🧰 Available Skills

### Caveman (`/caveman`)
- **Purpose:** Development communication / token efficiency.
- **Use during:** Implementation, debugging, code review and development sessions where concise output is useful.
- **Installed at:** user level, `~/.claude/skills/caveman` (from `mattpocock/skills`). Turn off with "stop caveman" or "normal mode".
- **Never compress away** (write these out in full, even in caveman mode): security findings, failed tests, authentication problems, permission problems, database changes, migration issues, deployment failures, and important implementation decisions. Caveman never replaces the Mandatory Verification Protocol above.

### Brag (`/brag:brag`, `/brag:brag-slim`)
- **Purpose:** Product/demo presentation — short launch/demo videos (roster workflow, dashboard, employee and mobile experience, finished UI).
- **Use during:** Marketing and presentation work, only after functionality has been implemented and browser-tested.
- **Do not** use Brag as a development or testing tool, or to implement SimpleHours functionality. It writes only to `brag-output/` and needs Node 22+, FFmpeg and `npx hyperframes` when run.
- **Installed at:** plugin `brag@brag` (marketplace `latent-spaces/brag`), local scope for this project — enabled in `.claude/settings.local.json`.

---

## 🤖 SUBAGENT WORKFLOW PROTOCOL

When working on features or complex tasks:
1. **Subagent Delegation for Research & Coding**: Use subagents for research to explore codebase patterns, trace backend/frontend implementations, and gather technical requirements. Use dedicated subagents for implementation steps when applicable.
2. **Research First, Plan Second**: Always conduct thorough subagent research before generating or presenting implementation plans.
3. **Formal Planning Phase**: Present a clear implementation plan for review prior to executing multi-step functional code changes.

