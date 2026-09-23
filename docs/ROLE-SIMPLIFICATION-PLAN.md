# SimpleHours — Two-Role Simplification: Cleanup Inventory & Implementation Plan

> **2026-09-23 update — partially reversed.** On this same branch, later the same day, the
> Employee role, employee login/portal and leave-request workflow described as removed below were
> deliberately rebuilt on top of the two-role model this document establishes (`policy.ts`'s
> `ROLE_PERMISSIONS.EMPLOYEE` is an empty set, so the two-role guarantees below still hold for
> Owner/Branch Admin — Employee is additive, not a third peer role with its own permissions). See
> `docs/EMPLOYEE-PORTAL-PLAN.md` for what changed and why. Read the rest of this document as a
> historical record of the two-role migration, not as a current description of what exists —
> `employees.user_id`, `leave_requests`, and the employee-facing routes/pages it lists as dropped
> all exist again, in new shapes.

| | |
|---|---|
| Status | Working document for branch `refactor/two-role-model` (from `7fa3094`) |
| Date | 2026-09-21 |
| Supersedes | The six-role model in the six source-of-truth documents. Those documents are rewritten in the last phase of this plan; this file is folded into `IMPLEMENTATION-PLAN.md` and deleted at that point. |
| Baseline | `npm test`: 22 suites, 279 tests, **277 pass / 2 fail** (both pre-existing, `organisation_hierarchy_and_permissions.test.ts:550,580`). 21 of 22 suites run on hand-written pg-mem schemas. |

Target model:

```
Organisation ── owner (exactly one OWNER account)
   └── Branches ── Branch Admin assignments (0..n BRANCH_ADMIN accounts per branch; one account may hold many branches)
          └── Workers (operational records: rostered, timesheeted, reported — never log in)
```

---

# Part A — Cleanup inventory

## A1. Roles that exist today

| Vocabulary | Values | Where |
|---|---|---|
| Legacy title-case | `Platform Admin`, `Company Admin`, `Manager`, `Employee`, `Owner`, `Admin` | `users.role`, `organisation_members.role` (CHECK allows the first four only), JWT `role`, ~40 string comparisons |
| Lower-case branch | `manager`, `admin`, `employee` | `location_memberships.role`, `location_invitations.role` (CHECKs) |
| Canonical upper-case | `OWNER`, `ORG_ADMIN`, `ORG_MANAGER`, `BRANCH_ADMIN`, `BRANCH_MANAGER`, `EMPLOYEE` | `permissionService.ts` enums; written by `memberships.ts` (violates both CHECKs on real PostgreSQL) |
| Planned, never built | `ORG_OWNER`, `PAYROLL`, `PLATFORM_ADMIN` | docs only |

Retained: **`OWNER`**, **`BRANCH_ADMIN`**. Everything else is removed.

## A2. Role storage locations (five competing authorities)

| Store | Read by | Fate |
|---|---|---|
| `users.role` | login default role, Platform Admin detection, `getUserOrganisations` | drop column |
| `users.org_id` (FK CASCADE — deleting an org deletes users) | generic login default org, org list | drop column |
| `organisation_members.role` (+ `is_active`, never enforced) | JWT role source, `requireOrgOwner`, `permissionService` | drop table |
| `organisations.owner_user_id` (nullable, `ON DELETE SET NULL`) | OWNER resolution | **keep — the single authority for OWNER**; becomes `ON DELETE RESTRICT` + `CHECK (owner_user_id IS NOT NULL OR is_active = false)` |
| `location_memberships.role` | branch permissions | table replaced by `branch_admins` (no role column — a row *is* the assignment) |
| JWT `role`, `organisation_id`, `location_id` claims | `requireRole`, Platform Admin bypass, legacy branch filters, frontend route guards | removed — token carries `sub` + `sid` only |
| `login_verification_challenges.role` | re-minted into the post-challenge JWT | drop column |
| `sessions.location_id` | "active branch" security context | drop column |
| `employees.user_id` | employee self-service, display names | drop column (workers are not accounts) |
| Frontend `jwtDecode(token).role`, `localStorage.simplehours_security_context` | route guards, nav | removed — one `/auth/me` capability payload |

**Owner model decision (§6 of the brief):** `organisations.owner_user_id`. It already exists, the database can enforce "an active organisation always has an owner" with a constraint (a membership model needs an application-level "last owner" invariant), and transfer is one audited `UPDATE`. No second representation is kept.

## A3. Role-related database structures

| Structure | Code refs | Fate |
|---|---|---|
| `organisation_members` | auth, memberships, employees, locations, platform, bootstrap, middleware | archive → drop |
| `location_memberships` | permissionService, memberships, locations, auth, platform | backfill `branch_admins` → archive → drop |
| `location_invitations` (plaintext `token` column) | locations, platform | replaced by `branch_admin_invitations` (hash only) → archive → drop |
| `invitation_tokens` (employee account invites) | auth (`/invitation`, `/claim-invitation`), employees | archive → drop |
| `org_invitation_tokens` (plaintext, no expiry) | platform | replaced by `organisation_signups` (hash only, expiring) → drop (tokens were exposed; nothing to preserve) |
| `users.role`, `users.org_id` | see A2 | archive → drop |
| `employees.user_id` | see A2 | archive → drop |
| `organisations.timesheet_entry_mode` (+CHECK) | organisation, portal, submissions, SetupOrganisation, Settings | drop (only admins enter hours) |
| `organisations.allow_employee_chat` | announcements | drop |
| `organisations.is_public_searchable` | written by bootstrap only; `discover` endpoint | drop |
| `audit_logs.scope` `'platform'` value | platform audit view (always empty — never written) | CHECK narrowed; column kept |
| `fortnight_locks` UNIQUE(`org_id`,`start_date`) | locks, records, submissions, roster, portal, reports | gains `location_id NOT NULL`; UNIQUE(`org_id`,`location_id`,`start_date`) |
| `employees.location_id` nullable, `ON DELETE SET NULL` | every branch filter ("NULL = visible to all branches") | backfilled → `NOT NULL`, `ON DELETE RESTRICT` |
| `leave_requests` | portal (create), organisation (list/review), dashboard | workflow removed (needs an employee login to create a request); approved leave already lives in `shift_segments`. Archive → drop |
| `timesheet_submissions.status` (no CHECK) | submissions, records, roster, reports, dashboard | `Submitted`/`Under Review`/`Rejected` → `Draft`; CHECK (`Draft`,`Approved`) |
| `backend/src/services/db.ts` pg-mem schema (no FKs/CHECKs, seeds `password123` accounts, JSON snapshot) | dev `DATABASE_URL=memory`, 21 test suites | deleted — dev and tests run on migrated PostgreSQL only |

Nothing is destroyed: the contract migration copies every dropped table/column into one generic `legacy_archive (source, row jsonb, archived_at)` table before dropping. That table has no code references and can be dropped after the deployed data has been checked.

## A4. Role / permission checks

- `middleware/auth.ts`: `requireRole`, `requireOrgOwner` (3 fallbacks incl. JWT role), `requireLocationContext` (unused, 4 fail-open paths), `requireTimesheetMode` (unused), `requirePermission`, `requireAnyBranchPermission`, `requireAnyPermission` (passes if permission held in *any* branch after the explicit branch check failed), branch id read from params/query/body/`x-location-id`/JWT.
- `permissionService.ts`: 20 permission keys, two role enums, two normalisers, Platform-Admin-gets-everything, JWT-role fallback, "organisation has no branches ⇒ org-wide access" (returns `true` on DB error), five `catch {}`.
- Legacy string checks: `records.ts:71,97,126,220`, `employees.ts:17,224`, `dashboard.ts:62-68`, `audit.ts:12`, `announcements.ts:63,156,413,445,473`, `submissions.ts:91`, `auth.ts` (25 hits), `memberships.ts`, `platform.ts`, `bootstrap.ts`.
- Frontend: `App.tsx` `ProtectedRoute` (18 hits), `usePermissions.tsx` (legacy fallback + client-side role→permission map), `Settings.tsx`, `Employees.tsx` (role selector offering "Company Admin"), `Layout.tsx`, `Announcements.tsx`, `Login.tsx`, `OrgLogin.tsx`, `HelpChatbot.tsx`, `LockPasswordsModal.tsx`, `Pricing.tsx`, `PublicLayout.tsx`.

## A5. Backend routes

| Router | Fate |
|---|---|
| `platform.ts` (Platform Admin console API + org claim) | **deleted**; org creation moves to `signup` routes |
| `portal.ts` (employee self-service) | **deleted** |
| `memberships.ts` (org/branch role CRUD, 713 lines) | **deleted**; replaced by a small owner-only `branchAdmins.ts` |
| `locations.ts` | branch CRUD kept (owner); invite verify/accept rewritten for Branch Admin invitations |
| `auth.ts` | remove `platform-login`, `select-location`, `invitation`, `claim-invitation`, Platform Admin branches, role/org/location claims; keep login, verify-login, 2FA, sessions, reset, `/me`, `/organisations`, `switch-organisation` |
| `organisation.ts` | remove `discover`, leave list/review; `lookup/:slug` reduced to name/logo by `portal_slug` only; settings owner-only |
| `employees.ts` | worker records only: remove `role`, `user_id`, `send-invitation`, user-account side effects; branch-authorised per worker |
| `records.ts`, `roster.ts`, `submissions.ts`, `locks.ts`, `reports.ts`, `dashboard.ts` | re-guarded with the policy layer; branch derived from the worker row |
| `submissions.ts` | remove `submit`, `review`, `reject`; keep list, `approve`, `bulk-approve`; add `reopen` |
| `audit.ts`, `xero.ts`, `holidays.ts` (writes) | owner only |
| `announcements.ts` | kept as the management noticeboard; owner moderates; chat toggle removed |

## A6. Frontend

Deleted pages: `Portal.tsx` (1785, orphan), `PlatformAdmin.tsx`, `auth/PlatformGate.tsx`, `EmployeeTimesheet.tsx`, `EmployeeSchedule.tsx`, `EmployeeHistory.tsx` (hard-coded fake data), `AcceptInvite.tsx`, `SetupAccount.tsx`, `LeaveRequests.tsx`, `public/PortalAccess.tsx`, `Login.tsx` (generic login + organisation picker; login is via the private organisation URL).
Rewritten: `App.tsx` routes/guards, `usePermissions.tsx` → capability hook fed only by `/auth/me`, `Layout.tsx` nav, `Dashboard.tsx` (management view only), `Employees.tsx` (no role selector / invites), `Locations.tsx` (Branch Admin assignment + invitations), `Settings.tsx`, `SetupOrganisation.tsx` (self-serve owner signup), `AcceptLocationInvite.tsx` → Branch Admin invite accept, `HelpChatbot.tsx`/`OnboardingTutorial.tsx` copy, hidden platform-gate easter eggs in `PublicLayout.tsx`.
New: shared `SegmentEditor` used by the roster cell editor.

## A7. Tests

22 suites / 8,141 lines. 21 build pg-mem schemas by hand and mint session-less JWTs carrying role strings. All are rewritten onto the migrated PostgreSQL harness (`tests/helpers/testDb.ts`) with real sessions. Suites whose subject is deleted go with it (`platform_secret_login`, `invitations` (employee), the employee-portal parts of `stage3/4/5`, `organisation_discovery_and_security`). Pure unit suites (`timeParser`, `classification`) stay.

## A8. Config / repo debris

- Env: `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` removed; `SEED_DEMO_ORG`/`DEMO_*` kept for the demo-owner seed; `.env.example` lists 4 of 17 variables actually read; `render.yaml` sets `SEED_DEMO_ORG=true` with `NODE_ENV=production`.
- Dead: `legacy-backend/` (tracked `database.sqlite-shm/-wal`), `legacy-index.html`, `legacy-agent.md`, `skill-creator/` (vendored, unrelated), `render.yaml` (unused alternative deploy), `frontend/README.md` (Vite template), `frontend/src/assets/{react,vite}.svg`, `hero.png` (check refs), `key.txt/key.rtf` scraping in `index.ts`.
- Old branding "Elite Timesheet OS": `package.json` name, `emailService.ts` templates, `README.md`, `DEPLOY.md`, `agent.md`, `render.yaml`, `railway` service name (external — not renamed).
- `audit_logs` failed-login rows written under placeholder org UUID `123e4567-…` (FK fails silently) — removed; `login_history` already records them.

## A9. Security findings and their status on this branch

| ID | Finding | Status at `7fa3094` | Action |
|---|---|---|---|
| C1 | Tenant admin can mint `Platform Admin` | allow-listed | **structurally removed** — no role input on any endpoint; only the owner creates Branch Admins |
| C2 | Invite token ⇒ authentication | existing accounts must be signed in | kept; new flow never issues a session from a token |
| C3 | Bare verification code | challenge-bound | kept; challenge no longer carries a role |
| C4 | Mail rerouted to personal address | removed | verified; fails closed |
| C5–C21, D-1…D-28 | cross-branch/IDOR/fail-open/self-approval/token handling/lock side-effect/Origin-built links | open | closed by the policy layer, per-branch locks, hash-only tokens, `PUBLIC_URL` links; self-approval and employee-visibility items disappear with worker logins |

---

# Part B — Target architecture

## B1. Authorisation (single model)

```
requireAuth:  JWT {sub, sid} → session row (active, idle ≤15m, age ≤24h) → session.org_id
              → organisation active → access = owner? | branch_admins rows   (none ⇒ 401)
ctx = { userId, orgId, role: 'OWNER' | 'BRANCH_ADMIN', branchIds: 'ALL' | Set<uuid> }
```

- `authorize(ctx, permission)` — organisation-level permissions.
- `authorizeBranch(ctx, permission, branchId)` — `branchId` always loaded from the resource row (`WHERE id = $1 AND org_id = ctx.orgId` → 404 when absent; out-of-scope branch → 403).
- `branchScope(ctx, requestedFilter?)` — list filter; a requested branch outside scope → 403, never widened, never silently ignored.
- Any error ⇒ 500 / deny. No `catch {}` in the authz path, no role strings, no client-supplied scope, no "no branches" fallback.
- A route-inventory test walks the Express router and fails if a route is neither on the public allow-list nor declares a policy.

| Permission | OWNER | BRANCH_ADMIN (assigned branches) |
|---|:-:|:-:|
| `organisation.manage`, `security.manage`, `branches.manage`, `branch_admins.manage`, `audit.view`, `integrations.manage`, `holidays.manage` | ✓ | — |
| `branch.view`, `workers.manage`, `rosters.manage`, `timesheets.manage`, `timesheets.approve`, `periods.lock`, `reports.view`, `announcements.post` | ✓ (all branches) | ✓ |
| `announcements.moderate` | ✓ | — |

Billing has no code and gets no permission key.

## B2. Schema (migrations `…600` expand/backfill, `…601` contract)

- `users`: + `full_name`; − `role`, − `org_id`; `UNIQUE (LOWER(email))`.
- `organisations`: `owner_user_id` FK `RESTRICT` + active-implies-owner CHECK; − `timesheet_entry_mode`, − `allow_employee_chat`, − `is_public_searchable`.
- `locations`: + `UNIQUE (org_id, id)`.
- **`branch_admins`** (`org_id`, `location_id`, `user_id`, `assigned_by`, `created_at`; `UNIQUE(location_id,user_id)`; composite FK (`org_id`,`location_id`) → `locations`).
- **`branch_admin_invitations`** (`org_id`, `email`, `token_hash` UNIQUE, `location_ids uuid[]`, `invited_by`, `expires_at`, `accepted_at`, `revoked_at`, delivery fields).
- **`organisation_signups`** (`email`, `token_hash` UNIQUE, `expires_at`, `used_at`, delivery fields).
- `employees`: `location_id NOT NULL` `RESTRICT`; − `user_id`.
- `fortnight_locks`: + `location_id NOT NULL`; new UNIQUE.
- `sessions` − `location_id`; `login_verification_challenges` − `role`.
- `timesheet_submissions`: status CHECK; `shift_segments`: `Normal` → `WORK`, type CHECK (`WORK`,`Sick`,`Annual`,`TIL`,`LWIP`,`Other`).
- Dropped after archiving: `organisation_members`, `location_memberships`, `location_invitations`, `invitation_tokens`, `org_invitation_tokens`, `leave_requests`.

Backfill (access-preserving, nothing new granted): owner = `owner_user_id` → else earliest `Company Admin`/`Owner`/`OWNER` member → else org set inactive (reported). Other org-level admins and every branch `manager`/`admin` member → `branch_admins` rows (org-level admins: all branches). Branch `employee` members, org-level `Manager` without a branch, `Employee` and `Platform Admin` accounts → no access (rows kept, archived, reported). Branchless orgs get a "Main Branch"; workers with no branch move to the org's earliest branch.

## B3. Roster / timesheet segments

One segment model (`shift_segments`), one reusable `SegmentEditor`:
- Simple day stays one row: `09:00 → 17:00  Normal Work`.
- `+ Add segment` starts at the previous segment's end and inherits nothing else; types: Normal Work, Sick Leave, Annual Leave, TIL, LWIP, Other.
- Validation (client **and** server): overlap, backwards/zero-length, empty rows, exact duplicates.
- Breaks: the day's break is deducted **once**, from the longest segment, when the day's total span reaches the threshold — fixes today's per-segment rule, which deducts twice for two long segments and never for a split 8-hour day.
- Copy tools: copy previous day, copy a day to selected days, apply to a multi-cell selection.
- Rostering still never overwrites actuals; approved and locked periods stay immutable; every write goes through `authorizeBranch`.

---

# Part C — Implementation plan

| # | Phase | Commit(s) |
|---|---|---|
| 1 | Schema: migrations `…600`/`…601`, migration tests on PostgreSQL with seeded legacy data (row counts preserved, FKs/UNIQUE/CHECK, no orphans, archive contents) | `feat(db): two-role schema …` |
| 2 | Auth core: `policy.ts` replaces `permissionService.ts`; new `requireAuth`; token = `sub`+`sid`; delete all other guards; remove pg-mem (`db.ts`), dev runs on docker `db` | `refactor(auth): single authorisation model` |
| 3 | Account flows: owner signup, Branch Admin invitations/assignment, ownership transfer, login/2FA/challenge without roles, hash-only tokens, `PUBLIC_URL` links, bootstrap = optional demo owner | `feat(accounts): …` |
| 4 | Operational routers re-guarded + per-branch locks + submissions simplification; delete `platform.ts`, `portal.ts`, `memberships.ts`, leave routes | `refactor(api): branch-scoped operational routes` |
| 5 | Segments: shared validation + day-level break rule in `timeParser`/`records`/`rosterService`/`classificationService`; LWIP/Other through reports | `feat(roster): segment model …` |
| 6 | Frontend: routes, capability hook, nav, page deletions, Branch Admin management UI, `SegmentEditor`, copy tools | `refactor(frontend): …`, `feat(roster-ui): …` |
| 7 | Tests: authorisation matrix (owner / branch admin A / branch admin A+B / other-org owner / anonymous × every route; param, body, query, header tampering), role-deletion guard test, route-inventory test, migration tests | with each phase |
| 8 | Repo cleanup: legacy directories, branding, env files, `DEPLOY.md`, `README.md` | `chore: remove legacy …` |
| 9 | Documentation: rewrite the six documents + `agent.md`; fold this file into `IMPLEMENTATION-PLAN.md` | `docs: two-role architecture` |
| 10 | Verification: `npm run typecheck`, `npm test`, frontend lint, build, migrations up/down, preview smoke test, role-string sweep, final diff review | — |
