# SimpleHours — Technical Requirements Document (TRD)

| | |
|---|---|
| Status | Draft for review — authoritative once approved |
| Last audited against code | 2026-09-21, re-baselined on `main` @ `7fa3094` — see [PRD §0.2](./PRD.md#02-what-current-means) |
| Labels | **[CURRENT] [REQUIRED] [PROPOSED] [DEFERRED]** — defined in [PRD §0.1](./PRD.md#01-status-labels) |
| Companion documents | [PRD](./PRD.md) · [UI/UX](./UI-UX-DESIGN.md) · [App Flow](./APP-FLOW.md) · [Backend Schema](./BACKEND-SCHEMA.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md) |

---

## 1. System architecture

### 1.1 Current [CURRENT]

```
Browser (React SPA)
   │  HTTPS, Authorization: Bearer <JWT>   (token in localStorage)
   ▼
Railway service "elite-timesheet-os"  (Node 22, one process)
   ├── Express 5 API under /api/*
   ├── Static frontend (frontend/dist) + SPA fallback
   └── /health
   │
   ▼
Railway PostgreSQL (private network *.railway.internal, TLS off internally)
```

- Monorepo with npm workspaces: `frontend/`, `backend/` (`package.json`).
- Single deployable: backend serves the built SPA (`backend/src/index.ts`).
- Development can run against an in-memory PostgreSQL emulation (`DATABASE_URL=memory`, pg-mem) with its own hand-written schema in `backend/src/services/db.ts` and a JSON snapshot file (`backend/.db_snapshot.json`, git-ignored).
- Legacy artefacts in the repo: `legacy-backend/` (SQLite-era Express app), `legacy-index.html`, `legacy-agent.md`, `render.yaml` (alternative Render + Neon deployment). None are used by the running system.

### 1.2 Required [REQUIRED]

- Stateless API instances so the service can scale beyond one replica (see §9.7, §17).
- One authoritative database schema defined by migrations. The pg-mem schema must be generated from, or verified against, migrations (§13.3).
- No behaviour that exists only in development (e.g. reading API keys from `key.rtf`, snapshot restore) may affect production code paths. [CURRENT] These are guarded by `NODE_ENV`.

---

## 2. Frontend architecture

### 2.1 Current [CURRENT]

| Aspect | Implementation |
|---|---|
| Framework | React 19, TypeScript ~6, Vite 8, React Router 7 |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`; CSS variables in `frontend/src/index.css` |
| HTTP | axios instance `frontend/src/services/apiClient.ts`; base `/api` in production |
| Auth state | `localStorage`: `token`, `user`, `current_org_id`, `session_last_active`, `simplehours_security_context`, `last_org_slug` |
| Route guards | `App.tsx` `ProtectedRoute` decodes the JWT `role` claim client-side and compares with legacy role strings |
| Navigation | `components/Layout.tsx` uses `hooks/usePermissions.tsx` (`GET /api/auth/me` → `security_context`) |
| Session timeout | `hooks/useSessionTimeout.ts` (15 min, warning at 10, keep-alive every ≤ 4 min) |
| Icons | lucide-react |

**Known inconsistencies [CURRENT]:** route guards use legacy role strings while the sidebar uses permissions, so links can appear that the route then rejects. Pages (Settings, Announcements, Roster, Employees) make their own role decisions from the JWT. `pages/Portal.tsx` is orphaned.

### 2.2 Required [REQUIRED] / Proposed [PROPOSED]

1. **One client-side capability source**: [PROPOSED] `GET /api/auth/me` returns `{ user, organisation, memberships, assignments[], capabilities }` where `capabilities` is a precomputed, display-only summary (e.g. `{ nav: [...], branches: [{id, name, permissions[]}], self: {...} }`). Route guards, navigation and page controls all read this one source. No component decodes the JWT for authorisation decisions.
2. The frontend never decides security. Every hidden control must also be rejected by the API (§5).
3. Unknown/forbidden routes render a "You don't have access to this page" state rather than silently redirecting, so users understand what happened.
4. The API client treats 401 (re-authenticate) and 403 (not allowed) differently. [CURRENT] 403 has no global handling.

---

## 3. Backend architecture

### 3.1 Current [CURRENT]

| Layer | Location | Notes |
|---|---|---|
| Entry | `backend/src/index.ts` | CORS, JSON body limit 1 MB, security headers, routers, static SPA, JSON 404, generic 500 handler |
| Middleware | `backend/src/middleware/auth.ts` | `requireAuth`, `requireRole`, `requireTenantContext`, `requireOrgOwner`, `requirePermission`, `requireAnyBranchPermission`, `requireAnyPermission`, `requireLocationContext` (unused), `requireTimesheetMode` (unused) |
| Authorisation | `backend/src/services/permissionService.ts` | Role enums, role→permission maps, `resolveUserSecurityContext`, `checkUserPermission`, audit helper |
| Routes | `backend/src/routes/*.ts` | 17 routers; business logic and SQL live in route handlers |
| Services | `backend/src/services/*.ts` | db, auth (bcrypt/JWT), session, security (risk), email, report, roster, classification, time parser, period utils, Xero |
| Data access | `services/db.ts` `query()` / `withTransaction()` | raw parameterised SQL via `pg` |
| Scripts | `backend/src/scripts/bootstrap.ts` | first Platform Admin, optional demo org |

### 3.2 Required [REQUIRED] / Proposed [PROPOSED]

- [PROPOSED] Introduce a thin **policy layer**: `authorize(ctx, permission, resource)` where `resource` is loaded from the DB first (`loadTimesheet(id)` → `{orgId, branchId, employeeId, employeeUserId}`), so route handlers cannot forget the resource-relationship step. Route handlers call `authorize` after loading and before acting.
- [PROPOSED] Scope-aware query helpers: `scopedEmployeeIds(ctx, permission)` returns the employee IDs the caller may act on; list endpoints must use it in SQL (`WHERE e.id = ANY($n)`).
- [REQUIRED] Keep parameterised SQL everywhere ([CURRENT] true; test exists for team roster).
- [DEFERRED] ORM or query builder adoption.

---

## 4. Authentication

### 4.1 Current [CURRENT]

| Mechanism | Detail | Source |
|---|---|---|
| Passwords | bcryptjs, cost 10 | `services/auth.ts` |
| Password policy | ≥ 8 chars, letters + digits (reset, employee invite claim); location invite accept ≥ 8 only; **no strength check** on org claim-invite admin password | `routes/auth.ts`, `routes/platform.ts`, `routes/locations.ts` |
| Tenant login | `POST /api/auth/login {email, password, organisation_slug}` — the slug (the organisation's random `portal_slug`) is required; there is no sign-in by `organisation_id` and no organisation picker. Access is then resolved server-side (`resolveAccess`). Password-reset tokens carry the issuing `org_id` so a completed reset returns to that portal. | `routes/auth.ts` |
| Generic login | Same endpoint without org → uses legacy `users.org_id`; frontend then shows an organisation picker and calls `switch-organisation` | `routes/auth.ts`, `pages/Login.tsx` |
| Platform login | `POST /api/auth/platform-login`; requires `users.role = 'Platform Admin'`; UI hidden at `/platform-gate` | `routes/auth.ts` |
| 2FA | Optional per user; 6-digit email code, SHA-256 hashed, 10-min expiry, 5 attempts; intermediate JWT with `scope: '2fa_pending'` (10 min) rejected by `requireAuth` | `routes/auth.ts` |
| Suspicious login | Risk check (unrecognised location **and** device after ≥ 2 prior logins) → emailed verification link/code; `x-test-simulate-suspicious` header forces it only when `NODE_ENV=test`; private/loopback IPs resolve to a hard-coded "Melbourne" location | `services/securityService.ts` |
| Password reset | SHA-256 token, 1 h expiry, single use, enumeration-safe response; resets revoke sessions | `routes/auth.ts` |
| Rate limiting | In-memory Map, 5 failures / 15 min per email or IP: login, verify-login, platform-login, reset-password; not forgot-password or invitation claim | `routes/auth.ts` |
| JWT | HS256 `JWT_SECRET`; claims `id, email, organisation_id, location_id, role, session_id`; 24 h; production refuses a missing/default secret | `services/auth.ts` |

### 4.2 Defects [CURRENT]

- D-2: **fixed in `7fa3094`** — `verify-login` now requires a `challenge_id` + code or the emailed token, compared by hash.
- D-7: reset and employee-invitation lookups still accept `hash OR raw token` (`routes/auth.ts`); branch invites are hash-only since `7fa3094`.
- D-20: login with only an employee row (no membership) copies the global `users.role` into the JWT, and the security context falls back to it.
- D-28: reset and invitation email links are built from the request `Origin` header (fallback `FRONTEND_URL`), not `PUBLIC_URL`.
- [CURRENT] `trust proxy` is configurable via `TRUST_PROXY` (`index.ts`), used for client-IP resolution in rate limiting and risk checks (added in `7fa3094`).
- D-9: a Platform Admin can sign into any organisation via tenant login (`effectiveRole = 'Platform Admin'`).
- Login returns `NO_ORGANISATION_ACCESS` (403) only after a correct password — a credential oracle.
- The JWT `role` claim is copied from `organisation_members.role` / `users.role` and then trusted by `requireRole`, several handlers, and the frontend.

### 4.3 Required [REQUIRED]

1. Authentication proves identity only. Authority comes from assignments resolved per request (§5).
2. Identical client response for unknown email, wrong password, inactive user and no membership in the target organisation; the specific reason is written to `login_history` only.
3. Platform authority lives in a separate `platform_operators` table (BACKEND-SCHEMA §4.1), never in a tenant-writable role field. Platform operators authenticate only through the platform endpoint and receive sessions/tokens with `aud = platform`; tenant endpoints reject them. Tenant tokens carry `aud = tenant`.
3a. [PROPOSED] JWT claims shrink to `sub` (user id), `sid` (session id), `aud`. Organisation comes from the session row; no role, org or branch claims. [CURRENT] claims are `id, email, organisation_id, location_id, role, session_id`.
4. Verification codes are bound to a challenge ID (and the pending temp token), never looked up by code alone.
5. Token lookups compare `sha256(presented)` only.
6. One password policy (≥ 10 chars recommended, letters + digits, reject top-breached list [PROPOSED]) applied to every password-setting path.
7. [PROPOSED] Private entry link `/o/<entry_code>` (≥ 128-bit, rotatable). The organisation is resolved server-side from the code plus the authenticated user's active membership. There is no pre-authentication endpoint returning organisation data (PRD §10).
7a. [PROPOSED] Email link recovery for "I don't know my organisation's login link" (PRD §10).
8. [DEFERRED] TOTP authenticator apps, WebAuthn, SSO.

---

## 5. Authorisation — role + scope + permission

This is the core of SimpleHours. Terms are defined in [PRD §4](./PRD.md#4-the-hierarchy).

### 5.1 Current implementation [CURRENT]

`requireAuth` builds `req.securityContext` via `resolveUserSecurityContext(userId, orgId, requestedBranchId, jwtRole)`:

1. If JWT role is `'Platform Admin'` → all permissions, done. **(D-9)**
2. Org role = `OWNER` if `organisations.owner_user_id = user`, else `normalizeOrgRole(organisation_members.role)`, else **`normalizeOrgRole(jwtRole)`** (JWT fallback).
3. Branch memberships = active `location_memberships` in active branches of the org.
4. Active branch = requested branch (JWT `location_id`) or the only branch.
5. Effective permissions = org-role permissions ∪ active-branch-role permissions.

`checkUserPermission(ctx, permission, {branchId, employeeId})`:
- Organisation-level permission → check effective set.
- Branch-scoped permission (timesheet, roster, leave, `BRANCH_MANAGE_STAFF`) → target branch = **client-supplied `branchId`**, else active branch, else the employee's `location_id`; requires an active membership in the target branch with a role granting the permission.
- If the org has no active branches → any org role passes **(fail-open fallback)**.
- Many `try { … } catch {}` blocks continue on DB errors.

Middleware resolve the branch from `params.locationId | params.branchId | query.location_id | query.branch_id | body.location_id | body.branch_id | header x-location-id | JWT location_id`. `requireAnyBranchPermission` allows list requests if the permission is held in **any** branch.

Strongest current pattern: `submissions.ts checkEmployeeTimesheetPermission` loads the target employee's branch and checks the permission there. Weakest: reports (organisation-wide), leave (any-branch), locks (organisation-wide), records POST (legacy role-string branch check), audit (legacy `'Manager'` string filter).

### 5.2 Required model [REQUIRED]

```
Request
  │
  ├─1 Authentication      valid signature, aud = tenant, not 2fa_pending
  ├─2 Session              server session active, not idle > 15 min, not > 24 h, not revoked,
  │                        session.org_id == token.org_id, user active
  ├─3 Membership           organisation_members(user, org).status = 'active', org active
  ├─4 Assignments          role_assignments(user, org, status='active')  → [(role, scopeType, branchId?)]
  ├─5 Scope                which organisation / branch / self the target resource lives in
  │                        (loaded from DB, never taken from the client)
  ├─6 Permission           ∃ assignment whose role grants P and whose scope covers the resource
  └─7 Relationship         resource.org_id == session org; resource.branch ∈ scope;
                           self-scope: resource.employee.user_id == user; separation of duties
```

Any failure → deny. Unknown → deny. Error → deny (HTTP 500 without detail, never `next()`).

### 5.3 Role → permission mapping [PROPOSED]

Defined once in `permissionService.ts` (code constant, not a DB table — custom roles are [DEFERRED]). Matches [PRD §6.2](./PRD.md#62-permission-matrix-required) exactly.

| Permission | Scope kind | ORG_OWNER | ORG_ADMIN | BRANCH_MANAGER | BRANCH_ADMIN | PAYROLL | EMPLOYEE |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| ORGANISATION_VIEW | org | ✓ | ✓ | | | | |
| ORGANISATION_UPDATE | org | ✓ | ✓ | | | | |
| ORGANISATION_SECURITY | org | ✓ | | | | | |
| ORGANISATION_MANAGE_BRANCHES | org | ✓ | ✓ | | | | |
| ORGANISATION_MANAGE_USERS | org | ✓ | ✓¹ | | | | |
| BRANCH_VIEW | branch/org | ✓ | ✓ | ✓ | ✓ | ✓ | |
| BRANCH_UPDATE | branch/org | ✓ | ✓ | | ✓ | | |
| BRANCH_MANAGE_USERS | branch/org | ✓ | ✓ | | ✓² | | |
| EMPLOYEE_VIEW | branch/org | ✓ | ✓ | ✓ | ✓ | ✓³ | self |
| EMPLOYEE_MANAGE | branch/org | ✓ | ✓ | ✓ | ✓ | | |
| ROSTER_VIEW | branch | | | ✓ | ✓ | | self⁴ |
| ROSTER_CREATE / UPDATE / DELETE | branch | | | ✓ | ✓ | | |
| ROSTER_PUBLISH | branch | | | ✓ | ✓ | | |
| TIMESHEET_VIEW | branch | | | ✓ | ✓ | ✓⁵ | self |
| TIMESHEET_EDIT | branch | | | ✓ | ✓ | | self⁶ |
| TIMESHEET_SUBMIT | branch | | | ✓⁷ | ✓⁷ | | self |
| TIMESHEET_REVIEW | branch | | | ✓ | | | |
| TIMESHEET_APPROVE | branch | | | ✓ | | | |
| TIMESHEET_LOCK | branch | | | ✓ | | ✓ | |
| TIMESHEET_UNLOCK | branch | | | | | ✓ | |
| LEAVE_VIEW | branch | | | ✓ | ✓ | ✓⁵ | self |
| LEAVE_REQUEST_SELF | self | | | | | | ✓ |
| LEAVE_APPROVE | branch | | | ✓ | | | |
| REPORT_BRANCH_VIEW | branch | | | ✓ | ✓ | | |
| REPORT_ORG_SUMMARY | org | ✓ | ✓ | | | ✓ | |
| PAYROLL_VIEW / PAYROLL_EXPORT | branch/org | | | | | ✓ | |
| HOLIDAY_MANAGE | org | ✓ | ✓ | | | ✓⁸ | |
| AUDIT_VIEW_ADMIN | org | ✓ | ✓ | | | | |
| AUDIT_VIEW_OPERATIONAL | branch/org | | | ✓ | ✓ | ✓ | |
| ANNOUNCEMENT_POST | org | ✓ | ✓ | ✓ | ✓ | ✓ | ✓⁹ |
| ANNOUNCEMENT_MANAGE | org | ✓ | ✓ | ✓ | ✓ | | |

¹ cannot grant, modify or remove `ORG_OWNER` or `ORG_ADMIN`. ² may grant/revoke only `EMPLOYEE` role for employees of their own branch. ³ pay-relevant fields only (name, employee ID, contracted hours, branch). ⁴ own shifts plus the published roster of own branches (names and shift times). ⁵ approved/locked data only. ⁶ only in `employee` entry mode and while the period is unlocked and not approved. ⁷ on behalf of employees, in `manager` entry mode. ⁸ only when the Payroll assignment is organisation-scoped.

⁹ only while `allow_employee_chat` is enabled.

**Scope of branch roles:** `BRANCH_MANAGER`, `BRANCH_ADMIN` and `PAYROLL` assignments are either one named branch (`scope_type='branch'`) or explicitly all branches (`scope_type='organisation'`, including future branches). This is an audited choice on the assignment, not a property of organisation roles.

"branch/org" = the permission is evaluated against the resource's branch; an organisation-scoped assignment covers all branches of the org, a branch-scoped assignment covers only that branch.

### 5.4 Mapping from current keys [PROPOSED]

| Current key | Becomes |
|---|---|
| `BRANCH_MANAGE_STAFF` | `EMPLOYEE_VIEW` + `EMPLOYEE_MANAGE` |
| `REPORT_VIEW` | `REPORT_BRANCH_VIEW` (branch) / `REPORT_ORG_SUMMARY` (org) / `PAYROLL_VIEW` (payroll report) |
| `LEAVE_REVIEW` | merged into `LEAVE_APPROVE` (a review state is not used for leave) |
| `TIMESHEET_LOCK` | split into `TIMESHEET_LOCK` and `TIMESHEET_UNLOCK` |
| — | new: `ORGANISATION_SECURITY`, `ANNOUNCEMENT_POST`, `ROSTER_PUBLISH`, `TIMESHEET_EDIT`, `TIMESHEET_SUBMIT`, `LEAVE_REQUEST_SELF`, `PAYROLL_VIEW`, `PAYROLL_EXPORT`, `HOLIDAY_MANAGE`, `AUDIT_VIEW_ADMIN`, `AUDIT_VIEW_OPERATIONAL`, `ANNOUNCEMENT_MANAGE`, `BILLING_MANAGE` [DEFERRED], `INTEGRATION_MANAGE` [DEFERRED] |

Current role keys map: `OWNER`/`'Company Admin'`/`'Owner'` → `ORG_OWNER`; `ORG_ADMIN`/`'Admin'` → `ORG_ADMIN`; `ORG_MANAGER`/`'Manager'` (org) → retired (see BACKEND-SCHEMA §9.3); `'manager'`/`BRANCH_MANAGER` → `BRANCH_MANAGER`; `'admin'`/`BRANCH_ADMIN` → `BRANCH_ADMIN` **+** `BRANCH_MANAGER` (access-preserving migration); `'employee'`/`'Employee'`/`EMPLOYEE` → `EMPLOYEE`.

### 5.5 Branch context [PROPOSED]

- The server does **not** use an "active branch" to decide permissions. Authorisation for a resource uses the resource's branch.
- List endpoints accept an optional `branch_id` **filter**. The server intersects it with the caller's permitted branches; a branch outside that set → 403 (not an empty list), so tampering is detectable in tests and audit.
- The JWT/session `location_id` and `POST /api/auth/select-location` become a UI preference only (or are removed). `x-location-id` is ignored for authorisation.

### 5.6 Self scope [PROPOSED]

The `EMPLOYEE` assignment is bound to an employee record: `role_assignments.employee_id`. Self-scope checks require `resource.employee_id = assignment.employee_id` (and that employee record's `user_id = session user`). The server resolves "my employee record" from the session — employees never pass an employee ID for self-service ([CURRENT] true for `/api/portal/*`).

### 5.7 Anti-escalation rules [REQUIRED]

1. Who may grant what is an explicit table, not a derived "subset" rule (organisation roles hold no operational permissions yet may grant operational roles):

   | Caller | May grant / revoke |
   |---|---|
   | `ORG_OWNER` | any role at any scope in the organisation, including `ORG_OWNER` and `ORG_ADMIN` |
   | `ORG_ADMIN` | `BRANCH_MANAGER`, `BRANCH_ADMIN`, `PAYROLL`, `EMPLOYEE` at any scope; **not** `ORG_OWNER`/`ORG_ADMIN` |
   | `BRANCH_ADMIN` (at branch X) | `EMPLOYEE` for employees whose primary branch is X |
   | everyone else | nothing |

   The same table governs invitations (at creation **and** acceptance).
2. Nobody modifies or revokes their own assignments ([CURRENT] enforced in `memberships.ts`).
3. Self-grant only for `ORG_OWNER`, via `POST /api/assignments/self-grant` with password re-entry and reason, audited as `ASSIGNMENT_SELF_GRANTED` [PROPOSED]. [CURRENT] Owner self-assignment through the general endpoint must be closed.
4. The last active `ORG_OWNER` cannot be removed or demoted ([CURRENT] primary owner protected).
5. `PLATFORM_ADMIN` can never be granted through any tenant endpoint (fixes D-5). Role inputs are validated against an allow-list of tenant role keys.
6. Separation of duties: approve/reject/unlock actions compare `resource.employee.user_id` with the caller.

### 5.8 Permission changes take effect immediately

[CURRENT] The security context is recomputed per request, so revocations apply on the next request (tested). [REQUIRED] Keep this; do not cache permissions in the JWT. [PROPOSED] A per-request cache only.

---

## 6. Multi-tenancy — organisation isolation [REQUIRED]

1. The active organisation comes **only** from the server session (`sessions.org_id`), cross-checked with the token ([CURRENT] `TENANT_MISMATCH`).
2. Every tenant table has `org_id` (directly, or via a mandatory parent) and every query includes `org_id = $sessionOrg`. Child tables without their own `org_id` (`shift_segments`, `roster_templates`, `invitation_tokens` — see BACKEND-SCHEMA §2.1 and §6) must only be reachable through a join to an org-checked parent.
3. Cross-organisation resource IDs return **404** (do not confirm existence). [CURRENT] mix of 403/404; tests accept either.
4. A user in several organisations has one active organisation per session; switching creates a new session after membership verification ([CURRENT] `switch-organisation`).
5. Legacy `users.org_id` is never used for authorisation. [CURRENT] used as the default org for generic login and in the org list query.
6. [PROPOSED] Composite foreign keys (e.g. `employees(org_id, id)` referenced by `timesheet_submissions(org_id, employee_id)`) so a row cannot reference another tenant's parent even through a bug (BACKEND-SCHEMA §6).
7. [DEFERRED] PostgreSQL Row-Level Security as defence in depth.

## 7. Branch isolation [REQUIRED]

1. Every operational resource resolves to a branch: employee → `employee_branches` primary branch ([CURRENT] `employees.location_id`); daily record/shift → the branch where it is worked ([PROPOSED] `daily_records.location_id NOT NULL`, stamped from the roster; [CURRENT] none); submission → employee's primary branch; leave → employee's primary branch; lock → `fortnight_locks.location_id` [PROPOSED].
2. Branch-scoped permissions are satisfied only by an assignment at that branch, or an all-branches assignment (`scope_type='organisation'`) of `BRANCH_MANAGER`/`BRANCH_ADMIN`/`PAYROLL` whose role grants the permission. `ORG_OWNER`/`ORG_ADMIN` assignments satisfy only administrative permissions (e.g. `BRANCH_VIEW`, `EMPLOYEE_MANAGE`), never roster/timesheet/leave/payroll.
3. Deactivated branches: assignments at them grant nothing; their history remains available to in-scope Payroll reports and (as aggregates only) to Owner/Org Admin summary reports.
4. **No "organisation has no branches" fallback.** Every organisation has at least one branch after migration.
5. Employees with no branch (`location_id IS NULL`) are assigned to the organisation's primary branch by migration; after that, `employees.location_id`/primary branch is `NOT NULL`.

## 8. Resource authorisation (IDOR prevention) [REQUIRED]

For every endpoint that takes an ID:

```
row = SELECT … FROM <table> WHERE id = $id AND org_id = $sessionOrg      -- 404 if none
scope = resolveScope(row)          -- {branchIds, employeeId, employeeUserId}
authorize(ctx, PERMISSION, scope)  -- 403 if denied
separationOfDuties(ctx, scope)     -- 403 if self-approval etc.
act()
```

Specific rules:
- Bulk operations authorise **each** item and fail the whole request (or report per-item) — never act on a subset silently. [CURRENT — defect D-22] bulk-approve checks each employee but silently drops unauthorised rows and approves the rest; it also allows self-approval.
- Employee self-service endpoints derive the employee from the session; any `employee_id` in the body is ignored or rejected ([CURRENT] `/api/portal/*` resolve the employee by `user_id`; the cross-tenant employee test for `user_id` relinking is `stage5_remediation.test.ts`).
- Reports/exports filter by `scopedEmployeeIds`.
- Membership endpoints verify both the target user's membership and the target branch's organisation before any change. [CURRENT] `POST /api/locations/:id/members` does; `PUT`/`DELETE /api/locations/:id/members/:userId` do **not** check the branch's organisation (D-19).

## 9. API architecture

### 9.1 Conventions [CURRENT]

JSON; responses mostly `{ success, data | error: {code?, message} , message? }`. Some older endpoints return `{ error: 'string' }`. [REQUIRED] Normalise to `{ success: false, error: { code, message } }`.

### 9.2 Route groups [CURRENT]

| Mount | Purpose | Guard pattern today |
|---|---|---|
| `/health` | Health check | public |
| `/api/auth` | Login, platform login, 2FA, verify-login, logout, keep-alive, session list/revoke, forgot/reset password, `/me`, `/organisations`, `select-location`, `switch-organisation`, employee invitation verify/claim, 2FA settings | public or `requireAuth` |
| `/api/organisation/members`, `/api/locations/:id/members` (router `memberships.ts` at `/api`) | Org and branch role management | permissions + manual checks |
| `/api/dashboard` | Today dashboard | auth + legacy role strings |
| `/api/employees` | Staff CRUD, templates, invites | `BRANCH_MANAGE_STAFF` or `ORGANISATION_MANAGE_USERS` |
| `/api/records` | Daily records & shift segments (roster + actuals), stats | any-branch permission; legacy role branch checks |
| `/api/locks` | Roster/timesheet lock, publish | `TIMESHEET_LOCK` or `ORGANISATION_UPDATE` (org-wide) |
| `/api/roster` | Auto-roster, auto-log | any-branch permission |
| `/api/organisation` | Discover (auth), public lookup, `/me`, settings, portal URL regenerate, lock passwords, leave list/review | mixed |
| `/api/organisation/holidays` | Public holidays CRUD | permission |
| `/api/locations` | Public invite verify/accept; branch CRUD, invites | public / permission / `requireOrgOwner` |
| `/api/platform` | Public org-invite verify/claim; Platform Admin: orgs, invites, platform audit | `requireRole(['Platform Admin'])` |
| `/api/portal` | Employee self-service: my timesheet, team roster, leave, enter hours | auth + self |
| `/api/submissions` | Submit, list, review, approve, reject, bulk-approve | per-employee branch checks |
| `/api/reports` | Payroll JSON, CSV, printable HTML | `REPORT_VIEW` (org-wide) |
| `/api/xero` | [DEFERRED] OAuth callback (public), status, connect, disconnect, mock-connect, preview | permission |
| `/api/audit` | Org audit log; clear always 403 | `ORGANISATION_VIEW` or `REPORT_VIEW` |
| `/api/announcements` | Posts, reactions, replies, chat permission toggle | auth; `requireRole` for toggle |

### 9.3 Proposed route changes [PROPOSED]

- Add `/api/assignments` (list/grant/revoke/self-grant) replacing role mutation in `/organisation/members/:userId/role` and `/locations/:id/members` (keep old routes as thin wrappers during transition).
- Add `/api/invitations` (create, list, revoke, verify, accept) unifying the four mechanisms; keep old accept URLs working until outstanding invites expire (≤ 7 days); pending invites whose tokens were exposed in plaintext are expired and re-sent (BACKEND-SCHEMA M7).
- Remove `GET /api/organisation/discover` and `GET /api/organisation/lookup/:slug` (no pre-authentication organisation data). `POST /api/auth/login` accepts `entry_code`.
- Add `POST /api/auth/login-links` (email private links, enumeration-safe), `GET/PUT /api/auth/me/profile`.
- Add `/api/leave-requests` (list, `/:id/review`) replacing `/api/organisation/leave-requests*`; `POST /api/portal/leave-requests/:id/cancel`.
- Add `POST /api/locks/unlock` (reason required) alongside `POST /api/locks` (lock only the supplied flag), both taking `location_id`.
- Add `GET /api/portal/my-schedule?from=&to=` (week/month views).
- Add `/api/payroll/periods`, `/api/payroll/report`, `/api/payroll/export/csv|pdf`; add `/api/reports/branch` and `/api/reports/org-summary` (aggregate only).
- `/api/xero/*` stays unmounted from customer UI; [PROPOSED] mount only when `FEATURE_XERO=true`.

### 9.4 Middleware order [REQUIRED]

`requireAuth` (token + session + membership) → route-specific `requirePermission(P)` for coarse gating → handler loads resource → `authorize(ctx, P, resource)` → action → audit.

### 9.5 Pagination [PROPOSED]

Audit log, employees, leave and submissions list endpoints accept `limit`/`cursor` (default 100). [CURRENT] mostly unbounded.

### 9.6 Idempotency [PROPOSED]

Approve/lock/publish are safe to repeat (state checks exist [CURRENT]).

### 9.7 Rate limiting [REQUIRED]

Login, platform login, verify-login, 2FA, forgot-password, reset, invitation verify/accept, public org lookup. [CURRENT] in-memory, login-family only. [PROPOSED] PostgreSQL- or Redis-backed limiter keyed by IP + email, shared across instances.

## 10. Validation [REQUIRED]

- [CURRENT] Ad-hoc validation in handlers (dates, hours, leave types, email format, password policy, time parsing via `timeParser.ts`).
- [PROPOSED] Schema validation per endpoint (e.g. zod) for body, params and query; reject unknown fields on security-sensitive endpoints (role, org, branch IDs); enumerated values (roles, leave types, statuses, entry mode) validated against allow-lists; dates as `YYYY-MM-DD`; pay-period `start_date` must align with the fortnight anchor.
- [REQUIRED] Database constraints back the most important rules (CHECK on status/role enums, unique keys) — BACKEND-SCHEMA §5.

## 11. Email

### 11.1 Current [CURRENT]

`backend/src/services/emailService.ts`:
- Providers: Resend (primary), Postmark, `dev-mock` (tests / unconfigured development). Selected by `EMAIL_PROVIDER` or auto-detected from keys. The re-route of mail to a hard-coded personal address was removed in `7fa3094`.
- `EMAIL_FROM` default is `SimpleHours <onboarding@resend.dev>`; some template bodies still say "Elite Timesheet OS", and the organisation-invite email claims a 7-day expiry that org invites do not have. [REQUIRED] fix before production.
- Templates: organisation invite, employee invite, password reset, 2FA code, suspicious-login verification. Branch invites build their email inline in `routes/locations.ts`.
- Delivery status recorded on `org_invitation_tokens` and `location_invitations` (`delivery_status`, `last_error`).
- If unconfigured in production, sends fail (`success: false`) rather than silently succeeding; the platform console can reveal invite links ("Emergency Debug URLs") — this reveals raw tokens (D-6).
- In non-production the server scrapes a `re_…` key from `key.txt`/`key.rtf` files (`index.ts`). Those files are git-ignored.

### 11.2 Required [REQUIRED]

- All transactional templates live in `emailService.ts` with plain-text alternatives and SimpleHours branding.
- Emails never contain data beyond what the recipient is authorised to see.
- Invitation/reset/verification links use `PUBLIC_URL`, never the request `Origin` header. [CURRENT — defect D-28] reset, platform invites, employee invites, branch invites and verify-login links use `req.headers.origin || FRONTEND_URL`.
- [PROPOSED] Platform console shows "resend" but never raw tokens; emergency links are replaced by a one-time regenerate that displays a **new** link once to the Platform Admin, with audit.
- [DEFERRED] Event notifications (roster published, timesheet rejected, leave decided).

## 12. Error handling [REQUIRED]

- [CURRENT] Global handler returns `{ error: 'Internal server error' }` and logs the error. Most handlers return static messages. `routes/locks.ts` returns `err.message` (D-16).
- [REQUIRED] No stack traces, SQL, constraint names or exception text in responses. Use stable error codes (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `SESSION_EXPIRED`, `PERIOD_LOCKED`, …).
- [REQUIRED] Authorisation denials do not reveal *why* in a way that leaks other tenants' data. [CURRENT] Some 403 messages include branch UUIDs and role names ("does not hold an active branch membership in target branch <uuid>") — acceptable for own-org branches, but [PROPOSED] generic message to client, detailed reason to server log.
- [REQUIRED] Errors inside authorisation code deny (500), never allow.

## 13. Security

### 13.1 Controls summary

| Control | Current | Required / Proposed |
|---|---|---|
| Authentication | bcrypt, JWT + server session | + audience separation, generic login errors |
| Authorisation | Partial permission model; legacy role strings in many places; fail-open fallbacks | Single assignment-based model, deny by default (§5) |
| Tenant isolation | `org_id` from token/session; TENANT_MISMATCH check | + composite FKs, 404 on foreign IDs, no `users.org_id` use |
| Branch isolation | Strong in submissions; weak in reports, leave, locks, records, audit, dashboard | Resource-derived branch everywhere (§7) |
| IDOR | Many handlers check `id AND org_id`; tests for several | Policy layer §8 on every ID-taking endpoint |
| Session security | 15 min idle, 24 h absolute, revocation, org binding; `localStorage` token | [PROPOSED] HttpOnly Secure SameSite=Lax cookie + CSRF token; revoke on sidebar sign-out (D-14) |
| Password security | bcrypt 10; policy inconsistent | One policy; [PROPOSED] bcrypt 12 |
| Invitation security | Mixed: hashed/expiring for employee and branch invites (branch accept requires sign-in as the invited account since `7fa3094`); plaintext/no-expiry org invites; employee invite links returned to callers | Hashed, expiring, single-use, email-bound, assignment-exact, never returned by any API (§4.3, PRD §7.9) |
| Audit logs | `audit_logs` with actor, org, branch, target, previous/new values; immutable via API; failed logins written under a hard-coded placeholder org UUID | Categorised (security / administration / operational); failed logins to `login_history` only |
| Rate limiting | In-memory, login family | Shared store, wider coverage (§9.7) |
| Security headers | nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy, CSP (`'unsafe-inline'` scripts) | [PROPOSED] HSTS, remove `'unsafe-inline'` for scripts, remove legacy X-XSS-Protection |
| CORS | Allow-list + any `localhost:*` + requests without Origin | [PROPOSED] production allow-list = `PUBLIC_URL` only (single-origin deploy) |
| Secrets | Railway variables; `.env*` and key files git-ignored; production refuses default JWT secret | [REQUIRED] rotate `JWT_SECRET`/`ENCRYPTION_KEY` before production data; never log secrets |
| Encryption at rest | Xero tokens AES-256-GCM (`ENCRYPTION_KEY`) | Provider disk encryption (verify on Railway) |
| Logging | `console.error` with full errors | [PROPOSED] structured logs; no tokens/passwords/PII in logs |

### 13.2 Threat checklist [REQUIRED]

Each must have an automated test before production (IMPLEMENTATION-PLAN Phase 8):

| Threat | Mitigation |
|---|---|
| IDOR on employee/timesheet/leave/shift IDs | §8 load-then-authorize; 404 for foreign org |
| Cross-organisation access | session org only; composite FKs |
| Cross-branch access | resource-derived branch; list filtering |
| Parameter manipulation (`location_id`, `branch_id`, `employee_id`, `organisation_id`, `user_id` in body/query/header) | ignored for authorisation; validated as filter only |
| URL manipulation (`/o/<other-code>`, `/login/<other-slug>`) | membership check; generic error |
| Role escalation (creating `Platform Admin`, `ORG_OWNER`) | role allow-lists; subset rule §5.7 |
| Permission escalation via JWT claims | JWT carries no authority |
| Self-assigned permissions | self-change blocked; Owner self-grant audited path only |
| Unauthorised modification of locked/approved data | lock/status checks in every write path ([CURRENT] mostly) |
| Session fixation/hijack | server sessions bound to org; rotate on login and org switch |
| Token leakage | hashed at rest; never returned; link base from `PUBLIC_URL` |
| Brute force | shared rate limiting; challenge-bound codes |
| CSV/formula injection | [CURRENT] neutralised |
| XSS in printable report (`document.write`) | [CURRENT] `generatePrintableHtml` has an `escapeHtml` helper; [REQUIRED] test that every interpolated value (names, departments, notes) is escaped |

### 13.3 Schema drift [REQUIRED]

The pg-mem schema in `db.ts` and the test suites' hand-written schemas omit CHECK constraints and foreign keys present in migrations, which is how D-8 went unnoticed. [CURRENT since `7fa3094`] a migrations-built PostgreSQL 16 test database exists, used so far by one suite. Required: move every DB suite onto it (retire hand-written schemas), and run it in CI.

## 14. Deployment

### 14.1 Current [CURRENT] (verified 2026-09-21 via Railway API)

- Railway project `elite-timesheet-os`, one environment `production` (used as **staging**; `DEPLOY.md` warns against real data).
- Services: `elite-timesheet-os` (app), `Postgres`, `Postgres-aFLF`. **Two Postgres services exist; which one `DATABASE_URL` references was not verified** (variables were deliberately not read). [REQUIRED] Confirm and decommission the unused one only after verifying it holds no needed data.
- `railway.json`: Nixpacks build `npm run build`; start `npm start` (= `migrate up` → `bootstrap` → `node dist/index.js`); health check `/health`; restart on failure (5 retries); 1 replica.
- Required variables (names only): `NODE_ENV=production`, `NPM_CONFIG_INCLUDE=dev`, `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `REQUIRE_SESSION_ID=true`, `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`, optional `SEED_DEMO_ORG`, `DEMO_*`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `PUBLIC_URL`, `DB_SSL`, `XERO_*` [DEFERRED].
- Migrations run on every boot (idempotent via `pgmigrations`).
- Migrations 483 and 500 were committed in `d79af08` (2026-09-21). Whether the Railway service has deployed that commit was not verified; if it has, the D-8 CHECK conflicts apply to the live database.
- `render.yaml` describes an alternative Render + Neon deployment; not in use. [PROPOSED] remove or mark legacy.

### 14.2 Required [REQUIRED]

- Separate `staging` and `production` Railway environments with separate databases before real data.
- Database region: confirm Railway region; prefer an Australian/APAC region (PRD §13).
- Automated backups with a tested restore.
- Migrations reviewed for lock impact; destructive migrations split into expand → migrate → contract (BACKEND-SCHEMA §9).
- The bootstrap script must not add the Platform Admin as a tenant member (D-9).

## 15. Testing architecture

### 15.1 Current [CURRENT]

- Jest 30 + `@swc/jest`, supertest, `--runInBand`. At the first audit (before `7fa3094`): 21 suites, **255 tests, all passing**; `npm run typecheck` passed (frontend bundle 833 kB warning). `7fa3094` added `tests/security/critical_hotfixes.test.ts` (22 suites); that run was not repeated for these documents.
- Since `7fa3094`, Jest `globalSetup` builds a fresh PostgreSQL 16 database from the real migrations (`docker compose up -d db-test`, port 55432; `TEST_DATABASE_URL` override), so `npm test` now requires that server. Only `critical_hotfixes.test.ts` uses it through `tests/helpers/testDb.ts`; the other DB suites still swap in hand-written pg-mem schemas with `setPool`.
- Most suites mint JWTs directly without sessions (session enforcement is off outside production), so session-required behaviour is barely tested.
- Only two suites (`organisation_hierarchy_and_permissions`, `organisation_and_locations_architecture`) create branches; the other 19 exercise the fail-open "no branches" fallback.
- Gaps: payroll role (absent), report/export branch scoping, leave branch scoping, lock scoping, audit scoping, holidays, Xero denial, `x-location-id` spoofing, Org Admin as caller, deactivated branches, invite reuse/expiry for branch invites, dashboard scoping, Platform Admin tenant bypass, `REQUIRE_SESSION_ID=true`.

### 15.2 Required [REQUIRED]

1. A shared test fixture builder (orgs, branches, users, assignments, employees, periods) used by all suites.
2. Tests run with `REQUIRE_SESSION_ID=true` and real sessions via the login endpoint or a session helper.
3. An **authorisation matrix test**: for every endpoint × every role fixture (Owner-no-branch, Org Admin, Branch Manager A, Branch Admin A, Payroll org, Payroll branch A, Employee A, John = Employee A + Manager B, other-org Owner, Platform Admin) assert the expected status. The matrix is data-driven from the table in §5.3.
4. CI on real PostgreSQL 16 (migrations up from empty, plus the migration from the current production schema with seeded legacy data).
5. Frontend: component tests for capability-driven navigation (Vitest + Testing Library) [PROPOSED]; end-to-end smoke for the employee timesheet flow [PROPOSED].
6. `npm run typecheck` and `npm test` remain mandatory before completion (`agent.md`).

## 16. Observability and logging

- [CURRENT] `console.log/error`; Railway log viewer; `/health` returns uptime. `login_history` and `audit_logs` in the DB.
- [PROPOSED] Structured JSON logs with request ID, user ID, org ID, route, status, latency; redaction of tokens/passwords/emails in logs; error tracking (e.g. Sentry) [DEFERRED pending vendor decision]; alert on repeated authorisation denials per user and on 5xx rate.

## 17. Performance considerations

- [CURRENT] Indexes on hot paths (migration 482/483/500); `/records` avoids N+1 (tested); payroll report batched (tested).
- [REQUIRED] Resolve the security context with ≤ 2 queries per request (membership + assignments); cache per request.
- [REQUIRED] List endpoints filter by scoped employee IDs in SQL, not in JavaScript after fetching the whole org.
- [PROPOSED] Paginate audit log and history endpoints.
- [PROPOSED] Split the 833 kB frontend bundle with route-level code splitting.
