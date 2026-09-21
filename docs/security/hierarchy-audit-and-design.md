# SimpleHours — Organisation / Branch / Role / Permission Hierarchy
## Phase 1 Audit + Phase 2 Design Proposal

Status: **PROPOSAL — awaiting approval. No code has been changed.**
Date: 2026-09-21
Baseline: `main` @ `a2795f1` + uncommitted multi-location / permissions work (31 modified files, 12 untracked). That uncommitted work is audited here as "current state"; it has not been reverted or modified.

---

# PART 1 — AUDIT

## 1.1 Verdict

The current system **cannot enforce** `Organisation → Branch → Assignment → Role → Scope → Permission`, for three structural reasons (not individual bugs):

1. **Identity of a role is not stored in one place.** Role is stored in five places that disagree (`users.role`, `organisation_members.role`, `organisations.owner_user_id`, `location_memberships.role`, the JWT `role` claim). Routes read different ones. The JWT role string — minted at login, valid 24h — is still the deciding input for Platform Admin status, `requireRole`, and ~40 hard-coded `role === 'Manager'` style checks.
2. **Operational data has no branch.** Only `employees`, `sessions` and `audit_logs` carry `location_id`. `daily_records`, `shift_segments`, `roster_templates`, `timesheet_submissions`, `leave_requests`, `fortnight_locks`, `public_holidays`, announcements have none. Branch scoping can only be attempted by joining through `employees.location_id`, and the code treats `location_id IS NULL` as "visible to every branch".
3. **Scope is taken from the client and not enforced.** `requirePermission` / `requireAnyPermission` / `requireLocationContext` read the branch from `req.params`, `req.query`, `req.body` and an `x-location-id` header, and `requireAnyPermission` then **ignores a failed check for that branch** if the user holds the permission in any other branch (`middleware/auth.ts:512-516`). Several checks fail **open** on DB errors.

In addition, the new role vocabulary written by the uncommitted `memberships.ts` (`OWNER`, `ORG_ADMIN`, `BRANCH_ADMIN`, …) **violates the production CHECK constraints** from the migrations. This only "works" because dev and tests use a hand-written pg-mem schema with no CHECKs/FKs. On real Postgres, role assignment endpoints would fail.

## 1.2 Critical findings (verified in source)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| C1 | **Critical – cross-tenant** | A Company Admin can create a user with `role: 'Platform Admin'` (no allowlist). Invite link is returned in the API response, so they can claim it, then log in via `/auth/platform-login` and get every permission in every organisation. | `routes/employees.ts:95-108`, `:245-259`; `permissionService.ts:185`; `auth.ts:745` |
| C2 | **Critical – account takeover** | Accepting a **location invite** for an **existing** account does not require that account's password (`if (password) {…}`), and returns a JWT for that user. The inviting Owner receives the raw invite token. | `routes/locations.ts:124-133`, `:205-211`, `:608-609` |
| C3 | **Critical – auth bypass** | `POST /auth/verify-login` accepts a bare 6-digit code with no email/challenge id and matches it against **any user's** open challenge; success issues a session **without 2FA**. IP rate-limit key comes from spoofable `X-Forwarded-For`; `x-test-simulate-suspicious` header honoured in prod. | `auth.ts:588-593`, `:642-673`; `securityService.ts:22`, `:120` |
| C4 | **Critical – data exfiltration** | Email service reroutes mail to a hard-coded personal address (`dennistomang@gmail.com`) for `.local/.test/.example` recipients **and on any Resend 403** (i.e. whenever the sending domain is unverified). Password-reset links, 2FA codes, invites are sent to a third party. | `services/emailService.ts:40`, `:101-128` |
| C5 | **Critical – cross-org** | `PUT/DELETE /api/locations/:id/members/:userId` never check the location belongs to the caller's org. | `routes/memberships.ts:585-603`, `:674-688` |
| C6 | High – cross-org role bleed | Login path for a user with an employee row but no membership copies the **global** `users.role` into the JWT; security context falls back to the JWT role → Company Admin of org A becomes OWNER in org B where they're only an employee. | `auth.ts:351-359`; `permissionService.ts:223-225` |
| C7 | High – scope bypass (systemic) | `requireAnyPermission` passes when the explicit branch check fails but the user has the permission in any branch. Used by employees, locks, holidays, locations, leave, reports, xero. | `middleware/auth.ts:507-516` |
| C8 | High – cross-branch | Branch filtering only applies when the JWT role string is exactly `'Manager'`. Branch Admins, multi-branch managers, owners, and anyone whose JWT role is `'Employee'` but who holds a branch role see **all branches**: employees list, records, record writes, dashboard, audit log, stats. | `employees.ts:17`, `records.ts:71,97,126,220`, `dashboard.ts:62-68`, `audit.ts:12` |
| C9 | High – cross-branch | Payroll reports + CSV/PDF export + Xero preview are org-wide for anyone with `REPORT_VIEW` / `ORGANISATION_VIEW` (branch managers have both). | `reports.ts:21,42,70`; `reportService.ts:62-83`; `xero.ts:127-138` |
| C10 | High – cross-branch | Leave list and leave approve/reject are org-wide (filter by `org_id` only). | `organisation.ts:339-407` |
| C11 | High – cross-branch | Locks, roster publish, public holidays are org-wide; a manager of one branch locks/unlocks/publishes for all. `POST /locks` rewrites both lock flags every call (roster password can unlock timesheets); caller's own login password accepted as lock password. | `locks.ts:47-129`; `holidays.ts` |
| C12 | High – privilege | "manager" branch invite writes **org-level** `'Manager'` into `users.role` and `organisation_members.role`. | `locations.ts:147,156,210` |
| C13 | High – privilege | Membership invite overwrites an existing member's role with no hierarchy check (can downgrade/alter an OWNER member); ORG_ADMIN can delete OWNER members; `'Company Admin'` normalises to OWNER. | `memberships.ts:131-163`, `:320-342`; `permissionService.ts:67` |
| C14 | High – takeover of pending accounts | `POST /employees/:id/send-invitation` returns the invite link to the caller (anyone with `BRANCH_MANAGE_STAFF`). | `employees.ts:523-564` |
| C15 | High – self-approval | Managers can approve / bulk-approve their own timesheet. | `submissions.ts:483-509`, `:697-733` |
| C16 | High – info leak pre-auth | `GET /organisation/lookup/:slug` (public) returns org id, current `portal_slug` (defeats regeneration — old slug reveals new one), branch count, entry mode. `GET /organisation/discover` lets any logged-in user enumerate all orgs. | `organisation.ts:15-121` |
| C17 | High – token handling | Reset / invite lookups accept `token_hash = sha256(t) OR token_hash = t` (a leaked hash is a valid token). Platform org invites stored plaintext, **no expiry**, listed raw by `GET /platform/invitations`. Location invites store plaintext `token`. | `auth.ts:1242,1275,1520,1546`; `locations.ts:26,94,547`; `platform.ts:16,54,231,255` |
| C18 | Medium – fail-open | JWT without `session_id` accepted outside prod; missing `sessions` table ⇒ session "valid"; `requireLocationContext`, `checkUserPermission`, `organisationHasNoBranches` (returns true ⇒ legacy org-wide access) all allow on DB error. | `middleware/auth.ts:106,281,321`; `sessionService.ts:146`; `permissionService.ts:369,423` |
| C19 | Medium | Employee `GET /portal/team-roster` and dashboard `team_today` expose every employee's roster across all branches. | `portal.ts:263-276`; `dashboard.ts:375-386` |
| C20 | Medium | `GET /records/stats` has no permission guard; `POST /employees` trusts `location_id` from body without checking it belongs to the org; `PUT /employees/:id` can relink `user_id` to any org member (incl. owner). | `records.ts:63-97`; `employees.ts:66,139,284-293` |
| C21 | Medium | Announcements moderation / chat toggle via JWT role `'Manager'` → a branch manager can delete org-wide posts and disable chat org-wide. | `announcements.ts:408,445,468` |

All 7 items listed under "Before real data" in `DEPLOY.md` are **still present**.

## 1.3 Data model findings

### Five competing role stores
| Store | Values actually written | Read by |
|---|---|---|
| `users.role` | Platform Admin, Company Admin, Manager, Employee, ORG_MANAGER, + arbitrary body input | login default role, Platform Admin check |
| `organisation_members.role` (CHECK: Platform Admin / Company Admin / Manager / Employee) | + Owner, OWNER, ORG_ADMIN, ORG_MANAGER, EMPLOYEE (**violate CHECK**) | becomes the JWT `role`; permissionService; requireOrgOwner |
| `organisations.owner_user_id` | user id | OWNER resolution |
| `location_memberships.role` (CHECK: manager / admin / employee) | + BRANCH_ADMIN, BRANCH_MANAGER, EMPLOYEE (**violate CHECK**) | permissionService, requireLocationContext |
| JWT `role` claim | whatever login resolved | Platform Admin bypass, `requireRole`, ~40 string comparisons (backend + frontend) |

### Four overlapping membership structures
`users.org_id` (home org) · `organisation_members` · `employees.user_id` (login allowed with just an employee row) · `location_memberships` (+ `employees.location_id` used as fallback branch source).

### Users ↔ employees
- `employees.user_id` nullable, **no UNIQUE(org_id, user_id)** → a user can have several employee rows per org; lookups take `rows[0]`.
- `employees.location_id` is single-valued → an employee cannot work at two branches.
- `users.is_active` is global → deactivating an employee in one org locks the login out of every org.

### Branch-scoping capability per table
| Table | org_id | branch |
|---|---|---|
| employees | ✓ | ✓ (nullable, `ON DELETE SET NULL`) |
| daily_records / shift_segments / roster_templates | ✓ (via parent) | ✗ |
| timesheet_submissions, leave_requests | ✓ | ✗ |
| fortnight_locks, public_holidays | ✓ (UNIQUE per org) | ✗ |
| announcements / reactions / replies | ✓ | ✗ |
| sessions, audit_logs | ✓ | ✓ |

### Schema drift
Three schemas exist: migrations (prod), hand-written pg-mem in `services/db.ts` (dev), and per-test-file pg-mem schemas. pg-mem has **no CHECKs, no FKs**, TEXT for DATE/TIME, missing `UNIQUE(location_id,user_id)` (so `ON CONFLICT` in invite-accept silently fails), missing `UNIQUE(org_id,full_name)`. Some test schemas have no `sessions` table and rely on the fail-open in C18. **The test suite cannot currently detect production authorization failures.**

### Obsolete / unused (candidates — evidence only, nothing deleted)
| Item | Classification | Evidence |
|---|---|---|
| `audit_logs.snapshot` | unreferenced | 0 hits |
| `audit_logs.user_id` | write-only duplicate of `actor_id` | written `$4,$4`, never read |
| `audit_logs.timestamp` vs `created_at` | duplicate | |
| `audit_logs.previous_value/new_value/target_user_id` | write-only (also duplicated inside `details`) | |
| `organisations.is_public_searchable` | write-only (`bootstrap.ts:86`) | public-search concept to be removed |
| `organisations.slug` + `portal_slug` | duplicate org identifiers; both public; old slug stays valid after "regeneration" | `auth.ts:269`, `organisation.ts` |
| `organisations.logo_url` | read-only, never written | |
| `organisation_members.is_active` | written, never enforced | |
| `users.role`, `users.org_id` | legacy global role / home org | source of C1, C6 |
| `location_invitations.token` (plaintext), `org_invitation_tokens.token` (plaintext) | insecure | C17 |
| `location_invitations.created_by`, `locations.updated_at`, `sessions.user_agent` | write-only | low priority |
| `audit_logs.scope = 'platform'` | read, never written → platform audit view always empty | `platform.ts:471` |
| `legacy-backend/`, `legacy-index.html`, `legacy-agent.md`, `index.html.bak` | not referenced by build/deploy | grep + package.json/railway.json |
| `frontend/src/pages/Portal.tsx` (1785 lines) | dead, not imported | |
| `requireTimesheetMode`, `requireLocationContext` | dead middleware | |
| Ghost column `locations.organisation_id` | queried, doesn't exist; fallback drops `is_active` filter | `auth.ts:147,166` |

## 1.4 Frontend findings
- Router (`App.tsx`) gates by JWT `role` string; sidebar gates by `usePermissions`. They disagree (e.g. branch manager with JWT role Employee sees Roster in nav but is bounced). Several role lists omit `'Owner'`.
- Frontend `BRANCH_MANAGER` permission list drifts from backend (missing `ROSTER_DELETE`).
- No UI for membership management (`memberships.ts` is backend-only).
- `PortalAccess` (generic org entry page, 5-click secret to `/platform-gate`), `/find-organisation`, `/signin` implement the public-portal concept to be removed.
- Logout does not call `/auth/logout` (server session survives).
- (Non-security, noted for later) `useToast` identity changes every render → refetch loop; `EmployeeHistory` shows hard-coded fake "Approved 76.0h" data.

## 1.5 Current login / portal / invitation flows
- **Login:** `/login` (generic) and `/login/:slug`; backend accepts `organisation_slug` or `organisation_id` matched against `portal_slug OR slug OR UUID`. Membership from `organisation_members`, else Platform Admin, else any employee row.
- **Portal:** public `/portal-access` page + public `lookup/:slug` returning org metadata; authenticated `discover` search across all orgs.
- **Invites — four separate systems:** platform org invites (`org_invitation_tokens`, plaintext, no expiry), employee invites (`invitation_tokens`, link returned to admin), location invites (`location_invitations`, plaintext token, returned to owner, password-less accept for existing users), membership invites (`memberships.ts`, direct attach of existing users with no acceptance at all).

---

# PART 2 — DESIGN

## 2.1 Final hierarchy

```
Platform (SimpleHours operators)            ← separate plane, not an org role
│
└── Organisation
     ├── Branches (locations)
     ├── Users ── Organisation Membership (1 per user per org; status)
     │             ├── Employee Profile (0..1 per membership) — the person as staff
     │             └── Role Assignments (0..n)
     │                   role  +  scope (organisation | branch:<id>)  +  optional grants
     │                                     ↓
     │                           Effective permissions, each tagged with the set of
     │                           branches (or "all branches") it applies to
     └── Operational data — every row stamped with org_id AND branch_id
```

Rules that define the model:
- **Role ≠ scope.** A role is a named bundle of permissions. Scope is attached to the *assignment*, never to the role. "Sarah = Branch Manager" is not a thing; "Sarah holds Branch Manager @ {Melbourne CBD, Richmond}" is.
- **Operational access is never implied by an organisation-level role.** Owner / Org Admin get timesheet/roster/leave/payroll access only through an explicit additional assignment (which may be scoped to "all branches" — an explicit, audited choice).
- **One account per person.** A user has at most one membership and one employee profile per organisation, and any number of assignments.
- **Self-service is a relationship, not a role permission.** "My schedule / my leave / my profile" is authorised by `resource.employee.user_id = session.user_id`, available to anyone with an active employee profile.
- **Platform operators are not members of tenants.** Platform status lives in its own table, is never writable by tenant APIs, and grants no tenant data access by default.

## 2.2 Role definitions

| Role key | Assignable scope | Purpose | Who may assign it |
|---|---|---|---|
| `ORG_OWNER` | organisation only | Legal/administrative authority: settings, billing, security, integrations, entry link, users & roles, audit | Existing owner only. ≥1 active owner enforced. |
| `ORG_ADMIN` | organisation only | Administration below owner: branches, users, employee records, branch-role assignment, audit view | Owner only |
| `BRANCH_MANAGER` | one or more branches, or "all branches" | Operational management: rosters, timesheet review/approval, leave, branch reports | Owner, Org Admin |
| `BRANCH_ADMIN` | one or more branches, or "all branches" | Branch administration: staff records, rosters, leave; approval only if granted | Owner, Org Admin |
| `PAYROLL` | one or more branches, or "all branches" | Approved hours, payroll data, exports, payroll reports | Owner, Org Admin |
| `EMPLOYEE` | one or more branches | Marks the branches the person can be rostered at. Grants **no** management permissions. Requires an employee profile. | Owner, Org Admin, Branch Admin (own branches only) |

Legacy role strings map as follows in the data migration: `Company Admin`/`Owner`/`OWNER`/`owner_user_id` → `ORG_OWNER`; `Admin`/`ORG_ADMIN` → `ORG_ADMIN`; org-level `Manager`/`ORG_MANAGER` → `BRANCH_MANAGER` at the branches they currently hold memberships in (org-wide "Manager" has no equivalent and is deliberately **not** preserved); `location_memberships` `admin/BRANCH_ADMIN` → `BRANCH_ADMIN`, `manager/BRANCH_MANAGER` → `BRANCH_MANAGER`, `employee` → `EMPLOYEE`; `Platform Admin` → `platform_operators` row (removed from tenant role data).

**Optional grants.** Some permissions are "off by default, may be granted on an assignment" (marked **G** in the matrix). A grant is stored on the assignment, therefore inherits its scope, is audited, and can only be added by someone allowed to assign that role. No grant can add a permission outside the role's grantable set (e.g. you cannot grant `org.billing.manage` to a Branch Manager).

## 2.3 Permission catalogue

Derived from actual endpoints/features. Scope type: **O** = organisation-level (no branch), **B** = branch-scoped.

| Area | Permission | Scope | Endpoints / features it gates today |
|---|---|---|---|
| Organisation | `org.view` | O | org profile, branch list (names only) |
| | `org.settings.manage` | O | break rules, timesheet entry mode, chat toggle |
| | `org.branding.manage` | O | name/display name/logo |
| | `org.entry_link.manage` | O | view/rotate private login URL |
| | `org.security.manage` | O | lock passwords, 2FA policy, session policy |
| | `org.billing.manage` | O | (future billing) |
| | `org.integrations.manage` | O | Xero connect/disconnect |
| | `org.audit.view` | O | full org audit log |
| | `org.holidays.manage` | O | public holidays (org-wide calendar) |
| Branches | `branch.view` | B | branch detail |
| | `branch.create` | O | create branch |
| | `branch.update` | B | edit branch details |
| | `branch.deactivate` | B | deactivate/reactivate |
| Access | `users.view` | O | member list |
| | `users.invite` | O/B | send invitations (bounded by what inviter may assign) |
| | `access.assign_org_roles` | O | assign/revoke ORG_ADMIN (owner) and ORG_OWNER (owner-only rule) |
| | `access.assign_branch_roles` | B | assign/revoke BRANCH_MANAGER / BRANCH_ADMIN / PAYROLL / EMPLOYEE in a branch |
| | `access.assign_employee_role` | B | add EMPLOYEE assignment in a branch (Branch Admin) |
| Employees | `employee.view` | B | staff list/profile (incl. contact details) |
| | `employee.create` | B | create employee profile in branch |
| | `employee.update` | B | edit profile, contracted hours, templates |
| | `employee.deactivate` | B | deactivate/reactivate (no hard delete) |
| | `employee.assign_branch` | B (both source & target) | move / add employee to another branch |
| Scheduling | `roster.view` | B | roster grid, team roster |
| | `roster.edit` | B | create/edit/delete rostered shifts, templates, auto-roster |
| | `roster.publish` | B | publish fortnight |
| | `roster.lock` | B | roster lock |
| | `availability.manage` | B | (future availability) |
| Timesheets | `timesheet.view` | B | actuals, submissions list, variance |
| | `timesheet.edit` | B | enter/adjust actuals on behalf of staff, auto-log |
| | `timesheet.review` | B | mark under review |
| | `timesheet.approve` | B | approve, bulk-approve (never own) |
| | `timesheet.reject` | B | reject with reason (never own) |
| | `timesheet.lock` | B | timesheet lock / unlock |
| Leave | `leave.view` | B | leave requests |
| | `leave.approve` | B | approve (never own) |
| | `leave.reject` | B | reject (never own) |
| | `leave.manage` | B | create/adjust leave on behalf of staff |
| Payroll | `payroll.view` | B | approved hours, pay categories, historical payroll |
| | `payroll.export` | B | CSV/PDF/Xero preview & push |
| Reports | `reports.branch.view` | B | branch dashboards, hours/variance stats |
| | `reports.org.view` | O | org-level aggregates (**headcount/branch-level totals only; no per-employee timesheet detail**) |
| Comms | `announcements.post` | O/B | post announcements |
| | `announcements.moderate` | O/B | delete others' posts/replies |
| Self (relationship) | `self.*` | own profile | my schedule (today/week/month/history), my timesheet entry/submit, my leave, my profile, my security settings |

## 2.4 Permission matrix

Legend: **●** allowed · **B** allowed only in assigned branches · **G** off by default, may be granted on the assignment · **—** not allowed · **S** own records only.
Owner and Org Admin columns are organisation-scoped. "Branch" columns are scoped to the branches on the assignment ("all branches" is a valid explicit scope).

| Permission | Owner | Org Admin | Branch Manager | Branch Admin | Payroll | Employee |
|---|---|---|---|---|---|---|
| org.view | ● | ● | — (branch names of own branches only) | — (same) | — (same) | — |
| org.settings.manage | ● | G | — | — | — | — |
| org.branding.manage | ● | G | — | — | — | — |
| org.entry_link.manage | ● | — | — | — | — | — |
| org.security.manage | ● | — | — | — | — | — |
| org.billing.manage | ● | — | — | — | — | — |
| org.integrations.manage | ● | G | — | — | — | — |
| org.audit.view | ● | ● | — | — | — | — |
| org.holidays.manage | ● | ● | — | — | — | — |
| branch.view | ● | ● | B | B | B | — |
| branch.create | ● | ● | — | — | — | — |
| branch.update | ● | ● | — | G | — | — |
| branch.deactivate | ● | ● | — | — | — | — |
| users.view | ● | ● | — | — | — | — |
| users.invite | ● | ● | — | B (EMPLOYEE only) | — | — |
| access.assign_org_roles | ● (owner-only for ORG_OWNER) | — | — | — | — | — |
| access.assign_branch_roles | ● | ● | — | — | — | — |
| access.assign_employee_role | ● | ● | — | B | — | — |
| employee.view | ● | ● | B | B | B (payroll fields) | — |
| employee.create | ● | ● | — | B | — | — |
| employee.update | ● | ● | G | B | — | S (contact details only) |
| employee.deactivate | ● | ● | — | B | — | — |
| employee.assign_branch | ● | ● | — | — | — | — |
| roster.view | G | G | B | B | — | S (own schedule) |
| roster.edit | G | G | B | B | — | — |
| roster.publish | G | G | B | B | — | — |
| roster.lock | G | G | G | B | — | — |
| timesheet.view | G | G | B | B | B (approved only) | S |
| timesheet.edit | G | G | B | G | — | S (if entry mode = employee, own unapproved only) |
| timesheet.review | G | G | B | G | — | — |
| timesheet.approve | G | G | B | G | G | — |
| timesheet.reject | G | G | B | G | G | — |
| timesheet.lock | G | G | G | G | G | — |
| leave.view | G | G | B | B | B (approved only) | S |
| leave.approve / leave.reject | G | G | B | B | — | — |
| leave.manage | G | G | B | B | — | S (request/cancel own) |
| payroll.view | G | G | — | — | B | S (own approved hours) |
| payroll.export | G | G | — | — | B | — |
| reports.branch.view | G | G | B | G | B | — |
| reports.org.view | ● (aggregates) | ● (aggregates) | — | — | G | — |
| announcements.post | ● | ● | B | B | — | — |
| announcements.moderate | ● | ● | B | B | — | — |

**How Owner / Org Admin get operational access ("G" in those columns):** by holding an additional operational assignment, e.g. `BRANCH_MANAGER @ all branches` or `PAYROLL @ Geelong`. This keeps "owns the company" separate from "reads every timesheet", is visible in the access screen, and is audited.

### Invariants (enforced in backend, tested)
1. **No escalation:** an actor may only create/modify an assignment if they hold `access.assign_*` for that role **and** scope. Only an owner assigns ORG_OWNER / ORG_ADMIN. Branch Admins may only add `EMPLOYEE` in their own branches.
2. **No self-modification:** nobody can add/alter/revoke their own assignments or grants.
3. **Last owner:** the last active ORG_OWNER cannot be revoked, demoted or deactivated; ownership transfer is add-then-remove.
4. **No self-decisions:** approve/reject of timesheets and leave is refused when the subject employee's `user_id` = actor. (Also: an actor's own records are excluded from bulk-approve.)
5. **Payroll reads approved data only** unless additionally granted `timesheet.view` via another assignment.
6. **Deactivated membership / org / branch ⇒ zero access**, checked every request.

## 2.5 Scope model

```
EffectivePermission = { permission, branches: 'ALL' | Set<branch_id> }
```
Computed per request from the DB (never from the JWT):
```
for each active assignment a of (user, org):
    perms = ROLE_PERMISSIONS[a.role] ∪ a.grants
    for p in perms: add a.scope (organisation → 'ALL' for B-perms / org-level for O-perms; branch → {a.branch_id})
```
Checks:
- **Object check** `authorize(ctx, perm, resource)` — `resource.org_id` must equal `ctx.org_id` (else **404**), and `resource.branch_id ∈ branches(perm)` (else **403**). `resource.branch_id` is always **loaded from the database row**, never taken from the request.
- **List check** `scopeFilter(ctx, perm)` → SQL predicate `branch_id = ANY($allowed)` (or no predicate when 'ALL'). A client-supplied `branch_id` filter is intersected with `$allowed`; if it lies outside → **403** (never silently widened, never silently ignored).
- **Self check** — `resource.employee_id = ctx.employee_profile_id` where the profile id is loaded from `(org_id, session.user_id)`.
- The "active branch" in the UI becomes a **view filter only**. It has no security meaning; `select-location` stops minting tokens.

## 2.6 User / organisation / branch relationship model (tables)

```
users                    (identity only) id, email UNIQUE, password_hash, two_factor_*, login_disabled, created_at
platform_operators       user_id PK → users, created_at, created_by       -- replaces 'Platform Admin' role string
organisations            id, name, display_name, status('active'|'suspended'|'closed'),
                         entry_code UNIQUE (random, ≥128-bit), entry_code_rotated_at, settings…
branches (= locations)   id, org_id, name, timezone, status, UNIQUE(org_id, name)
organisation_memberships id, org_id, user_id, status('invited'|'active'|'suspended'|'removed'),
                         created_at, UNIQUE(org_id, user_id)
employee_profiles        (= employees) id, org_id, membership_id UNIQUE NULL, full_name, contact…,
                         status, UNIQUE(org_id, membership_id)
role_assignments         id, org_id, membership_id, role, scope_type('organisation'|'branch'),
                         branch_id NULL, all_branches BOOL, granted_by, granted_at, revoked_at, revoked_by,
                         CHECK(role/scope compatibility), UNIQUE(membership_id, role, branch_id) WHERE revoked_at IS NULL
assignment_grants        assignment_id, permission, granted_by, granted_at   (validated against role's grantable set)
invitations              id, org_id, email, token_hash UNIQUE (sha256 only), expires_at, status
                         ('pending'|'accepted'|'revoked'|'expired'), invited_by, accepted_user_id,
                         delivery_status, created_at
invitation_assignments   invitation_id, role, scope_type, branch_id, all_branches      -- intended assignments
org_provisioning_invites (platform → new org owner) id, email, token_hash, expires_at, status, created_by
```
Operational tables gain `branch_id NOT NULL` (FK, `ON DELETE RESTRICT`), stamped at write time from the DB:
`daily_records`, `timesheet_submissions`, `leave_requests`, `roster_templates`, `fortnight_locks` (UNIQUE(org_id, branch_id, start_date)), `organisation_announcements` (NULL = org-wide). `shift_segments` inherits via `daily_records`. `public_holidays` stays org-wide.

A shift belongs to the branch where it is worked; an employee with EMPLOYEE assignments at two branches can be rostered at either, and each branch's managers see only their branch's shifts for that person.

## 2.7 Database changes required (summary)
- **Add:** `platform_operators`, `organisation_memberships`, `role_assignments`, `assignment_grants`, `invitations`, `invitation_assignments`, `org_provisioning_invites`; `organisations.entry_code`, `organisations.status`; `branch_id` on the operational tables above; `employees.membership_id` + UNIQUE.
- **Constrain:** role/scope CHECKs; `UNIQUE(org_id, user_id)` on memberships; FKs everywhere; `ON DELETE RESTRICT` for branch FKs (branches are deactivated, not deleted).
- **Deprecate then drop (contract phase, only after verification):** `users.role`, `users.org_id`, `users.is_active` (→ `login_disabled` + membership status), `organisation_members`, `location_memberships`, `location_invitations`, `invitation_tokens`, `org_invitation_tokens`, `organisations.slug`, `organisations.portal_slug`, `organisations.is_public_searchable`, `organisations.owner_user_id`, `employees.location_id`, `sessions.location_id`, `audit_logs.snapshot`, `audit_logs.user_id`, `audit_logs.timestamp`.

## 2.8 API authorization model
1. **JWT carries only `sub` (user id) and `sid` (session id).** No role, no org, no branch. Session row binds `org_id`. Every request: validate session (fail closed), load membership (must be `active`), org (must be `active`), assignments + grants → `ctx`. Cached per request only.
2. **One enforcement API**, used by every route:
   - `can(perm, loader)` middleware for object routes — `loader(req, ctx)` fetches the target by id **with `org_id = ctx.org_id`**, returns `{org_id, branch_id, subject_user_id}`; `authorize` enforces scope and self-rules; handler receives the loaded row.
   - `canList(perm)` for lists — provides `req.scope.branchIds` for the SQL filter.
   - `self()` for employee self-service — provides `req.self.employeeId` from the DB.
   - `platformOnly()` — checks `platform_operators`, not a string.
3. **Delete `requireRole`, `requireAnyPermission`, `requireAnyBranchPermission`, `requireLocationContext`, `requireOrgOwner`, `requireTimesheetMode`, and every `role === '…'` comparison.** A lint/test guard fails the build if a route file compares role strings or reads `org_id`/`branch_id` from `req.body/query/params` for authorization.
4. **Fail closed.** Any error in auth/authz ⇒ 401/403/500, never `next()`. Remove all `catch {}` in the authz path; remove the "org has no branches ⇒ org-wide access" legacy fallback (migration gives every org at least one branch).
5. **Response shaping:** cross-org ids ⇒ 404; in-org out-of-scope ⇒ 403; lists never include out-of-scope rows; error messages never echo other tenants' data.
6. **Route inventory** — every route is assigned exactly one of: `public`, `self`, `can(perm)`, `canList(perm)`, `platformOnly`. A test enumerates the Express router and fails if any route lacks a declared policy.

## 2.9 Private-link / login flow
- Each organisation gets `entry_code` — a random, unguessable token (e.g. 22 chars base62). URL: `https://<host>/o/<entry_code>`. Owners can view and rotate it (`org.entry_link.manage`); rotation invalidates the previous code immediately.
- `/o/:code` renders a **generic** SimpleHours sign-in page. **No org name, logo, branch count or any other data** is fetched or shown before authentication. There is **no** public lookup endpoint.
- `POST /api/auth/login { entry_code?, email, password }`:
  - authenticate the user; then resolve the org **server-side**: org with that `entry_code` **and** an active membership for this user. If the code is unknown, rotated, or the user isn't a member → the **same** generic "invalid email or password" response and timing as a bad password (no oracle).
  - suspended org / suspended membership → after successful credentials only, "access unavailable, contact your administrator".
  - then 2FA if enabled (the suspicious-login challenge becomes a step *before* 2FA, never a replacement for it, and is bound to a challenge id + user).
- Users with memberships in several orgs: the private link selects the org. Post-login org switching only lists the user's own active memberships; `switch-organisation` re-validates membership server-side.
- **Removed:** `/portal-access`, `/find-organisation`, `/signin`, `/login/:slug`, `GET /organisation/lookup/:slug`, `GET /organisation/discover`, `is_public_searchable`, slug/UUID fallback in login, the 5-click hidden platform gate on the public page (the platform gate stays at its own route, authenticated against `platform_operators`).
- Invitations embed nothing about the org in the URL beyond the invitation token; the accept page shows org/branch name only **after** the token is validated server-side (the token proves the recipient was invited).

## 2.10 Invitation model
- One `invitations` table for all tenant invites, with the intended assignments in `invitation_assignments`. Created only by an actor allowed to assign every listed role/scope (checked at create **and** re-checked at accept).
- Token: 32 random bytes, stored **sha256 only**, 7-day expiry, single use (atomic `UPDATE … WHERE status='pending' AND expires_at > now() RETURNING`), revocable, resendable (resend rotates token).
- **Tokens are never returned by any API** and never shown in the UI. They are only emailed. In development the mock email provider writes to the server log. "Emergency debug URLs" and returned `inviteLink`s are removed. (Open decision D5 below.)
- Accept:
  - no account for that email → create user (password set here) + membership + assignments + employee profile if EMPLOYEE is included, in one transaction;
  - existing account → recipient must **sign in as that account** (email must match invitation email) before the membership/assignments are attached. Never attach without authenticating.
- Platform → new organisation owner uses `org_provisioning_invites` with the same token rules.

## 2.11 Employee + manager multi-assignment
- John: one user → one membership in ABC Health → one employee profile → assignments `EMPLOYEE @ Melbourne CBD` and `BRANCH_MANAGER @ Melbourne CBD`.
- Navigation = union: "My schedule / My leave / My profile" present because an employee profile exists; "Roster / Timesheets / Leave approvals" present because some branch has those permissions. Management screens list only branches in scope.
- John can view/approve other CBD staff's timesheets but **not his own** (invariant 4); his own approvals route to another holder of `timesheet.approve` for CBD (or anyone with scope 'ALL').
- Works for: employee at A + manager at B; manager of several branches; different roles in different branches.

## 2.12 Migration plan (expand → backfill → switch → verify → contract)
The deployment is staging per `DEPLOY.md` ("no real data"), but the plan is written as if data were real.
1. **M-expand (non-destructive):** create new tables/columns (nullable where backfill is needed). Drop the incompatible CHECKs on `organisation_members.role` / `location_memberships.role` only in the sense of no longer writing to those tables — the old tables stay untouched.
2. **M-backfill (idempotent, transactional, logs a reconciliation report into `audit_logs` with scope 'platform'):**
   - Every org with zero branches gets a branch named "Main".
   - `organisation_memberships` from union of `organisation_members`, `employees.user_id`, `users.org_id`, `location_memberships`.
   - `role_assignments` using the mapping in §2.2. `owner_user_id` ⇒ ORG_OWNER. Legacy org-level Manager ⇒ BRANCH_MANAGER at their location memberships, else at "Main" if the org had no branches, else **flagged for manual review** (not auto-granted org-wide).
   - `Platform Admin` users ⇒ `platform_operators`; their tenant memberships are **not** carried over as roles (flagged).
   - `employees.membership_id` from `user_id`. **Duplicate (org, user) employee rows are reported and block the contract step** — no automatic merge.
   - `branch_id` on operational rows ⇐ `employees.location_id` (or org's "Main").
   - `organisations.entry_code` generated for every org.
   - Pending plaintext invites (`org_invitation_tokens`, `location_invitations`, `invitation_tokens`) are **expired, not migrated** (the tokens were exposed); owners re-send.
3. **Switch:** application reads/writes only the new model (single release; no dual-write needed on staging).
4. **Verify:** reconciliation report reviewed; authz test suite green against migrated real-Postgres DB.
5. **M-contract (separate, later migration, only after sign-off):** drop the columns/tables listed in §2.7 with a `down` that restores structure (data restoration from a pre-contract `pg_dump` taken by the runbook).

Also required: **delete the hand-written pg-mem schema in `services/db.ts`** — dev and tests build their schema by running the real migrations, so constraints can never drift again.

## 2.13 Test plan (Phase 4)
**Harness:** real PostgreSQL (docker-compose already defines one) with migrations applied; one fixture world:
- Org **ABC Health**: branches Melbourne CBD, Richmond, Geelong, Ballarat. Org **XYZ Care**: branch Sydney.
- Actors: Owner, Owner+`BRANCH_MANAGER@all`, Org Admin, Sarah (BM @ CBD+Richmond), Branch Admin @ Geelong, Branch Admin @ Geelong + `timesheet.approve` grant, Payroll @ all, Payroll @ CBD, John (EMPLOYEE+BM @ CBD), Emma (EMPLOYEE @ Geelong), Liam (EMPLOYEE @ CBD and Richmond), XYZ Owner, platform operator, anonymous, suspended member, removed member.

**Matrix-driven tests (generated from the permission table, so every permission gets both):**
- For every route × actor: expected status (200/201/204 vs 401/403/404) **and** response body contains no ids from out-of-scope orgs/branches/employees.
- **ALLOW** and **DENY** case for every permission in §2.3.

**Named negative suites:**
- Cross-org: every object route with XYZ ids from an ABC session ⇒ 404, nothing leaked.
- Cross-branch / IDOR: Sarah → Geelong employees, records, submissions, leave, locks, reports, exports; `?branch_id=`, `body.location_id`, `x-location-id`, path ids — all ⇒ 403 / filtered.
- Role & permission escalation: create/promote to ORG_OWNER, ORG_ADMIN, platform operator; self-grant; Branch Admin assigning BRANCH_MANAGER; assigning scope outside own; editing own assignments; removing last owner.
- Employee isolation: other employees' schedules, timesheets, leave, payroll; team-roster; dashboard.
- Timesheet / leave / payroll isolation incl. self-approval and bulk-approve with own row.
- Payroll: can't see unapproved; can't edit rosters; branch-scoped payroll can't export other branches.
- Owner / Org Admin restrictions: no timesheet access without explicit assignment.
- Multi-assignment: John approves CBD staff but not himself; Liam's shifts visible per branch.
- Invitations: expired, reused, revoked, wrong email, existing account without login, inviter lacks rights at accept time, token never in any API response.
- Private link: unknown/rotated code, non-member with valid credentials, suspended org, response indistinguishable from bad password, no pre-auth org data endpoint exists.
- Session: missing sid ⇒ 401 (all envs), revoked, idle-expired, deactivated membership mid-session, role revoked mid-session takes effect on next request, fail-closed when a table/query errors.
- Route inventory test: every registered route declares a policy; no route file compares role strings.

---

# PART 3 — Out-of-scope issues found (not part of this refactor unless approved)
- `rosterService.ts:22` Friday treated as weekend; `reportService.ts:150` drops `Normal` segments / double break deduction; `roster.ts:21` local-vs-UTC date.
- `useToast` refetch loop; `EmployeeHistory` fake data; `Portal.tsx` dead; logout doesn't revoke server session.
- `platform.ts:156-181` try/catch inside a Postgres transaction (aborted-transaction cascade).
- No rate limit on forgot-password / claim-invitation.

# PART 4 — Decisions needed before Phase 3
See the summary delivered with this document (D1–D8).
