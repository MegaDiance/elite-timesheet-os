# SimpleHours — Implementation Plan

| | |
|---|---|
| Status | Draft for review — **no phase starts until the six documents are approved** |
| Last audited against code | 2026-09-21, re-baselined on `main` @ `7fa3094` |
| Labels | **[CURRENT] [REQUIRED] [PROPOSED] [DEFERRED]** — see [PRD §0.1](./PRD.md#01-status-labels) |
| Inputs | [PRD](./PRD.md) · [TRD](./TRD.md) · [UI/UX](./UI-UX-DESIGN.md) · [App Flow](./APP-FLOW.md) · [Backend Schema](./BACKEND-SCHEMA.md) · `docs/security/hierarchy-audit-and-design.md` (reconciled in §R) |

> **Coordination note.** On 2026-09-21 a parallel working session committed `d79af08` and `7fa3094` (security hotfixes and a real-PostgreSQL test harness) while these documents were written. Before starting any phase, check `git log` for work already done, and update the phase status here rather than redoing it.

---

## 0. Why this order

The generic order (architecture → database → authorisation → auth → APIs → frontend → workflows → testing → cleanup → deploy) is adjusted for what the audit found:

1. **The hierarchy code is committed but does not work on real PostgreSQL** (D-8). Nothing should build on it until real-PostgreSQL tests cover it. That is **Phase 0**, now partly done.
2. **Several critical defects are cheap to fix and independent of the new model.** Fixing them first shrinks risk while the larger work proceeds. That is **Phase 1**, now partly done in `7fa3094`.
3. **Tests come early.** The authorisation matrix test (TRD §15.2) is written in Phase 3 as the executable specification and turned green phase by phase. Phase 8 is the final adversarial pass.
4. **Private-link login depends on the assignment model** (membership resolution, landing pages, Platform Admin separation), so it follows authorisation.
5. **Schema steps that change runtime behaviour ship with the code that needs them.** For example, per-branch locks (M6) ship with the `locks.ts` rewrite in Phase 5.

Each phase is a separate branch/PR (or small PR series). Merge only when `npm run typecheck` and `npm test` are green (`agent.md`) and the phase's own completion criteria are met.

```
P0 Baseline ─► P1 Critical fixes ─► P2 Schema expand + dual-write ─► P3 Authorisation core ─► P4 Auth & private link
                                                                          │
                                                                          ├─► P5 API scoping ─► P6 Frontend capabilities ─► P7 Workflows
                                                                          │
                                                                          └──────────────────────────────► P8 Security validation ─► P9 Contract/cleanup ─► P10 Deploy & verify
```

---

## Phase 0 — Baseline and real-PostgreSQL harness

**Objective:** a committed baseline where schema drift (D-8) can no longer pass tests.

| Item | Detail |
|---|---|
| Status | **Partly done.** Hierarchy work committed (`d79af08`). Jest `globalSetup` builds a PostgreSQL 16 database from migrations (`7fa3094`, `docker compose up -d db-test`). |
| Remaining | Move every DB suite from hand-written pg-mem schemas onto `tests/helpers/testDb.ts`. Add a shared fixture builder (orgs, branches, users, memberships, employees, periods). Add a CI job that starts PostgreSQL and runs `npm test`. Add a failing or `todo` test reproducing D-8. Decide the fate of the `DATABASE_URL=memory` dev mode: retire it, or generate it from migrations. |
| Files | `backend/tests/**`, `backend/src/services/db.ts`, CI config (new) |
| Database | None applied to Railway |
| Security | Every later security test depends on this harness |
| Completion | All DB suites on real PostgreSQL. CI green. The D-8 reproduction is present |
| Rollback | Code-only |

## Phase 1 — Critical, model-independent fixes

**Objective:** close defects that do not need the new hierarchy.

| Defect | Fix | Files | Status |
|---|---|---|---|
| D-2 verify-login bare code | challenge-bound | `routes/auth.ts`, `VerifyLogin.tsx` | **Done** `7fa3094` |
| D-18 invite acceptance without password / sessionless JWT | sign-in required, no token | `routes/locations.ts` | **Done** `7fa3094` |
| Email re-route to personal address (C4) | removed | `services/emailService.ts` | **Done** `7fa3094` |
| D-5 role escalation via employees | Platform Admin blocked (**done**). Remaining: the employee endpoint grants `Employee` only; management roles only through membership endpoints | `routes/employees.ts`, `pages/Employees.tsx` | Partly done |
| D-8 CHECK conflicts (M0) | `memberships.ts` writes legacy values only | `routes/memberships.ts` | Open |
| D-19 cross-org branch member PUT/DELETE | verify branch ∈ session org | `routes/memberships.ts` | Open |
| D-21 member invite overwrites roles; ORG_ADMIN removes owners | hierarchy checks | `routes/memberships.ts` | Open |
| D-22 self-approval, silent bulk subset | block own records; per-item results | `routes/submissions.ts`, `routes/organisation.ts` (leave) | Open |
| D-1 lock side-effect | update only the supplied flag; audit before/after; stop accepting the caller's login password as a lock password | `routes/locks.ts` | Open |
| D-6 / D-7 token exposure and lookup | hash-only lookups in `auth.ts`; stop returning `token` from `GET /api/platform/invitations` and `inviteLink` from employee endpoints; org-invite expiry enforced as 7 days from `created_at` (M7 later expires them all and re-sends); stop writing plaintext `location_invitations.token` | `routes/auth.ts`, `routes/platform.ts`, `routes/employees.ts`, `routes/locations.ts`, `pages/PlatformAdmin.tsx` | Partly done |
| D-27 broken first-manager invite at provisioning | write `token_hash`; no swallowed errors inside the transaction | `routes/platform.ts`, `routes/locations.ts` | Open |
| D-28 links built from `Origin` | build from `PUBLIC_URL` (required in production) | `routes/auth.ts`, `routes/platform.ts`, `routes/employees.ts`, `routes/locations.ts` | Open |
| D-16 error leakage | static messages | `routes/locks.ts` | Open |
| D-14 sign-out | call `POST /api/auth/logout`; clear all auth keys | `components/Layout.tsx` | Open |
| D-10 (part) | a missing sessions table is not valid; session-less JWTs rejected in every environment | `services/sessionService.ts`, `middleware/auth.ts` | Open |
| D-12 weekday bug | use weekday names | `services/rosterService.ts` | Open |

| Item | Detail |
|---|---|
| Tests | One regression test per item, on real PostgreSQL |
| Database | None (M0 is code-only) |
| Completion | All items fixed with tests. Update the "Before real data" list in `DEPLOY.md` |
| Rollback | Code-only, per PR |

## Phase 2 — Schema expand, backfill and dual-write

**Objective:** create and populate the target tables **without changing authorisation behaviour**, and keep them in sync.

| Item | Detail |
|---|---|
| Files | New migrations after `…500`; `backend/src/scripts/bootstrap.ts`; every legacy role/invite write path (`memberships.ts`, `locations.ts`, `employees.ts`, `platform.ts`) for dual-write |
| Dependencies | Phase 0 harness |
| Database | BACKEND-SCHEMA §9.2 steps M1, M1b, M2, M3, M4, M5, M7, M8, M9. **Not M6**, which ships in Phase 5. Includes `role_assignments`, `employee_branches`, `invitations`, `invitation_assignments`, `platform_operators`, `organisations.entry_code`, `daily_records.location_id` (nullable, backfilled), status columns, composite UNIQUEs, and `users.org_id` FK → SET NULL |
| Backend | Migration report writer (counts, a manual-review list, owner-held operational assignments). **Dual-write:** legacy endpoints also write/revoke `role_assignments`. Bootstrap stops adding the Platform Admin as a tenant member, and creates a primary branch plus an `ORG_OWNER` assignment for the demo org. New writes to `daily_records` stamp `location_id` |
| Frontend | None |
| Tests | Migration tests on PostgreSQL from (a) empty and (b) a legacy-data fixture covering: branchless org with `'Company Admin'`; `'Manager'` org roles with and without branch memberships; branch `admin`/`manager`/`employee`; employees without a branch; Platform Admin memberships; plaintext org invites; `Normal` segments; duplicate `(org, user)` employee rows (reported, not merged). Assert every BACKEND-SCHEMA §9.3 mapping row, that nothing was deleted, and that dual-write keeps legacy and new tables equivalent |
| Security | The backfill never grants more than was effectively granted before. Owner-held operational access is flagged, not silently kept |
| Completion | Up/down pass on PostgreSQL. Backfill report reviewed on a copy of staging data. Existing tests green (runtime unchanged) |
| Rollback | `down` migrations; backfilled rows identifiable by `source='migration'` / marker columns; dual-write can be switched off |

## Phase 3 — Authorisation core

**Objective:** replace the security context with the assignment-based model (TRD §5), and write the authorisation matrix test as the executable specification.

| Item | Detail |
|---|---|
| Files | `services/permissionService.ts` (rewrite), `middleware/auth.ts`, new `services/policy.ts` (`authorize`, `resolveScope`, `scopedEmployeeIds`), `routes/auth.ts` (`/me` returns assignments and capabilities) |
| Dependencies | Phase 2 |
| Backend | Role → permission constants and grant table exactly as TRD §5.3/§5.7. "All branches" scope supported. Deny by default. Remove the JWT-role fallback (D-20), the "no branches" fallback and fail-open `catch` blocks (D-10). Platform operators get no tenant permissions (D-9). Separation-of-duties helper. `requireRole` kept only for platform routes, checking `platform_operators`. **Dual-read** in staging: compute old and new decisions, log differences, serve old; then flip a flag to serve new |
| Frontend | None (the `/me` payload change is additive) |
| Tests | Authorisation matrix test (TRD §15.2 item 3): every endpoint × role fixture. Fixtures include John (Employee A + Manager B), Owner with no branch, Owner with an all-branches Manager assignment, Org Admin, Branch Admin, Payroll (all branches and one branch), a multi-branch employee, an other-org Owner, and a platform operator. Cells turn green across Phases 3–5 |
| Security | Every intended difference in the dual-read diff log is cross-checked against PRD §6.2 |
| Completion | New context served (flag on) in test and staging. Diff log reviewed. Middleware-level matrix cells green |
| Rollback | Flag back to legacy decisions (legacy tables still maintained by dual-write) |

## Phase 4 — Authentication and private organisation link

**Objective:** the PRD §10 login model and session hardening.

| Item | Detail |
|---|---|
| Files | `routes/auth.ts`, `routes/organisation.ts`, `services/sessionService.ts`, `routes/platform.ts`, frontend `pages/auth/OrgLogin.tsx` (→ `/o/:code`), `pages/Login.tsx`, `pages/public/PortalAccess.tsx`, `layouts/PublicLayout.tsx`, `services/apiClient.ts`, `hooks/useSessionTimeout.ts` |
| Dependencies | Phase 3 |
| Database | Uses `entry_code`, `sessions.audience` (added in Phase 2) |
| Backend | Login by `entry_code` + membership, with a generic error and equal timing for bad password, unknown code, no membership (removes the `NO_ORGANISATION_ACCESS` oracle). Tenant vs platform audience; platform operators blocked from tenant login and org switch (D-9). JWT claims reduced to `sub`, `sid`, `aud`. Remove `GET /api/organisation/lookup/:slug` and `/discover` (D-23). `POST /api/organisation/rotate-entry-code`. `POST /api/auth/login-links`. One password policy. Shared rate-limit store (PostgreSQL table), covering forgot-password and invitation endpoints too |
| Frontend | Generic sign-in at `/o/:code`. Remove `/portal-access` slug entry, `/find-organisation`, `/signin` and the easter eggs. Public "Sign in" explainer plus email-link form. Landing resolution per APP-FLOW §2.1. Timeout/logout return to the remembered org link. "Signed in elsewhere" calls logout |
| Tests | Oracle test (same response and timing for the four cases). Platform operator denied on tenant login. Entry-code rotation invalidates the old code. Login-links enumeration safety. Rate limits. All suites run with sessions required |
| Security | `/login/:slug` accepted only during a communicated transition window, behind a flag |
| Completion | APP-FLOW §2 verified end-to-end in the browser preview; tests green |
| Rollback | Transition flag re-enables `/login/:slug` |
| Optional (decision 5) | HttpOnly cookie + CSRF instead of `localStorage` tokens |

## Phase 5 — API scoping (resource authorisation everywhere)

**Objective:** every endpoint follows load → resolve scope → authorise → act (TRD §8).

| Router | Changes | Defects |
|---|---|---|
| `employees.ts` | Scoped lists via `scopedEmployeeIds`; branch placement via `employee_branches`; the `EMPLOYEE` self assignment is created/revoked with the `user_id` link; body `location_id` verified; `user_id` relink restricted | D-25 |
| `records.ts` | Remove legacy `'Manager'` checks; authorise by `daily_records.location_id`; permission guard on `/stats` | D-25 |
| `roster.ts` | Auto-roster/auto-log restricted to the requested branch within scope | — |
| `locks.ts` + **M6** | Per-branch `period_locks`; `ROSTER_PUBLISH`, `TIMESHEET_LOCK`, `TIMESHEET_UNLOCK` (with reason); re-authentication replaces shared lock passwords, which are still accepted during the transition | D-11 |
| `holidays.ts` | `HOLIDAY_MANAGE` | D-11 |
| `submissions.ts` | Primary-branch approval; `submitted_by`, `approved_by` | (D-22 done in Phase 1) |
| leave routes | Move to `/api/leave-requests`; scoped list; approval by the employee's primary branch; employee cancel | D-4 |
| `reports.ts` + new `payroll` | Branch report; org summary (aggregate only); payroll report/export (approved-only, scoped); export audit events; fix dropped `Normal` segments; HTML escaping tests | D-3, D-13 |
| `audit.ts` | Category plus branch filtering | — |
| `dashboard.ts`, `portal.ts` | Compose blocks by capability; team roster/today limited to own branches; week/month schedule endpoint | D-24 |
| `announcements.ts` | `ANNOUNCEMENT_POST` / `ANNOUNCEMENT_MANAGE` replace `requireRole` | D-26 |
| `memberships.ts` → `/api/assignments` | Grant/revoke/self-grant (Owner, re-auth, reason); grant table (TRD §5.7); old routes wrap the new logic | D-21 |
| invitations | `/api/invitations` unify all four mechanisms (including EMPLOYEE invites that create employee records); old accept URLs honoured until expiry | D-6 |
| `xero.ts` | Unmounted unless `FEATURE_XERO=true` [DEFERRED feature] | — |

| Item | Detail |
|---|---|
| Dependencies | Phases 2–3 |
| Database | M6 (with `locks.ts`) |
| Tests | Matrix cells for every route green. Specific tests for each defect above, `branch_id` tampering (→ 403), foreign-org IDs (→ 404), `x-location-id` ignored, multi-branch employee shift visibility |
| Completion | Authorisation matrix fully green on PostgreSQL |
| Rollback | Per-router PRs; the Phase 3 flag remains until Phase 9 |

## Phase 6 — Frontend capabilities and navigation

**Objective:** one capability source drives routes, navigation and controls (TRD §2.2, UI-UX §5).

| Item | Detail |
|---|---|
| Files | `App.tsx`, `components/Layout.tsx`, `hooks/usePermissions.tsx` (→ `useCapabilities`), every page with role checks (`Settings.tsx`, `Announcements.tsx`, `Roster.tsx`, `Employees.tsx`, `Dashboard.tsx`, `HelpChatbot.tsx`, `OnboardingTutorial.tsx`), `components/ui/*` accessibility fixes |
| Dependencies | Phase 3 `/me`; Phase 5 endpoints |
| Frontend | Remove JWT decoding for authorisation. Stacked nav sections. Explicit No-access page. Branch selector as a filter (with "all branches" assignments). Per-control capability checks. Fix `/audit-log` link, the tutorial event name and Owner inconsistencies (D-17). "Locations" → "Branches". Theme applied on public/auth pages. `lang="en-AU"` |
| Tests | Nav composition per fixture (Vitest + Testing Library [PROPOSED tooling]); typecheck/build |
| Completion | Navigation for each fixture matches UI-UX §5; no stale-link bounces |
| Rollback | Frontend-only deploy rollback |

## Phase 7 — User workflows

| Workflow | Work | Defects |
|---|---|---|
| Employee leave | My leave: request, list, cancel (UI-UX §8.1) | D-15 |
| Timesheet history | Real history from submissions | D-15 |
| Schedule views | Week and month views; published-only | — |
| Payroll area | Pay periods, report, exports, lock/unlock with reason | — |
| Organisation overview | Aggregate dashboard; Owner self-grant flow; post-migration "Review your access" prompt | — |
| People & access | Assignments UI; unified invitations (send, resend, revoke; links never shown) | D-6 |
| Provisioning wizard | "Will you run this branch?"; password policy; no silent branch admin | — |
| Public holidays | Expose the existing modal to `HOLIDAY_MANAGE` | — |
| Multi-branch employees | Branch placement editing (`employee_branches`); roster branch per shift | — |
| Email | SimpleHours templates; correct expiry text; branch invite template moved into `emailService.ts` | — |
| Orphan removal | Remove `pages/Portal.tsx` after its leave form is re-implemented | — |

Tests: API tests per workflow; frontend smoke tests; a usability check with at least 3 first-time users on the employee timesheet flow (PRD §15). Completion: the PRD §8 experiences can be demonstrated in staging.

## Phase 8 — Security validation

- Run the full matrix on PostgreSQL with sessions required.
- Every threat in the TRD §13.2 checklist has at least one passing test.
- Route inventory test: every registered route declares exactly one policy (`public`, `self`, `can`, `canList`, `platformOnly`), and no route file compares role strings or reads org/branch IDs from the request for authorisation.
- Lint gate: no empty `catch` in `middleware/`, `permissionService.ts` or `policy.ts`.
- `npm audit`. Secret scan of git history (`backend/key.rtf`, `.env`, `backend/.db_snapshot.json` exist locally; confirm none are tracked).
- HSTS; CSP without `'unsafe-inline'` scripts; production CORS allow-list.
- Independent review of the diff since Phase 0 (e.g. `/security-review`).

Completion: no open Critical or High findings; the "Before real data" section of `DEPLOY.md` is empty or explicitly accepted.

## Phase 9 — Cleanup and contract

| Item | Detail |
|---|---|
| Database | BACKEND-SCHEMA §9.2 **K1**. Before each dropped column or table: a verification query, grep plus one release of runtime read-logging showing no reads, and a backup |
| Backend | Remove the legacy security context, flag and dual-write. Remove dead middleware (`requireLocationContext`, `requireTimesheetMode`). Remove old membership/invite routes after their transition windows |
| Frontend | Remove legacy role fallbacks |
| Repo | Decide explicitly (not by this plan) on `legacy-backend/`, `legacy-index.html`, `legacy-agent.md`, `render.yaml`, `skill-creator/`, `index.html.bak` |
| Completion | No code reads deprecated columns; contract applied in staging and verified |
| Rollback | Restore from the pre-contract backup (rehearsed) |

## Phase 10 — Deployment and verification

- Separate Railway `staging` and `production` environments. Confirm which of the two existing Postgres services is live, and retire the other only after confirming it holds nothing needed (TRD §14.1).
- Confirm the database region and backups; rehearse a restore.
- Rotate `JWT_SECRET` and `ENCRYPTION_KEY`. Configure the email domain, `EMAIL_FROM` and `PUBLIC_URL` (required).
- Deploy migrations to staging against a copy of staging data. Review the migration report. Then deploy to production.
- Post-deploy verification script: health; login via the private link for each role fixture; a matrix smoke subset against the deployed URL; an export audit event is present.
- Update `DEPLOY.md` for the new architecture.

---

## R. Reconciliation with `docs/security/hierarchy-audit-and-design.md`

That document (committed in `d79af08`) audits the same code, and its findings are mapped into PRD §12. Its design proposal overlaps heavily with these documents. Where they differ, the resolution below is authoritative.

| Topic | Security design doc | Resolution in these documents | Why |
|---|---|---|---|
| Role/scope separation, assignments table, deny by default, resource-derived branch, 404/403 rules | Same | **Adopted** (TRD §5, §8) | Agreement |
| Platform authority | `platform_operators` table | **Adopted** (BACKEND-SCHEMA §4.1) | Never writable by tenant APIs |
| "All branches" scope for operational roles | Yes | **Adopted** (`scope_type='organisation'` for `BRANCH_MANAGER`/`BRANCH_ADMIN`/`PAYROLL`) | Explicit and audited; avoids per-branch grants for area managers |
| Private link | `entry_code`, `/o/:code`, no pre-auth org data, no lookup endpoint | **Adopted** (PRD §10) | Removes org enumeration and the regeneration bypass (D-23) |
| Plaintext pending invites at migration | Expire, don't migrate | **Adopted** (M7) | The tokens were exposed |
| Global `users.is_active` | → `login_disabled` + membership status | **Adopted** | Prevents cross-org lockout |
| Operational rows carry a branch | `branch_id` on all operational tables | **Partly adopted**: `daily_records.location_id` (shift branch) now; submissions and leave follow the primary branch; per-branch submissions [DEFERRED] | Keeps one timesheet per employee per fortnight (current UX and uniqueness) |
| EMPLOYEE role scope | Branch-scoped (marks rosterable branches) | **Different**: `EMPLOYEE` is self-scoped; branch placement lives in `employee_branches` | Employees without logins must still have branch placement; one source for placement |
| Per-assignment optional grants ("G") | Yes (`assignment_grants`) | **Deferred**; use an additional assignment instead (e.g. `BRANCH_ADMIN` + `BRANCH_MANAGER`) | Simpler to reason about and test first |
| Owner operational access | Only via an assignment given by someone else (no self-modification) | **Different**: an Owner may self-grant via an audited, re-authenticated action with a reason (PRD §5.2) | Single-owner small businesses would otherwise be locked out |
| Who assigns `ORG_ADMIN` | Owner only | **Adopted** (TRD §5.7) | Tighter |
| Permission key style | `timesheet.approve` (dotted) | Keep `TIMESHEET_APPROVE` style | Matches existing code and frontend |
| Contract step naming | "M-contract" | K1 | Avoids clash with finding IDs C1–C21 |

---

## Open decisions (need product-owner confirmation)

Each has a **recommended default**, already used consistently in all six documents. Approving the documents approves the defaults unless changed.

| # | Decision | Recommended default (used in docs) | Alternative |
|---|---|---|---|
| 1 | Can the Owner self-grant operational roles? | Yes, via audited self-grant with password and reason (PRD §5.2) | No; a second owner must grant (security design doc) |
| 2 | Branch Admin approval authority | Not by default; add a `BRANCH_MANAGER` assignment (PRD §6.2) | Per-assignment grants [DEFERRED] |
| 3 | Multi-branch employee approval | Shifts stamped per branch; fortnight approved by the primary branch (PRD §9 item 5) | Per-branch submissions [DEFERRED] |
| 4 | Who unlocks a locked timesheet period | Payroll only, reason required; Owners without a Payroll user self-grant `PAYROLL` | Also Branch Manager before export |
| 5 | Token storage | Move to HttpOnly cookies (Phase 4, optional) | Keep `localStorage` bearer tokens |
| 6 | Existing `/login/:slug` URLs | Transition window, then generic page; `entry_code` only | Keep permanently |
| 7 | Team roster visibility for employees | Own branches, names and shift times only | Organisation-wide (current) |
| 8 | Brand spelling | "SimpleHours" | "Simple Hours" |
| 9 | Legal retention period | 7 years (Fair Work), pending legal confirmation | — |
| 10 | Existing branch `admin` holders in migration | `BRANCH_ADMIN` + `BRANCH_MANAGER` (access-preserving); owner-held access flagged for review | `BRANCH_ADMIN` only (loses approve/lock) |
| 11 | `EMPLOYEE` scope model | Self scope + `employee_branches` (§R) | Branch-scoped `EMPLOYEE` assignments |

## Recommended immediate next step

Approve or amend the documents and the open decisions, then finish **Phase 0** and continue **Phase 1**. Coordinate with the parallel session so the same fixes are not done twice.
