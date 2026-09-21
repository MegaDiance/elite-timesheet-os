# SimpleHours — Product Requirements Document (PRD)

| | |
|---|---|
| Status | Draft for review — authoritative once approved |
| Last audited against code | 2026-09-21 (commit `a2795f1` **plus uncommitted working-tree changes**, see §0.2) |
| Companion documents | [TRD](./TRD.md) · [UI/UX](./UI-UX-DESIGN.md) · [App Flow](./APP-FLOW.md) · [Backend Schema](./BACKEND-SCHEMA.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md) |

---

## 0. How to read this document

### 0.1 Status labels

Every requirement and feature statement carries one of these labels. They are used identically across all six documents.

| Label | Meaning |
|---|---|
| **[CURRENT]** | Exists in the codebase today and was verified during the 2026-09-21 audit. May still contain defects, which are called out. |
| **[REQUIRED]** | Confirmed requirement the final SimpleHours architecture must satisfy. May or may not exist today. |
| **[PROPOSED]** | Architecture or design decided in these documents but **not yet implemented**. |
| **[DEFERRED]** | Intentionally postponed. Must not be built or exposed without a new decision. |

A statement labelled [REQUIRED] without [CURRENT] means it does **not** exist yet.

### 0.2 What "current" means

The audit covered the working tree, not just `HEAD`. Significant hierarchy work is **uncommitted** at the time of writing:

- `backend/migrations/1789367660483_multi_location_and_roles.js` (locations, location memberships, location invitations, portal slug, entry mode, owner)
- `backend/migrations/1789367660500_permissions_and_hierarchy_revamp.js`
- `backend/src/services/permissionService.ts`, `backend/src/routes/locations.ts`, `backend/src/routes/memberships.ts`
- `frontend/src/hooks/usePermissions.tsx`, `frontend/src/pages/Locations.tsx`, `frontend/src/pages/auth/AcceptLocationInvite.tsx`
- Two new test suites covering hierarchy and locations.

Committed `HEAD` has **no branch/location concept at all**. Where this PRD says [CURRENT] for branch functionality it means "present in the working tree".

### 0.3 Terminology

| Product term (UI, docs) | Current code/database term | Notes |
|---|---|---|
| Organisation | `organisations` | A customer business (tenant). |
| Branch | `locations`, `location_memberships`, `location_id` | The product term is **Branch**. Code and DB keep "location" for compatibility; renaming tables is not planned. |
| User | `users` | One login identity (one email). |
| Membership | `organisation_members` | A user's relationship with an organisation. |
| Assignment | *(does not exist as one concept today)* | A grant of one **role** at one **scope** to one user. See §5. |
| Employee (record) | `employees` | The HR/work record that is rostered and paid. May exist without a login. |
| Employee (role) | `location_memberships.role = 'employee'`, legacy `'Employee'` | Self-service access to one's own data. |
| Pay period / fortnight | `fortnight_locks.start_date`, `timesheet_submissions.start_date` | Fixed 14-day cycle anchored on Sunday 2026-03-29 (`backend/src/services/periodUtils.ts`). |

---

## 1. Product overview

### 1.1 What SimpleHours is

SimpleHours is an Australian workforce scheduling, timesheet, leave and **payroll-preparation** SaaS for organisations with one or more branches. It lets a business:

1. Build and publish fortnightly rosters per employee.
2. Record actual hours worked against the roster (by employees or by managers).
3. Submit, review, approve, reject and lock timesheets per pay period.
4. Request and approve leave.
5. Produce payroll-ready reports and exports (CSV/printable PDF) classified into Australian pay categories (ordinary, Saturday, Sunday, public holiday, annual, sick, TIL).

SimpleHours prepares payroll data. It does **not** pay anyone, calculate tax/superannuation, or interpret awards. [CURRENT] as scope; award interpretation is out of scope.

### 1.2 Target customers

[REQUIRED] Australian small-to-medium businesses with shift-based hourly staff, typically 5–150 employees, across 1–20 branches: clinics, hospitality, retail, logistics, care services. Customers are often not experienced with workforce software. The first real deployment is a staging environment (see TRD §14).

### 1.3 Core problem

Small multi-site businesses run rosters in spreadsheets, collect hours by message or paper, and re-key them into payroll. This causes pay errors, missing approvals, disputes about who worked when, and managers seeing (or changing) data for sites they don't run. SimpleHours replaces that with one system where each person sees exactly what their responsibilities require.

### 1.4 Product goals

1. **Accurate pay inputs** — every paid hour traces to a roster, an actual entry, an approval and a locked period.
2. **Correct access** — people see and change only what their assignments allow, per organisation and per branch.
3. **Approachable** — an employee who has never used workforce software can enter and submit a timesheet without training.
4. **Auditable** — every sensitive change has an actor, time, before/after value.
5. **Multi-branch native** — one person, one account, many responsibilities.

### 1.5 Product principles

1. **The backend decides.** Hiding something in the UI is a usability choice, never a security control.
2. **Least privilege by default.** Organisation ownership is administrative authority, not automatic access to every branch's operational detail.
3. **One person, one account.** Responsibilities are assignments, not extra accounts.
4. **Roles and scopes are separate.** "Branch Manager" means nothing until you say *which* branch.
5. **Never lose pay data.** Rostering never overwrites actuals; approved/locked data is immutable except through an audited unlock.
6. **Plain language.** Screens use the words a shift worker would use ("My hours", "Submit for approval"), not system jargon.

---

## 2. Users and user types

### 2.1 Platform operator (outside the customer hierarchy)

**Platform Admin** — SimpleHours staff who provision organisations and monitor delivery. [CURRENT] exists (`users.role = 'Platform Admin'`, `/platform-gate`, `/api/platform/*`).

- [REQUIRED] Platform Admins have **no implicit access** to any organisation's employee, roster, timesheet, leave or payroll data.
- [CURRENT — defect] Today a Platform Admin token receives *every* permission in *any* organisation (`permissionService.resolveUserSecurityContext`), can sign in through a tenant's normal login, and is added as an organisation member by the bootstrap script. This must be removed (IMPLEMENTATION-PLAN Phase 3).
- [DEFERRED] Customer-consented, time-boxed, audited "support access".

### 2.2 Customer user types

| User type | One-line definition | Scope |
|---|---|---|
| Organisation Owner | Accountable administrator of the organisation. | Organisation |
| Organisation Admin | Delegated organisation administrator. | Organisation |
| Branch Manager | Runs day-to-day operations of specific branches, including approvals. | Branch (each assignment names one branch) |
| Branch Admin | Handles branch administration and data entry, without approval authority by default. | Branch |
| Payroll / Finance | Prepares payroll from approved data. | Organisation **or** specific branches |
| Employee | Works shifts; sees own schedule, hours, leave, profile. | Self (own employee record) |

A single user may be several of these at once (§5.4).

### 2.3 What exists today vs. required

| Role | Current representation | Status |
|---|---|---|
| Organisation Owner | `organisations.owner_user_id`; legacy `'Company Admin'`; new `OWNER` | [CURRENT] partially; legacy `'Company Admin'` is normalised to OWNER |
| Organisation Admin | new `ORG_ADMIN` (only in uncommitted code) | [CURRENT] in permission map; **cannot be stored on production Postgres** (CHECK constraint, see BACKEND-SCHEMA §2.3) |
| "Org Manager" | legacy `'Manager'` / new `ORG_MANAGER` | [CURRENT] — **to be retired** (§5.6) |
| Branch Manager | `location_memberships.role = 'manager'` / `BRANCH_MANAGER` | [CURRENT] |
| Branch Admin | `location_memberships.role = 'admin'` / `BRANCH_ADMIN` | [CURRENT] but with a different permission set than required (§6) |
| Payroll / Finance | — | **Does not exist.** [REQUIRED] |
| Employee | `employees.user_id` link; `'Employee'` / `'employee'` / `EMPLOYEE` | [CURRENT] |

---

## 3. Organisations and branches

### 3.1 Organisation

[CURRENT] An organisation (`organisations`) is a tenant: name, display name, slugs, logo, break rules (weekday/weekend minutes, threshold hours), timesheet entry mode (`employee` | `manager`), roster/timesheet lock password hashes, employee-chat toggle, active flag, owner.

[REQUIRED] All tenant data belongs to exactly one organisation. No user sees another organisation's data unless they hold a membership there, and even then only one organisation is active per session.

### 3.2 Branch

[CURRENT, uncommitted] A branch (`locations`) belongs to one organisation: name (unique per org), address, timezone (default `Australia/Melbourne`; provisioning defaults to `Australia/Sydney`), active flag.

[REQUIRED]
- Organisation **1 → many** Branches. A branch never moves between organisations.
- Every organisation has **at least one** branch. [PROPOSED] Legacy branchless organisations get a "Main Branch" created by migration (BACKEND-SCHEMA §9).
- Branches are deactivated, never hard-deleted, while they hold any operational history.

### 3.3 Employees (records)

[CURRENT] `employees` holds the person who is rostered and paid: full name, department, email, phone, contracted hours per fortnight (default 76), active/deleted flags, optional linked `user_id`, and a single `location_id` (uncommitted).

[REQUIRED]
- An employee record belongs to one organisation. A user has **at most one** employee record per organisation.
- An employee record may exist **without** a login (manager-entered timesheets).
- An employee can be rostered at **more than one** branch. [PROPOSED] via `employee_branches` with one primary branch (BACKEND-SCHEMA §4.6). Today only one `location_id` is supported.

### 3.4 Managers, administrators, payroll users

These are users holding assignments (§5). They may or may not also have an employee record. A Branch Manager who also works shifts has both.

---

## 4. The hierarchy

### 4.1 Canonical hierarchy [REQUIRED]

```
Platform (SimpleHours operator — outside the tenant hierarchy)

Organisation ──1:N── Branch
     │
     └──1:N── Membership ──N:1── User (one global account per person)
                  │
                  └──1:N── Assignment = Role + Scope
                                          │
                                          ├── scope = organisation
                                          ├── scope = branch (names exactly one branch)
                                          └── scope = self  (own employee record)
                                                   │
                                  Role ──1:N── Permission
                                                   │
                  Permission + Scope + resource relationship ──► access to a Resource
```

Read as: **Organisation → Branch → User → Assignment → Role → Scope → Permission → Resource.**

### 4.2 Definitions

- **User** — a person's single identity. One email, one password, one set of sessions.
- **Membership** — "this user belongs to this organisation" with a status (invited, active, suspended, removed). No authority on its own.
- **Role** — a named bundle of permissions (e.g. Branch Manager).
- **Scope** — where a role applies: the whole organisation, one named branch, or the user's own employee record.
- **Assignment** — one role at one scope for one user in one organisation, with who granted it and when.
- **Permission** — an atomic capability (e.g. `TIMESHEET_APPROVE`).
- **Resource** — a thing being accessed (a timesheet, a shift, a leave request). Every operational resource belongs to an organisation and, where relevant, a branch and an employee.

### 4.3 Current state vs. required

[CURRENT] The working tree approximates this with:
- `organisation_members.role` (one org-level role per user per org),
- `location_memberships.role` (one branch-level role per user per branch; `UNIQUE(location_id, user_id)`),
- `organisations.owner_user_id`,
- legacy `users.role` and `users.org_id`,
- the JWT `role` claim, which is still trusted by many route checks and by the frontend.

That means today: roles and scopes are **partly** separated (branch roles are scoped), but a user cannot hold two roles at one branch, and there are four overlapping sources of authority. [PROPOSED] A single `role_assignments` table becomes the only authorisation source (BACKEND-SCHEMA §4.4).

---

## 5. Roles and responsibilities

### 5.1 Role catalogue [REQUIRED]

| Role key | Scope type | Purpose |
|---|---|---|
| `ORG_OWNER` | organisation | Accountable administrator: settings, branches, users, security, audit, billing (deferred), integrations (deferred), organisation-level summary reporting. |
| `ORG_ADMIN` | organisation | Delegated administrator: users, branches, employee records, configuration. Cannot manage owners, billing or ownership transfer. |
| `BRANCH_MANAGER` | branch | Operational authority for one branch: employees, rosters, publishing, timesheet review/approve/reject/lock, leave approval, branch reports, branch dashboard. |
| `BRANCH_ADMIN` | branch | Branch administration and data entry: employees, rosters, timesheet entry/editing, leave viewing, branch information, branch reports. **No approval by default.** |
| `PAYROLL` | organisation or branch | Approved timesheets, approved leave, payroll reports and exports, lock/unlock of pay periods in scope. No roster or branch administration. |
| `EMPLOYEE` | self | Own schedule (today/week/fortnight/month/history), own hours, own timesheet submission, own leave, own profile and account security. |

`PLATFORM_ADMIN` exists outside tenants (§2.1).

### 5.2 Organisation Owner — decision

- [REQUIRED] Owner has organisation-wide **administrative** authority.
- [REQUIRED] Owner does **not** automatically see individual timesheets, shifts, leave or payroll lines in any branch. Organisation-level reporting for Owners is **aggregate** (headcount, total hours, cost-centre totals per branch; no per-employee line data) — [PROPOSED] `REPORT_ORG_SUMMARY`.
- [REQUIRED] An Owner who also runs a branch, or does the payroll, receives that access through an explicit `BRANCH_MANAGER` or `PAYROLL` assignment.
- **Controlled exception — self-assignment [PROPOSED]:** In a small business the owner is often also the manager and the payroll officer. An Owner **may** grant themselves an assignment, but only through a dedicated action that requires password re-entry, a written reason, records an audit event `ASSIGNMENT_SELF_GRANTED`, and is shown in the organisation's access list. No other role may self-assign. [CURRENT] Owners can already self-assign to a branch through `POST /api/locations/:id/members` with no re-authentication or reason.
- [CURRENT — defect] The platform provisioning flow (`POST /api/platform/claim-invite`) silently makes the new owner `admin` of the primary branch. [PROPOSED] The setup wizard asks "Will you also manage this branch day-to-day?" and creates a `BRANCH_MANAGER` assignment only on a yes.

### 5.3 Organisation Admin

[REQUIRED] Same administrative reach as Owner except: cannot grant/modify/remove `ORG_OWNER`, cannot transfer ownership, cannot manage billing, cannot delete/deactivate the organisation, cannot self-assign. No branch operational data without a branch assignment. May manage **employee records** (profile data: name, contact, contracted hours, branch placement) across the organisation, but not their timesheets, shifts or leave.

### 5.4 Multiple assignments, one account [REQUIRED]

Example — John has one account in "Vertex Clinics":

| Assignment | Role | Scope |
|---|---|---|
| 1 | `EMPLOYEE` | self (his employee record, primary branch Melbourne CBD) |
| 2 | `BRANCH_MANAGER` | Richmond |

John logs in once. He sees his own schedule and hours (Melbourne CBD shifts) and manages Richmond. He cannot see other Melbourne CBD employees' data, and cannot approve his own timesheet (§6.4).

Also required:
- A user managing several branches holds one `BRANCH_MANAGER` assignment per branch.
- A user may hold different roles in different branches (Manager in Richmond, Admin in Geelong).
- A user may hold two roles at the same branch (e.g. `BRANCH_ADMIN` + `BRANCH_MANAGER`) — [PROPOSED]; today `UNIQUE(location_id, user_id)` prevents it.
- A user may belong to several organisations; only one organisation is active per session ([CURRENT] `SESSION_ORG_CONFLICT`, `POST /api/auth/switch-organisation`).

### 5.5 Employee restrictions [REQUIRED]

Employees must not access management dashboards, other employees' private data (hours, pay, contact details, leave reasons), payroll data, organisation administration or branch administration. Permitted shared information:
- [CURRENT] The **published** team roster for their organisation (names and shift times) via `GET /api/portal/team-roster`. [PROPOSED] Limit it to the employee's own branches and exclude leave types/reasons.
- [CURRENT] Team chat/announcements (`/api/announcements`), controllable by `allow_employee_chat`. [PROPOSED] Keep as organisation-wide by default; branch-level channels are [DEFERRED].
- [CURRENT] "Teammates working today" on the employee dashboard. [PROPOSED] Limit it to the employee's branches, names and shift times only.

### 5.6 Retiring "Org Manager" [PROPOSED]

Today the legacy `'Manager'` organisation role (and `ORG_MANAGER`) grants organisation-wide `ORGANISATION_VIEW`, `BRANCH_VIEW` and `REPORT_VIEW`. It is created automatically when a user accepts a **branch** manager invitation (`routes/locations.ts` accept flow), which gives a single-branch manager organisation-wide payroll report access (§12, defect D-3). `ORG_MANAGER` is retired; its holders are migrated to branch-scoped assignments that preserve only their legitimate branch access (BACKEND-SCHEMA §9.3). "Area manager" is expressed as `BRANCH_MANAGER` at several branches.

---

## 6. Permission philosophy

### 6.1 Rules [REQUIRED]

1. Permissions are granted **only** through assignments. Nothing is granted by a JWT claim, a URL, a client-supplied ID, a legacy role string or a frontend flag.
2. A permission applies only within its assignment's scope.
3. Operational permissions (roster, timesheet, leave, branch reports, employee operational data) are **branch-scoped**. They are never inherited from an organisation role.
4. For any resource, the scope used for authorisation is the **resource's own** organisation/branch/employee as stored in the database — never a branch ID supplied by the client.
5. Deny by default. Missing data, database errors or ambiguous scope result in denial, not access. [CURRENT — defect] Many checks currently fail open (`catch { next() }`, "organisation has no branches" fallback).
6. No one may grant a permission they do not hold, and no one may grant themselves anything (except the Owner exception in §5.2).
7. Nobody approves their own timesheet or leave.

### 6.2 Permission matrix [REQUIRED]

Legend: ● granted in scope · ○ own data only · — not granted. Scope: O = organisation, B = assigned branch, S = self.

| Capability (permission key) | Owner (O) | Org Admin (O) | Branch Mgr (B) | Branch Admin (B) | Payroll (O/B) | Employee (S) |
|---|---|---|---|---|---|---|
| View/update organisation settings (`ORGANISATION_VIEW`, `ORGANISATION_UPDATE`) | ● | ● | — | — | — | — |
| Security settings, lock passwords, portal URL (`ORGANISATION_SECURITY`) | ● | — | — | — | — | — |
| Create/deactivate branches (`ORGANISATION_MANAGE_BRANCHES`) | ● | ● | — | — | — | — |
| Edit branch details (`BRANCH_UPDATE`) | ● | ● | — | ● | — | — |
| Manage organisation memberships and org roles (`ORGANISATION_MANAGE_USERS`) | ● (incl. owners) | ● (not owners) | — | — | — | — |
| Assign branch roles (`BRANCH_MANAGE_USERS`) | ● | ● | — | ● (Employee role only in own branch) | — | — |
| View/edit employee profile records (`EMPLOYEE_VIEW`, `EMPLOYEE_MANAGE`) | ● | ● | ● | ● | view pay-relevant fields | ○ view own |
| View roster (`ROSTER_VIEW`) | — | — | ● | ● | — | ○ own + published team roster |
| Create/edit/delete roster (`ROSTER_CREATE/UPDATE/DELETE`) | — | — | ● | ● | — | — |
| Publish roster, roster lock (`ROSTER_PUBLISH`) | — | — | ● | ● | — | — |
| View timesheets (`TIMESHEET_VIEW`) | — | — | ● | ● | ● approved/locked only | ○ |
| Enter/edit actual hours (`TIMESHEET_EDIT`) | — | — | ● | ● | — | ○ in employee-entry mode, while unlocked |
| Submit timesheet (`TIMESHEET_SUBMIT`) | — | — | ● on behalf (manager mode) | ● on behalf (manager mode) | — | ○ |
| Review / approve / reject (`TIMESHEET_REVIEW`, `TIMESHEET_APPROVE`) | — | — | ● | — | — | — |
| Lock pay period (`TIMESHEET_LOCK`) | — | — | ● | — | ● | — |
| Unlock pay period (`TIMESHEET_UNLOCK`) | — | — | — | — | ● (reason required) | — |
| View leave (`LEAVE_VIEW`) | — | — | ● | ● | ● approved only | ○ |
| Request leave (`LEAVE_REQUEST_SELF`) | — | — | — | — | — | ○ |
| Approve/reject leave (`LEAVE_APPROVE`) | — | — | ● | — | — | — |
| Branch operational reports (`REPORT_BRANCH_VIEW`) | — | — | ● | ● | — | — |
| Organisation summary reports, aggregate only (`REPORT_ORG_SUMMARY`) | ● | ● | — | — | ● | — |
| Payroll report and exports (`PAYROLL_VIEW`, `PAYROLL_EXPORT`) | — | — | — | — | ● | — |
| Public holidays (`HOLIDAY_MANAGE`) | ● | ● | — | — | ● | — |
| Audit log: security & administration events (`AUDIT_VIEW_ADMIN`) | ● | ● | — | — | — | — |
| Audit log: operational events (`AUDIT_VIEW_OPERATIONAL`) | — | — | ● | ● | ● | — |
| Announcements: post, moderate, chat toggle (`ANNOUNCEMENT_MANAGE`) | ● | ● | ● | ● | — | post only if chat enabled |
| Billing (`BILLING_MANAGE`) [DEFERRED] | ● | — | — | — | — | — |
| Integrations, e.g. Xero (`INTEGRATION_MANAGE`) [DEFERRED] | ● | — | — | — | — | — |

Notes:
- Branch Admins wanting approval authority receive a second `BRANCH_MANAGER` assignment at that branch. Per-user custom permission overrides are [DEFERRED].
- In the current code (`permissionService.ts`) `BRANCH_ADMIN` is a **superset** of `BRANCH_MANAGER` (including approve and lock), and org roles hold `REPORT_VIEW`. The matrix above deliberately changes both; the migration preserves existing people's access by granting existing branch `admin` holders both roles (BACKEND-SCHEMA §9.3).

### 6.3 Current permission keys

[CURRENT] 20 keys in `backend/src/services/permissionService.ts`: `ORGANISATION_VIEW/UPDATE/MANAGE_USERS/MANAGE_BRANCHES`, `BRANCH_VIEW/UPDATE/MANAGE_USERS/MANAGE_STAFF`, `ROSTER_VIEW/CREATE/UPDATE/DELETE`, `TIMESHEET_VIEW/REVIEW/APPROVE/LOCK`, `LEAVE_VIEW/REVIEW/APPROVE`, `REPORT_VIEW`. The matrix above adds new keys and splits `REPORT_VIEW` and `BRANCH_MANAGE_STAFF`; the full key mapping is in TRD §5.4.

### 6.4 Separation of duties [REQUIRED]

- A user cannot approve, reject or unlock a timesheet or leave request that belongs to their own employee record, even if they hold the permission in that branch. [CURRENT] Not enforced.
- Payroll unlock of an approved period requires a reason and is audited.

---

## 7. Core features

Each feature lists what exists now and what is required.

### 7.1 Scheduling / rostering

- [CURRENT] 14-day roster grid per employee (`frontend/src/pages/Roster.tsx`, `POST /api/records`). Segment types: WORK, Sick, Annual, TIL (plus legacy `Normal`).
- [CURRENT] Default 14-day roster templates per employee (`roster_templates`), autosaved, applied by "Auto-Roster" (`POST /api/roster/auto-roster`) for selected days.
- [CURRENT] Overlap prevention, midnight-crossing shift splitting, contracted hours shown next to name.
- [CURRENT] Rostering never overwrites actuals (`actual_in`, `actual_out`, `actual_hours`) — a standing rule (see `agent.md`).
- [CURRENT] Roster lock and publish per pay period (`POST /api/locks`, `POST /api/locks/publish`). Publishing requires the roster to be locked and auto-posts an announcement.
- [CURRENT — defect] Locks and publish state are **organisation-wide** (`fortnight_locks` keyed by `org_id, start_date`); a manager of one branch locks/publishes every branch.
- [REQUIRED] Roster locking and publishing are **per branch per pay period**. [PROPOSED] `fortnight_locks.location_id` (BACKEND-SCHEMA §4.9).
- [REQUIRED] Only employees assigned to a branch appear on that branch's roster.
- [DEFERRED] Shift swaps, open shifts, availability capture, award-based cost forecasting, roster templates shared across employees.

### 7.2 Timesheets

- [CURRENT] Actual hours per day with smart time input (`9` → 09:00, `1700` → 17:00), break selection, notes, "match schedule" (`EmployeeTimesheet.tsx`, `POST /api/portal/enter-hours`).
- [CURRENT] Break rules per organisation: weekday/weekend break minutes and a threshold in hours.
- [CURRENT] Timesheet entry mode per organisation: `employee` (employees enter and submit) or `manager` (managers enter and submit on behalf; employee view is read-only).
- [CURRENT] Auto-Log: copy roster into actuals for selected days (`POST /api/roster/auto-log`).
- [CURRENT] Hours are held to 2 decimal places.
- [REQUIRED] Entry mode may later be per branch — [DEFERRED].

### 7.3 Timesheet submission, review, approval, rejection

- [CURRENT] Status machine on `timesheet_submissions`: `Draft → Submitted → Under Review → Approved`, with `Rejected` (reason required) returning to editable and resubmittable. Illegal transitions are blocked (tested).
- [CURRENT] Bulk approve.
- [CURRENT] Per-employee branch authorisation on review/approve/reject/bulk-approve (`submissions.ts checkEmployeeTimesheetPermission`) — the strongest branch boundary in the codebase.
- [REQUIRED] Approver must hold `TIMESHEET_APPROVE` in the employee's branch and must not be the employee (§6.4).
- [CURRENT] `Locked` is shown in reports but never written to `timesheet_submissions.status`. [PROPOSED] Locking is represented by the pay-period lock, and submission status stays `Approved`; the report's derived `Locked` label is retained.

### 7.4 Timesheet locking

- [CURRENT] Two lock flags per pay period: `roster_locked` (blocks roster edits and auto-roster) and `timesheet_locked` (blocks actuals, auto-log, submit, review, approve, leave approval into the period). Changing a lock requires the user's password **or** a shared org "lock password".
- [CURRENT — defect D-1] `POST /api/locks` writes both columns on every call, so changing only the roster lock clears the timesheet lock.
- [REQUIRED] Lock and unlock are separate permissions (`TIMESHEET_LOCK`, `TIMESHEET_UNLOCK`), branch-scoped, and each change is audited with before/after values.
- [PROPOSED] Replace shared lock passwords with the acting user's own re-authentication; retire the shared-secret columns after migration.

### 7.5 Leave

- [CURRENT] Backend: employee submits leave (`POST /api/portal/leave-requests`) with types Sick, Annual, TIL, Unpaid, Other; validates dates, hours (≤ 336), duplicates and locked periods. Managers list (`GET /api/organisation/leave-requests`) and approve/reject (`POST .../:id/review`, reason required on rejection). Approval writes leave segments into daily records.
- [CURRENT — defect] **Employees cannot request leave in the UI.** The only form is in the orphaned `frontend/src/pages/Portal.tsx`, which no route renders. The employee dashboard "Request Leave" button links to `/leave-requests`, which employees are redirected away from.
- [CURRENT — defect D-4] Leave listing and approval are not branch-scoped: any holder of the permission in any branch sees and approves leave organisation-wide.
- [REQUIRED] Employees request, view and cancel (while pending) their own leave. Branch Managers approve leave for employees in their branches only. Payroll sees approved leave in scope.
- [DEFERRED] Leave balances and accruals, leave policies per award, attachments (medical certificates).

### 7.6 Employee management

- [CURRENT] Staff registry (`Employees.tsx`, `/api/employees`): create, edit, deactivate, reactivate, delete (blocked if approved payroll exists), search, department filter, client-side CSV export, per-employee templates, invite/resend invite.
- [CURRENT — defect D-5] `POST/PUT /api/employees` accepts any `role` string from a Company Admin, including `'Platform Admin'` (privilege escalation). The UI offers "Company Admin" as a role even to Managers.
- [REQUIRED] Creating an employee record never grants management roles. Roles are granted only through the assignment screens (§7.9), with anti-escalation checks.
- [CURRENT] Public holidays: backend CRUD exists (`/api/organisation/holidays`); the UI modal exists but cannot be opened. [REQUIRED] Expose it to holders of `HOLIDAY_MANAGE`.

### 7.7 Branch management

- [CURRENT, uncommitted] Locations page: create, edit, deactivate, reactivate, invite manager/admin by email (7-day invite), list managers.
- [REQUIRED] Owners/Org Admins manage branches. Branch Admins edit their own branch's details.

### 7.8 Dashboards

- [CURRENT] `GET /api/dashboard/today` returns either a manager view (today's staff, pending submissions, pending leave, quick actions, owner card with portal URL and counts) or an employee view (today's shift, fortnight summary, my leave, teammates today). The variant is chosen by legacy role strings.
- [REQUIRED] Dashboards are composed from what the user's assignments permit: an Employee+Branch Manager sees both "My schedule" and "Richmond today". An Owner with no branch assignment sees organisation administration and aggregate figures, not individual timesheets.

### 7.9 Invitations and access management

[CURRENT] Four separate invitation mechanisms:

| Mechanism | Table | Token storage | Expiry | Status |
|---|---|---|---|---|
| Organisation (platform → new owner) | `org_invitation_tokens` | **plaintext** | **none** | [CURRENT — defect D-6] |
| Employee account | `invitation_tokens` | SHA-256 hash | 7 days | [CURRENT] |
| Branch (manager/admin/employee) | `location_invitations` | hash **and plaintext** | 7 days | [CURRENT, uncommitted] |
| Org member invite (`POST /api/organisation/members/invite`) | none | — | — | [CURRENT] creates/assigns user with no email or token; the user cannot set a password through it |

[REQUIRED] One invitation model: an invitation names the organisation, the intended assignments (role + scope), the invitee email, the inviter, an expiry, and single use; tokens are stored hashed only; acceptance requires the invitee to authenticate as (or create) the account for that exact email; accepting grants exactly the named assignments and nothing else. [PROPOSED] `invitations` table (BACKEND-SCHEMA §4.12).

### 7.10 Reports and exports

- [CURRENT] Payroll report per pay period (`GET /api/reports/payroll`): per employee contract, rostered, actual, variance, unplanned; classification into ordinary, Saturday, Sunday, public holiday, annual, sick, TIL; exceptions. CSV (RFC 4180, formula-injection neutralised) and printable HTML "PDF" exports. Staff CSV and audit CSV are client-side exports.
- [CURRENT — defect D-3] Payroll reports and exports are organisation-wide and gated only by `REPORT_VIEW`, which every org role and every branch manager/admin holds.
- [CURRENT — defect] Roster-only segments typed `Normal` are dropped from the category columns (`reportService.ts`).
- [REQUIRED] Payroll report/exports require `PAYROLL_VIEW`/`PAYROLL_EXPORT` and include only employees in the Payroll user's scope and only approved (or locked) data. Branch reports require `REPORT_BRANCH_VIEW` and include only the user's branches. Organisation summary reports are aggregate-only.
- [DEFERRED] Scheduled report emails, custom report builder.

### 7.11 Notifications

- [CURRENT] Transactional email only: organisation invite, employee invite, branch invite, password reset, 2FA code, suspicious-login verification (TRD §11). In-app: announcements feed, toasts.
- [DEFERRED] Notification centre, push notifications, email notifications for roster publish / approval / rejection / leave decisions. (Roster publish currently posts an announcement, not an email.)

### 7.12 Team chat / announcements

- [CURRENT] Organisation-wide announcements with emoji reactions and threaded replies; managers can disable employee posting. Moderation is decided by legacy JWT role strings.
- [REQUIRED] Moderation uses `ANNOUNCEMENT_MANAGE`. Organisation-wide scope is retained.

### 7.13 Authentication and security features

- [CURRENT] Email + password (bcrypt), organisation-specific login URL `/login/:slug`, generic `/login` with organisation picker, public workspace-finder page `/portal-access`, email one-time-code 2FA (optional per user), suspicious-login email verification, password reset, 15-minute inactivity timeout with warning, 24-hour absolute session, server-side session revocation and "sign out other sessions", login history, rate limiting (5 attempts / 15 min, in-memory), hidden platform gate.
- [REQUIRED] See §11.

---

## 8. Experiences

### 8.1 Employee experience [REQUIRED]

An employee logs in at their organisation's private URL and lands on **My Schedule / Today**. They can:
- See today's shift, this week, this fortnight, this month and past schedules (published rosters only). [CURRENT] today + fortnight; week/month views [PROPOSED].
- Enter hours for a day in a few taps, see totals update, and submit the fortnight for approval. [CURRENT]
- See whether each fortnight is Draft, Submitted, Needs changes (with the manager's reason), Approved. [CURRENT — defect] Timesheet History shows **hardcoded fake data** for past cycles (`EmployeeHistory.tsx`). [REQUIRED] Real history.
- Request leave and see its status. [REQUIRED] (UI missing today)
- Manage their own profile, password, 2FA and sessions. [CURRENT] security; profile editing [PROPOSED].

The employee interface never shows management navigation unless the same user also holds a management assignment.

### 8.2 Manager experience (Branch Manager / Branch Admin) [REQUIRED]

Lands on a branch dashboard for their branch(es): who is working today, timesheets waiting, leave waiting, roster status. Builds and publishes the roster, enters/fixes hours, reviews and approves (Branch Manager), exports branch reports. A multi-branch manager can view one branch or "All my branches"; the list never includes branches they are not assigned to.

### 8.3 Organisation administration [REQUIRED]

Owner/Org Admin manage organisation details, branches, people and their assignments, employee records, break rules, entry mode, public holidays, security (2FA policy [DEFERRED], lock settings), the private login URL, audit log (security/administration events). They see aggregate figures, not line-level operational data, unless separately assigned.

### 8.4 Payroll preparation [REQUIRED]

A Payroll user selects a pay period and sees, for employees in scope, which timesheets are approved and which are outstanding (status only — no editing), classified hours, approved leave and exceptions; locks the period; exports CSV/PDF. Unlocking requires a reason. [CURRENT] The report exists; the role, scoping, and approved-only filtering do not.

---

## 9. Multi-branch requirements [REQUIRED]

1. A user's branch access is exactly the set of branches in their active branch-scoped assignments.
2. Lists (employees, rosters, timesheets, leave, reports, audit) are filtered server-side to that set.
3. Every single-resource request is checked against the resource's own branch.
4. A branch selector in the UI is a **view filter**, not a security context. [CURRENT] The active branch lives in the JWT/session (`POST /api/auth/select-location`) and the server trusts a client-provided `location_id`/`x-location-id` to choose which branch's permissions to evaluate. [PROPOSED] Evaluate per resource instead (TRD §5.5).
5. Employees working at several branches appear on each of those branches' rosters, and their timesheet for a period is reviewed by a manager of the branch where each shift occurred. [PROPOSED] Phase 1 simplification: timesheet review authority follows the employee's **primary branch**; per-shift branch attribution is [DEFERRED] (see IMPLEMENTATION-PLAN "Open decisions").
6. Deactivating a branch revokes all its branch-scoped assignments' effect immediately and hides it from rosters, while retaining its history.

---

## 10. Private organisation login [REQUIRED]

Intended model:

```
Public website (marketing only, no workspace search)
      ↓  customer bookmarks / receives their private login link
Organisation private login URL  /login/<portal_slug>
      ↓
Authentication (email + password, 2FA / verification if required)
      ↓
Membership verification for THAT organisation
      ↓
Role + scope resolution from assignments
      ↓
Correct landing page (employee schedule, branch dashboard, admin overview, payroll)
```

- The URL is an **entry point, not a security boundary**. Knowing it grants nothing; every request is authorised by session + membership + assignment.
- [PROPOSED] Remove the public workspace-finder (`/portal-access` slug entry) and the authenticated organisation search (`GET /api/organisation/discover`). Replace the generic `/login` organisation picker with an "Email me my sign-in link" form that emails the user the private URLs of organisations they belong to, with an identical response whether or not the email exists.
- [PROPOSED] Login URLs use the unguessable `portal_slug`. Human-readable `slug` URLs keep working during a transition, then redirect to a neutral page.
- [REQUIRED] Wrong password, unknown email, and "no membership in this organisation" produce the **same** error to the client. [CURRENT — defect] The current response distinguishes `NO_ORGANISATION_ACCESS`, revealing that the password was correct.
- [REQUIRED] Platform Admins cannot sign in through tenant login URLs. [CURRENT — defect] They can.

---

## 11. Security requirements [REQUIRED]

1. Every protected request establishes, on the server: authentication → active session → organisation membership → assignments → scope → permission → resource relationship.
2. Client-supplied organisation, branch, employee or user IDs are never trusted without verifying the relationship in the database.
3. Explicit protection against: IDOR, cross-organisation access, cross-branch access, parameter and URL manipulation, role escalation, permission escalation, self-assignment, unauthorised modification.
4. Only hashed secrets are stored (passwords, invitation/reset/verification tokens, 2FA codes, session tokens). No endpoint returns a stored token.
5. All authorisation changes, approvals, rejections, locks, unlocks, exports and security events are audited with actor, organisation, branch, target, previous and new value, IP and time.
6. Internal errors never expose stack traces, SQL or exception text to clients.
7. Rate limiting on authentication, token verification and public lookup endpoints; [PROPOSED] shared across instances.
8. Session tokens: short inactivity timeout (15 min [CURRENT]), absolute lifetime (24 h [CURRENT]), server-side revocation [CURRENT]. [PROPOSED] HttpOnly Secure SameSite cookies instead of `localStorage` bearer tokens.
9. Data protection: comply with the Australian Privacy Act 1988 (APPs) for employee personal information, and retain employee time and pay records for the period required by the Fair Work Act 2009 and Fair Work Regulations (currently 7 years — to be confirmed with legal advice before production).
10. [CURRENT] Known open defects are listed in §12. Real employee or payroll data must not be loaded until all "Critical" items are resolved (as `DEPLOY.md` already states).

---

## 12. Known defects affecting requirements (from the 2026-09-21 audit)

| ID | Severity | Defect | Where |
|---|---|---|---|
| D-1 | Critical | Changing roster lock clears timesheet lock | `backend/src/routes/locks.ts` (upsert writes both flags) |
| D-2 | Critical | `POST /api/auth/verify-login` accepts a bare 6-digit code matched against any user's challenge | `backend/src/routes/auth.ts` verify-login |
| D-3 | Critical | Payroll report/exports organisation-wide for any `REPORT_VIEW` holder; branch managers and legacy "Manager" see all branches | `routes/reports.ts`, `services/reportService.ts`, `permissionService.ts` |
| D-4 | High | Leave list/approval not branch-scoped | `routes/organisation.ts` leave routes |
| D-5 | Critical | Company Admin can create a `Platform Admin` via `role` field | `routes/employees.ts` POST/PUT |
| D-6 | High | Org invite tokens plaintext, no expiry, returned by `GET /api/platform/invitations`; location invite tokens also stored plaintext | `routes/platform.ts`, `routes/locations.ts` |
| D-7 | High | Token lookups accept `hash OR raw` | `routes/auth.ts`, `routes/locations.ts` |
| D-8 | Critical | New role values (`OWNER`, `ORG_ADMIN`, `BRANCH_ADMIN`, …) violate production CHECK constraints; hierarchy writes only work on the in-memory dev DB | `migrations/…478`, `…483` vs `routes/memberships.ts` |
| D-9 | Critical | Platform Admin receives every permission in every organisation and can use tenant login | `permissionService.ts`, `routes/auth.ts` |
| D-10 | High | Fail-open authorisation paths (`catch { next() }`, "no branches" fallback, sessions-table-missing = valid) | `middleware/auth.ts`, `permissionService.ts`, `sessionService.ts` |
| D-11 | High | Roster/timesheet locks and publish are organisation-wide, not per branch | `fortnight_locks`, `routes/locks.ts` |
| D-12 | Medium | `calculateRosterStats` treats Friday as weekend and Sunday as weekday | `services/rosterService.ts` |
| D-13 | Medium | Roster-only `Normal` segments dropped from payroll category columns | `services/reportService.ts` |
| D-14 | Medium | Sidebar sign-out does not revoke the server session | `frontend/src/components/Layout.tsx` |
| D-15 | Medium | Employee leave request UI missing; timesheet history fake | `frontend/src/pages/*` |
| D-16 | Medium | `locks.ts` returns raw `err.message` on 500 | `routes/locks.ts` |
| D-17 | Low | Owner treated inconsistently in frontend role checks (Settings, Announcements, chatbot) | `frontend/src/pages/Settings.tsx` etc. |
| D-18 | Critical | Location-invite acceptance issues a JWT with no server session (rejected in production, long-lived bearer in dev) | `routes/locations.ts` accept |

---

## 13. Non-functional requirements

| Area | Requirement | Status |
|---|---|---|
| Availability | Single Railway service with health check; target 99.5% during business hours (AEST/AEDT) once production. | [CURRENT] staging; target [REQUIRED] |
| Performance | Roster and timesheet screens for 150 employees × 14 days load < 2 s p95; no N+1 queries on `/records` (tested). | [REQUIRED]; N+1 guard [CURRENT] |
| Scalability | Stateless app instances; rate limiting and sessions must work with >1 instance. | [PROPOSED] (rate limiter is in-memory today) |
| Timezones | Pay-period dates are calendar dates without timezone drift (`DATE` parsed as string). Branch timezone stored; [PROPOSED] used for "today" calculations. | partial [CURRENT] |
| Accessibility | WCAG 2.2 AA for employee flows. | [REQUIRED]; gaps listed in UI-UX §13 |
| Mobile | Employee flows fully usable on a phone (≥ 360 px). | [CURRENT] mobile nav exists; [REQUIRED] |
| Browser support | Current Chrome, Safari (incl. iOS), Edge, Firefox. | [REQUIRED] |
| Data residency | Australian customers' data should be hosted in an Australian or approved region. | [REQUIRED] to confirm — Railway region not verified |
| Auditability | Audit log immutable through the API ([CURRENT] `DELETE /api/audit/clear` always 403). | [CURRENT] |
| Backups | Daily database backups with tested restore before production. | [REQUIRED], not verified |

---

## 14. Deferred functionality

| Item | Status and notes |
|---|---|
| Payments / subscription billing | [DEFERRED]. No billing code exists. Pricing page is static marketing with no prices. |
| Xero integration | [DEFERRED]. Backend has signed OAuth state, encrypted token storage, mock-connect and a preview transform; **no real token exchange and no push to Xero**. No UI exposes it (only marketing copy and a chatbot reply mention it — these should be removed or marked "coming later"). Routes remain but must not be exposed to customers. |
| Other payroll integrations (MYOB, KeyPay/Employment Hero) | [DEFERRED] |
| Award interpretation, penalty-rate costing | [DEFERRED] |
| Leave balances / accruals | [DEFERRED] |
| Availability, shift swaps, open shifts | [DEFERRED] |
| Clock-in/out kiosk or geofenced mobile clock | [DEFERRED] |
| Notification centre / push / event emails | [DEFERRED] |
| Custom roles and per-user permission overrides | [DEFERRED] |
| Platform support-access grants | [DEFERRED] |
| Organisation-enforced 2FA policy, SSO | [DEFERRED] |
| Branch-level chat channels | [DEFERRED] |
| Per-branch timesheet entry mode | [DEFERRED] |
| Per-shift branch attribution for multi-branch employees | [DEFERRED] |

---

## 15. Success criteria

The architecture phase is successful when:

1. All six documents are approved and agree with each other.
2. An automated test suite proves, on **real PostgreSQL** (not only pg-mem), that:
   - no role can read or write another organisation's data;
   - a Branch Manager of A gets 403/404 for every branch-B resource (employees, roster, timesheets, leave, reports, audit, locks);
   - an Owner with no branch assignment cannot read any timesheet, shift, leave request or payroll line;
   - Payroll sees only approved data in scope and cannot edit rosters;
   - an Employee cannot reach any management endpoint;
   - John (Employee at A + Manager at B) works with one account and cannot approve his own timesheet;
   - no one can grant themselves or others more than they hold (Owner self-assignment only through the audited path).
3. Critical defects D-1, D-2, D-3, D-5, D-8, D-9 and D-18 are fixed before any real customer data is loaded.
4. An employee with no training can log in via the private URL, enter a fortnight's hours and submit in under 5 minutes (usability test with ≥ 3 first-time users).
5. A payroll user can produce an approved-only export for a pay period in under 2 minutes.
