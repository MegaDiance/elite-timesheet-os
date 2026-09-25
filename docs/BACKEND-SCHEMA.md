# SimpleHours — Backend Schema Specification

| | |
|---|---|
| Status | Draft for review — authoritative once approved |
| Last audited against code | 2026-09-21, re-baselined on `main` @ `7fa3094` (migrations `1789367660478` … `1789367660500`; `backend/src/services/db.ts` pg-mem schema) |
| Labels | **[CURRENT] [REQUIRED] [PROPOSED] [DEFERRED]** — see [PRD §0.1](./PRD.md#01-status-labels) |
| Companion documents | [PRD](./PRD.md) · [TRD](./TRD.md) · [UI/UX](./UI-UX-DESIGN.md) · [App Flow](./APP-FLOW.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md) |

> **Do not delete production data because it looks unused.** Every removal in this document goes through the expand → migrate → verify → contract process in §9, with a backup and explicit sign-off.

---

## 1. Sources of truth today

| Source | Used by | Notes |
|---|---|---|
| `backend/migrations/*.js` (node-pg-migrate) | Railway/PostgreSQL | Authoritative for production. `478` init, `479` align, `480` announcements, `481` sessions/login security, `482` production alignment + indexes, `483` locations/memberships/invites, `500` hierarchy revamp (both committed in `d79af08`; deployment to Railway not verified). |
| `backend/src/services/db.ts` | `DATABASE_URL=memory` dev server | Hand-written copy. **Omits most FKs and all CHECK constraints**, uses `TEXT` for dates/times, and seeds an `'Owner'` org role that production would reject. |
| Test suites | Jest | Since `7fa3094` a global setup builds a PostgreSQL 16 test database from the migrations; one suite (`tests/security/critical_hotfixes.test.ts`) uses it, the rest still write pg-mem schemas by hand. |

[REQUIRED] Migrations become the single source. The pg-mem schema is generated from migrations or replaced by a real PostgreSQL test database (TRD §13.3).

[CURRENT 2026-09-25] Done: migrations are the only schema; pg-mem and the hand-written `db.ts` schema are gone, and every Jest suite runs on a PostgreSQL database built from the migrations. Recent additive migrations:
- `706_private_link_hardening`: `organisations.portal_slug_hash` (unique; the only lookup column), `portal_slug_enc` (AES-256-GCM, written by the app), `portal_link_expires_at`, `portal_link_created_at`; `portal_slug` made nullable and cleared by the app once the encrypted copy exists. **Contract step (needs approval + backup):** drop `organisations.portal_slug` once every production organisation has `portal_slug_enc` (check: `SELECT count(*) FROM organisations WHERE portal_slug IS NOT NULL` returns 0).
- `707_tutorial_progress`: `users.tutorial_version`, `users.tutorial_completed_at`.

---

## 2. Current schema assessment

### 2.1 Tables [CURRENT] (production = after migration 500)

| Table | Purpose | Key columns | Keys / constraints | Assessment |
|---|---|---|---|---|
| `organisations` | Tenant | `id`, `name`, `slug` UNIQUE, `portal_slug` UNIQUE, `display_name`, `logo_url`, `is_public_searchable`, break settings (`break_mins_weekday`, `break_mins_weekend`, `break_threshold_hours`), `roster_lock_password_hash`, `timesheet_lock_password_hash`, `allow_employee_chat`, `timesheet_entry_mode` CHECK (`employee`,`manager`), `owner_user_id` FK users SET NULL, `is_active`, `created_at` | PK uuid | Keep. `owner_user_id` duplicates ownership (→ assignment). `is_public_searchable` supports the public finder being removed. Lock password hashes = shared secrets to retire. |
| `users` | Login identity | `id`, `email` UNIQUE (case-sensitive), `password_hash` (`'PENDING_SETUP'` sentinel), `role`, `org_id` FK orgs CASCADE, `is_active`, `two_factor_enabled`, `created_at` | PK | **Dangerous**: `users.role` (global role string incl. `'Platform Admin'`) and `users.org_id` (single "home" org with ON DELETE CASCADE — deleting an org deletes users who may belong to other orgs). `email` uniqueness is case-sensitive while lookups use `LOWER(email)`. No `full_name`, no `updated_at`, no `last_login_at`. |
| `organisation_members` | Membership + org role | `organisation_id`, `user_id`, `role` CHECK (`'Platform Admin'`,`'Company Admin'`,`'Manager'`,`'Employee'`), `is_active`, `created_at` | UNIQUE (`organisation_id`,`user_id`) | **D-8**: new code writes `OWNER`/`ORG_ADMIN`/`ORG_MANAGER`, violating the CHECK. Mixes membership with authority. `'Platform Admin'` rows put platform staff inside tenants. |
| `locations` | Branch | `org_id` FK CASCADE, `name`, `address`, `timezone`, `is_active`, timestamps | UNIQUE (`org_id`,`name`) | Keep (product term "Branch"). Add `code`, `is_primary`. |
| `location_memberships` | Branch role | `location_id` FK CASCADE, `user_id` FK CASCADE, `role` CHECK (`manager`,`admin`,`employee`), `is_active`, `created_at` | UNIQUE (`location_id`,`user_id`) | **D-8**: new code writes `BRANCH_ADMIN`/`BRANCH_MANAGER`/`EMPLOYEE`. One role per user per branch. No `org_id` (org derived via location). No `granted_by`. Superseded by `role_assignments`. |
| `location_invitations` | Branch invite | `org_id`, `location_id`, `email`, `role` CHECK, `token` UNIQUE (**plaintext**), `token_hash` UNIQUE, delivery fields, `created_by`, `expires_at`, `accepted_at`, `cancelled_at` | | Plaintext token column must go (D-6). Superseded by `invitations`. |
| `invitation_tokens` | Employee account invite | `token_hash` UNIQUE, `user_id` FK CASCADE, `expires_at` | | OK but no `org_id`, no `used_at` (deleted on use), no email binding beyond the user row. Superseded by `invitations`. |
| `org_invitation_tokens` | Platform → new org owner | `email`, `token` UNIQUE (**plaintext**), `used`, `delivery_status`, `last_error`, `created_at` | | **No expiry, plaintext** (D-6). Superseded by `invitations` (`kind='organisation'`). |
| `reset_tokens` | Password reset | `token_hash` UNIQUE, `user_id` FK CASCADE, `expires_at` | | Keep; add `used_at`, `requested_ip`. |
| `two_factor_codes` | Email 2FA codes | `user_id`, `code_hash`, `expires_at`, `attempts` | | Keep; add `purpose` (`login`,`enable`,`disable`). |
| `sessions` | Server sessions | `user_id`, `org_id`, `location_id`, `token_hash` UNIQUE, device/IP fields, `last_active_at`, `expires_at`, `revoked_at`, `is_active` | indexes on user, token, active | Keep. `location_id` becomes a UI preference only (TRD §5.5). Add `audience` (`tenant`/`platform`). |
| `login_history` | Login audit | `user_id`, `org_id`, `email`, `status`, device/IP, `auth_method`, `session_id` | indexes | Keep. |
| `login_verification_challenges` | Suspicious-login challenge | `user_id`, `org_id`, `role`, `token_hash` UNIQUE, `verification_code` (hashed in code, sometimes compared raw), `attempts`, `expires_at`, `consumed` | | Keep; drop `role` (authority must not be carried by a challenge). |
| `employees` | Employee record | `org_id` FK CASCADE, `user_id` FK SET NULL, `location_id` FK SET NULL, `full_name`, `department`, `email`, `phone`, `contracted_hours` (default 76 per fortnight), `is_active`, `deleted_at` | UNIQUE (`org_id`,`full_name`) in production (**not** in pg-mem) | Keep. Unique-by-name is wrong (two people can share a name). No unique (`org_id`,`user_id`). Single `location_id` blocks multi-branch employees. |
| `roster_templates` | 14-day default roster per employee | `employee_id` FK CASCADE, `day_index` 0–13, `segment_type`, `roster_in`, `roster_out`, `roster_hours` | CHECK day_index | Keep. No `org_id` (via employee). |
| `daily_records` | One row per employee per day | `org_id`, `employee_id`, `record_date` DATE, `has_actuals` | UNIQUE (`org_id`,`employee_id`,`record_date`) | Keep. No branch attribution today; §4.7 adds `location_id`. |
| `shift_segments` | Rostered and actual segments within a day | `record_id` FK CASCADE, `segment_type`, `is_unplanned`, `roster_in/out/hours`, `actual_in/out/hours`, `actual_segment_type`, `notes` | index on record | Keep. `segment_type` values not constrained (`WORK`, `Normal`, `Sick`, `Annual`, `TIL`, …) → D-13. |
| `fortnight_locks` | Per-period lock/publish | `org_id`, `start_date`, `roster_locked`, `timesheet_locked`, `is_published` | UNIQUE (`org_id`,`start_date`) | **Organisation-wide** (D-11). No who/when. |
| `timesheet_submissions` | Per employee per period status | `org_id`, `employee_id`, `start_date`, `status` (text, default `Draft`), `submitted_at`, `reviewed_by`, `reviewed_at`, `rejection_reason` | UNIQUE (`org_id`,`employee_id`,`start_date`) | Keep; add CHECK on status, `submitted_by` (on-behalf submissions), `approved_by/at`. |
| `leave_requests` | Leave | `org_id`, `employee_id`, `leave_type`, `start_date`, `end_date`, `hours`, `reason`, `status` (default `Pending`), `reviewed_by/at`, `rejection_reason` | none beyond PK | Keep; add CHECKs (type, status, dates), `cancelled_at`, index on (`org_id`,`employee_id`,`status`). |
| `public_holidays` | Holidays | `org_id`, `holiday_date`, `name` | UNIQUE (`org_id`,`holiday_date`) | Keep. [DEFERRED] state-specific holidays per branch. |
| `audit_logs` | Audit trail | `org_id` (nullable), `location_id`, `scope` CHECK (`organisation`,`platform`), `actor_id`, `user_id` (duplicate of actor), `target_user_id`, `action`, `entity_type`, `entity_id`, `details` TEXT (was JSONB), `previous_value`, `new_value`, `snapshot`, `ip_address`, `timestamp`, `created_at` | indexes | Keep; `user_id` duplicates `actor_id`; `timestamp` duplicates `created_at`; add `category`. Failed-login rows written with a hard-coded placeholder org UUID (should go to `login_history` only). |
| `organisation_announcements`, `announcement_reactions`, `announcement_replies` | Team chat | `org_id`, author fields (denormalised `author_name`, `author_role`) | reactions UNIQUE (announcement, user, emoji) | Keep. Denormalised `author_role` stores legacy role strings (display only). |
| `xero_connections` | [DEFERRED] Xero tokens | `org_id` UNIQUE, tenant, encrypted tokens, expiry | | Retain for compatibility; no production use. |
| `pgmigrations` | Migration tracking | | | node-pg-migrate. |

### 2.2 Relationships and cardinality [CURRENT]

| Relationship | Cardinality | Enforced by |
|---|---|---|
| Organisation → Branch (`locations`) | 1 : N | FK |
| Organisation → Membership | 1 : N | FK |
| User → Membership | 1 : N (one per org) | FK + UNIQUE |
| User → "home" organisation (`users.org_id`) | N : 1 | FK CASCADE — **legacy/dangerous** |
| User → Branch role (`location_memberships`) | 1 : N (max one per branch) | UNIQUE |
| Organisation → Employee | 1 : N | FK |
| User → Employee record | 1 : N across orgs; **not** unique per org | FK only |
| Branch → Employee (`employees.location_id`) | 1 : N (one branch per employee) | FK SET NULL |
| Employee → Daily record | 1 : N (one per date) | FK + UNIQUE |
| Daily record → Shift segment | 1 : N | FK |
| Employee → Roster template rows | 1 : N | FK |
| Employee → Submission | 1 : N (one per period) | FK + UNIQUE |
| Employee → Leave request | 1 : N | FK |
| Organisation → Period lock | 1 : N (one per period, org-wide) | UNIQUE |
| Organisation → Owner (`owner_user_id`) | N : 1 | FK SET NULL |

### 2.3 Critical problems

1. **Role vocabulary conflict (D-8).** Three vocabularies coexist: legacy title-case (`'Company Admin'`, `'Manager'`, `'Employee'`, `'Platform Admin'`, `'Owner'`, `'Admin'`), lowercase branch roles (`'manager'`, `'admin'`, `'employee'`), and canonical upper-case (`OWNER`, `ORG_ADMIN`, `ORG_MANAGER`, `BRANCH_ADMIN`, `BRANCH_MANAGER`, `EMPLOYEE`). Production CHECKs accept only the first two. `routes/memberships.ts` writes the third → `23514 check_violation` on real PostgreSQL. It passes tests only because pg-mem schemas have no CHECKs.
2. **Four sources of authority**: `users.role`, `organisation_members.role`, `organisations.owner_user_id`, `location_memberships.role` — plus the JWT `role` claim copied from them.
3. **Branch invite acceptance creates an org-level `'Manager'` row**, which normalises to `ORG_MANAGER` and grants organisation-wide `REPORT_VIEW` (D-3).
4. **Organisation deletion cascades into users** via `users.org_id`.
5. **Plaintext tokens** (`org_invitation_tokens.token`, `location_invitations.token`).
6. **Org-wide locks** (`fortnight_locks`).
7. **Missing multi-branch employee support** (single `employees.location_id`).
8. **No DB-level status/type constraints** on submissions, leave, segments.
9. **No tenant-consistent FKs**: `timesheet_submissions.employee_id` can reference an employee of a different `org_id` than the row's `org_id`.

---

## 3. Target entity model [PROPOSED]

```
organisations 1───N locations (branches)
      │                 │
      │                 └──N employee_branches N──1 employees N──0..1 users
      │                                              │                    │
      1                                              │                    1
      N                                              │                    N
organisation_members (user × org, status) ─────────────────────────────── users
      │
      1
      N
role_assignments (role_key, scope_type, location_id?, employee_id?, status, granted_by…)

employees 1──N daily_records 1──N shift_segments
employees 1──N roster_templates
employees 1──N timesheet_submissions ──N:1 pay period (org, start_date)
employees 1──N leave_requests
locations 1──N period_locks (location_id, start_date)       [evolves fortnight_locks]
organisations 1──N invitations 1──N invitation_assignments
organisations 1──N audit_logs
users 1──N sessions, reset_tokens, two_factor_codes, login_history, login_verification_challenges
```

---

## 4. Proposed tables

Only new or changed tables are specified in full. Types are PostgreSQL. All tenant tables keep `org_id UUID NOT NULL`.

### 4.1 `users` (changed)

| Column | Change |
|---|---|
| `email` | Add `UNIQUE (LOWER(email))` index; store lowercased. |
| `full_name TEXT` | Add (display name independent of employee record). |
| `is_active` | Global flag today: deactivating a person in one organisation locks them out of every organisation. **Repurpose** as `login_disabled` (platform/security use only). Per-organisation access is controlled by `organisation_members.status`. |
| `role` | **Deprecated.** Keep read-only during transition; stop reading for authorisation; drop in contract phase. |
| `org_id` | **Deprecated.** Change FK to `ON DELETE SET NULL` in the expand phase (stop cascading user deletion); stop reading; drop in contract phase. |
| `password_hash` | Keep; replace `'PENDING_SETUP'` sentinel with `NULL` + `password_set_at TIMESTAMPTZ`. |
| `updated_at`, `last_login_at` | Add. |

**`platform_operators` (new):** `user_id UUID PK FK users ON DELETE CASCADE`, `created_at`, `created_by`. The only place platform authority lives. No tenant API reads or writes it. Replaces `users.role = 'Platform Admin'`.

### 4.2 `organisations` (changed)

- Keep all current columns except: `owner_user_id` — deprecated (ownership = `ORG_OWNER` assignment); kept in sync during transition, then dropped.
- `is_public_searchable` — deprecated with the public finder; retain column until contract phase.
- `roster_lock_password_hash`, `timesheet_lock_password_hash` — deprecated when re-authentication replaces shared lock passwords.
- Add `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed'))` (replaces `is_active` eventually), `updated_at`.
- Add `entry_code TEXT UNIQUE NOT NULL` (random, ≥ 128-bit, URL-safe) and `entry_code_rotated_at`. This is the private login link `/o/<entry_code>` (PRD §10).
- `slug` and `portal_slug` are deprecated. Both are public identifiers today, and the public lookup returns the current `portal_slug`, so regeneration is defeated (D-23). Keep them for the transition-window redirects, then drop them.

### 4.3 `organisation_members` (changed — membership only)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organisation_id` | UUID NOT NULL FK organisations ON DELETE CASCADE | |
| `user_id` | UUID NOT NULL FK users ON DELETE CASCADE | |
| `status` | TEXT NOT NULL CHECK (`invited`,`active`,`suspended`,`removed`) | replaces `is_active` |
| `joined_at`, `removed_at`, `removed_by` | | |
| `role` | TEXT | **Deprecated** — legacy, read-only, then dropped. Drop the old CHECK in expand phase so historical values are preserved but no new writes depend on it. |
| UNIQUE (`organisation_id`,`user_id`) | | kept |

### 4.4 `role_assignments` (new — the single authorisation source)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `org_id` | UUID NOT NULL FK organisations ON DELETE CASCADE | |
| `user_id` | UUID NOT NULL FK users ON DELETE CASCADE | |
| `role_key` | TEXT NOT NULL CHECK (`role_key IN ('ORG_OWNER','ORG_ADMIN','BRANCH_MANAGER','BRANCH_ADMIN','PAYROLL','EMPLOYEE')`) | |
| `scope_type` | TEXT NOT NULL CHECK (`scope_type IN ('organisation','branch','self')`) | |
| `location_id` | UUID NULL | required iff `scope_type='branch'` |
| `employee_id` | UUID NULL | required iff `scope_type='self'` |
| `status` | TEXT NOT NULL DEFAULT 'active' CHECK (`active`,`revoked`) | |
| `granted_by` | UUID NULL FK users SET NULL | NULL only for system migration |
| `granted_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `grant_reason` | TEXT NULL | required for self-grant |
| `revoked_by`, `revoked_at`, `revoke_reason` | | |
| `source` | TEXT NOT NULL DEFAULT 'manual' CHECK (`manual`,`invitation`,`migration`,`self_grant`,`provisioning`) | |

Constraints:
- `CHECK ((scope_type='organisation' AND location_id IS NULL AND employee_id IS NULL) OR (scope_type='branch' AND location_id IS NOT NULL AND employee_id IS NULL) OR (scope_type='self' AND employee_id IS NOT NULL AND location_id IS NULL))`
- Role ↔ scope validity: `CHECK ((role_key IN ('ORG_OWNER','ORG_ADMIN') AND scope_type='organisation') OR (role_key IN ('BRANCH_MANAGER','BRANCH_ADMIN','PAYROLL') AND scope_type IN ('organisation','branch')) OR (role_key='EMPLOYEE' AND scope_type='self'))`. For `BRANCH_MANAGER`/`BRANCH_ADMIN`/`PAYROLL`, `scope_type='organisation'` means **all branches** (TRD §5.3).
- Tenant-consistent FKs: `FOREIGN KEY (org_id, location_id) REFERENCES locations(org_id, id)`; `FOREIGN KEY (org_id, employee_id) REFERENCES employees(org_id, id)`; `FOREIGN KEY (org_id, user_id) REFERENCES organisation_members(organisation_id, user_id)` (requires the corresponding UNIQUE constraints — §6).
- One active assignment per (user, role, scope): partial unique index `UNIQUE (org_id, user_id, role_key, scope_type, COALESCE(location_id, employee_id, '00000000-0000-0000-0000-000000000000')) WHERE status='active'`.
- Indexes: (`user_id`,`org_id`) WHERE status='active'; (`location_id`) WHERE status='active'; (`org_id`,`role_key`).

Invariants enforced in application code (and tested):
- At least one active `ORG_OWNER` per active organisation.
- `EMPLOYEE` self assignment exists iff `employees.user_id` is set for an active employee record (created/revoked together).
- Revocation is a status change, never a delete (history).

This supports the PRD example: John = (`EMPLOYEE`, self, employee #J) + (`BRANCH_MANAGER`, branch, Richmond); and multiple roles at one branch (`BRANCH_ADMIN` + `BRANCH_MANAGER`).

### 4.5 `locations` (changed)

Add `is_primary BOOLEAN NOT NULL DEFAULT false` with partial unique index `UNIQUE (org_id) WHERE is_primary`; add `UNIQUE (org_id, id)` for composite FKs; add `code TEXT NULL` (short label, unique per org when present).

### 4.6 `employees` (changed) and `employee_branches` (new)

`employees` changes:
- Add `UNIQUE (org_id, id)` (composite FK target).
- Add partial unique `UNIQUE (org_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL` — one employee record per user per org.
- Drop `UNIQUE (org_id, full_name)` (after checking no code relies on it; replace with a non-unique index for search). Add `employee_code TEXT NULL` unique per org when present (payroll ID).
- `location_id` retained as **primary branch** (denormalised mirror of `employee_branches.is_primary`) until contract phase; becomes `NOT NULL` after backfill.

`employee_branches`:

| Column | Type | Notes |
|---|---|---|
| `org_id` | UUID NOT NULL | |
| `employee_id` | UUID NOT NULL | FK (`org_id`,`employee_id`) → employees |
| `location_id` | UUID NOT NULL | FK (`org_id`,`location_id`) → locations |
| `is_primary` | BOOLEAN NOT NULL DEFAULT false | |
| `start_date`, `end_date` | DATE NULL | |
| PK (`employee_id`,`location_id`) | | |
| partial UNIQUE (`employee_id`) WHERE `is_primary` | | exactly one primary |

Rule [PROPOSED, PRD §9 item 5]: timesheet review/approval and leave approval authority follow the **primary** branch; roster visibility follows **all** listed branches.

### 4.7 `daily_records` / `shift_segments` (changed)

- `daily_records`: add FK (`org_id`,`employee_id`) → employees(`org_id`,`id`). Add `location_id UUID` with FK (`org_id`,`location_id`) → locations, `ON DELETE RESTRICT`. It is stamped server-side with the branch where the day is rostered/worked; the default is the employee's primary branch, and it must be one of the employee's `employee_branches`. It is backfilled from `employees.location_id` (or the primary branch), then set `NOT NULL`. This is what lets each branch see only its own shifts for multi-branch employees (PRD §9 item 5).
- `shift_segments`: add CHECK on `segment_type` and `actual_segment_type` ∈ (`WORK`,`Sick`,`Annual`,`TIL`,`Unpaid`,`Other`, `PublicHoliday`?) after data normalisation (`Normal` → `WORK`, fixing D-13). Add `updated_by`, `updated_at`.

### 4.8 `timesheet_submissions` (changed)

- CHECK `status IN ('Draft','Submitted','Under Review','Approved','Rejected')` (current values; `Locked` is never stored).
- Add `submitted_by UUID` (employee or manager on behalf), `approved_by`, `approved_at` (keep `reviewed_by/at` for review/reject history).
- FK (`org_id`,`employee_id`) → employees.
- `start_date` CHECK aligned to the fortnight anchor is enforced in application code.

### 4.9 `period_locks` (evolves `fortnight_locks`)

| Column | Notes |
|---|---|
| `id`, `org_id`, `start_date` | as today |
| `location_id UUID NOT NULL` | new; FK (`org_id`,`location_id`) |
| `roster_locked`, `timesheet_locked`, `is_published` | as today |
| `roster_locked_by/at`, `timesheet_locked_by/at`, `published_by/at`, `unlocked_by/at`, `unlock_reason` | new |
| UNIQUE (`org_id`,`location_id`,`start_date`) | replaces UNIQUE (`org_id`,`start_date`) |

Migration: each existing org-wide row is copied to one row per active branch of that org (same flags), preserving current behaviour; the table is renamed or a view `fortnight_locks` is kept for compatibility during transition.

### 4.10 `leave_requests` (changed)

CHECK `leave_type IN ('Sick','Annual','TIL','Unpaid','Other')`, CHECK `status IN ('Pending','Approved','Rejected','Cancelled')`, CHECK `end_date >= start_date`, CHECK `hours > 0 AND hours <= 336`; add `cancelled_at`, `requested_by`; FK (`org_id`,`employee_id`); index (`org_id`,`status`,`start_date`).

### 4.11 `audit_logs` (changed)

- Add `category TEXT NOT NULL DEFAULT 'operational' CHECK (category IN ('security','administration','operational','platform'))`.
- `org_id` nullable only when `category='platform'`.
- Deprecate `user_id` (duplicate of `actor_id`) and `timestamp` (duplicate of `created_at`); keep columns, stop writing, backfill-compatible reads.
- Stop writing failed-login rows with the placeholder org UUID; those belong in `login_history`.
- [REQUIRED] No UPDATE/DELETE path in the application. [PROPOSED] revoke UPDATE/DELETE from the app DB role in production.

Visibility: `security`/`administration` → `AUDIT_VIEW_ADMIN` (org scope); `operational` → `AUDIT_VIEW_OPERATIONAL` filtered by `location_id` in the caller's branches (org-scoped Payroll sees all branches); `platform` → Platform Admin only.

### 4.12 `invitations` + `invitation_assignments` (new — unify four mechanisms)

`invitations`:

| Column | Notes |
|---|---|
| `id` UUID PK | |
| `kind` TEXT CHECK (`organisation`,`member`) | `organisation` = platform provisioning of a new tenant; `member` = join an existing org |
| `org_id` UUID NULL | NULL only for `kind='organisation'` before claim |
| `email` TEXT NOT NULL (lowercased) | invitation is bound to this email |
| `token_hash` TEXT UNIQUE NOT NULL | SHA-256; **no plaintext column** |
| `created_by` UUID FK users | |
| `expires_at` TIMESTAMPTZ NOT NULL | default 7 days; organisation invites 7 days |
| `accepted_at`, `accepted_user_id`, `revoked_at`, `revoked_by` | single use |
| `delivery_status`, `last_error`, `sent_count`, `last_sent_at` | email telemetry |
| `employee_id` UUID NULL | links the invite to an existing employee record (employee account invites) |

`invitation_assignments`: (`invitation_id`, `role_key`, `scope_type`, `location_id` NULL, `employee_id` NULL). These are exactly the assignments granted on acceptance, validated with the same role/scope CHECKs as `role_assignments`, with one difference for `EMPLOYEE` (`scope_type='self'`):
- `employee_id` references an existing employee record, **or**
- `employee_id` is NULL and `location_id` names the primary branch for a new employee record. Acceptance then creates the `employees` row, its `employee_branches` row and the self assignment in the same transaction.

The inviter's authority (TRD §5.7 grant table) is re-checked at acceptance time. If the inviter has lost the right to grant, the invite fails.

Resend = rotate `token_hash` (old link dies) — [CURRENT] behaviour for employee invites.

### 4.13 Sessions and security tables (changed)

- `sessions`: add `audience TEXT NOT NULL DEFAULT 'tenant' CHECK (audience IN ('tenant','platform'))`; `org_id` required when `audience='tenant'`; `location_id` retained as UI preference only.
- `reset_tokens`, `invitation_tokens`: add `used_at`; lookups by hash only.
- `login_verification_challenges`: drop `role`; lookups by `id` + hash only.
- `two_factor_codes`: add `purpose`.

### 4.14 Unchanged

`public_holidays`, `roster_templates` (add composite FK via employee), announcements tables, `login_history`, `xero_connections` [DEFERRED].

---

## 5. Constraints and keys summary [PROPOSED]

| Rule | Mechanism |
|---|---|
| Emails unique case-insensitively | `UNIQUE (LOWER(email))` on users |
| One membership per user per org | existing UNIQUE |
| One employee record per user per org | partial UNIQUE on employees |
| One primary branch per org / per employee | partial UNIQUE indexes |
| Role/scope validity | CHECKs on `role_assignments` |
| No cross-tenant references | composite FKs on (`org_id`, `id`) |
| Status/type enums | CHECKs (submissions, leave, segments, locks, audit category, org status, membership status) |
| Unique period per employee | existing UNIQUE on submissions |
| Unique lock per branch per period | UNIQUE on `period_locks` |
| Tokens hashed only | no plaintext token columns after contract phase |

## 6. Tenant isolation in the schema [REQUIRED]

- Every tenant row carries `org_id` directly, or is reachable only via a parent that does (`shift_segments` → `daily_records`, `roster_templates` → `employees`, `invitation_assignments` → `invitations`).
- Add `UNIQUE (org_id, id)` to `locations`, `employees`, and use composite FKs from children so a child's `org_id` must match its parent's.
- Every query filters by the session `org_id` (TRD §6).
- [DEFERRED] Row-Level Security policies keyed on a per-transaction `app.org_id` setting.

## 7. Branch isolation in the schema [REQUIRED]

- Branch of an employee: `employee_branches` (primary for approvals).
- Branch of a rostered/worked day: `daily_records.location_id` (shift segments inherit it).
- Branch of a lock: `period_locks.location_id`.
- Branch of an audit event: `audit_logs.location_id` (required for operational events).
- Branch of a submission / leave request: derived from the employee's primary branch at query time. [PROPOSED] Snapshot `location_id` on submission/leave at creation so history does not move when an employee transfers.

## 8. Soft deletion, deactivation, lifecycle and auditability

| Entity | Lifecycle | Hard delete? |
|---|---|---|
| Organisation | `active → suspended → closed`; data retained per retention policy | Only by a documented offboarding procedure after the retention period |
| Branch | `is_active` toggle | No, if any history |
| User | `is_active`; memberships `removed` | No while referenced by audit/approvals |
| Membership | `status` | No |
| Role assignment | `revoked` | No |
| Employee | `is_active`, `deleted_at`; delete blocked if approved/locked payroll exists ([CURRENT]) | [CURRENT] hard delete cascades daily records when allowed — [PROPOSED] change to soft delete only |
| Daily records / segments | edited in place; [PROPOSED] audit before/after on edits | Only via roster "clear" for unapproved periods |
| Submissions, leave | status transitions | No |
| Audit logs | append-only | No |
| Sessions, tokens, codes, challenges | expire; [PROPOSED] purge job after 90 days | Yes (security artefacts) |

Retention [REQUIRED, legal confirmation pending]: time and pay records kept ≥ 7 years (Fair Work). No automated deletion of operational records is built until confirmed.

---

## 9. Migration strategy [PROPOSED]

### 9.1 Principles

1. **Expand → migrate/backfill → dual-read/verify → switch → contract.** Contract (drops) happens in a later release after verification queries return clean.
2. Every migration has a working `down`, except contract migrations, which require a pre-migration backup and explicit approval.
3. Migrations are tested from (a) an empty DB and (b) a snapshot of the current production schema with legacy data (including rows with `'Company Admin'`, `'Manager'` org roles, branch `'admin'`/`'manager'` rows, branchless orgs, employees without `location_id`).
4. No production data is deleted without a verification query showing it is unreferenced and a backup.

### 9.2 Sequence

| Step | Migration | Reversible |
|---|---|---|
| M0 | Fix D-8 (scheduled in IMPLEMENTATION-PLAN Phase 1). Migrations 483 + 500 are committed and run on every boot. Preferred fix is code-only: `memberships.ts` stops writing canonical values into the legacy role columns, which keep legacy values (`'Company Admin'`/`'Manager'`/`'Employee'`; `admin`/`manager`/`employee`) until `role_assignments` exists. Alternative: widen both CHECKs to accept the canonical values too. | yes |
| M1 | Create `role_assignments`, `employee_branches`, `invitations`, `invitation_assignments`, `platform_operators`; add `users.full_name`; add composite UNIQUEs; change `users.org_id` FK to SET NULL; drop `employees UNIQUE(org_id, full_name)` (after the code check in §9.4) | yes |
| M1b | Add columns used by later steps and flows: `organisation_members.status` (backfill from `is_active`), `organisations.status`, `organisations.entry_code` (generated per org), `locations.is_primary`, `audit_logs.category` (default `operational`), `sessions.audience`, `timesheet_submissions.submitted_by/approved_by/approved_at`, `leave_requests.cancelled_at/requested_by`, `daily_records.location_id` (nullable at first, backfilled from the employee's branch), `reset_tokens.used_at`, `invitation_tokens.used_at`, `two_factor_codes.purpose`, `users.password_set_at`, `users.updated_at/last_login_at` | yes |
| M2 | Ensure every org has ≥ 1 branch: create `"Main Branch"` (`is_primary=true`) for orgs without active locations; mark the earliest branch primary elsewhere | yes (delete created rows by marker column `created_by_migration`) |
| M3 | Backfill `employee_branches` from `employees.location_id`; employees with NULL → org primary branch | yes |
| M4 | Backfill `role_assignments` (§9.3) with `source='migration'` | yes (delete `source='migration'`) |
| M5 | Insert `platform_operators` rows for users with `users.role='Platform Admin'`; **do not** create tenant assignments for them | yes |
| M6 | `period_locks` with `location_id`, copying org-wide rows per branch. **Deployed together with the `locks.ts` rewrite (IMPLEMENTATION-PLAN Phase 5)**, because the current upsert targets `ON CONFLICT (org_id, start_date)` | yes |
| M7 | Hash-only tokens: pending invites whose tokens were ever stored or returned in plaintext (`org_invitation_tokens`, `location_invitations`, and employee invites whose links were returned to callers) are **expired, not migrated**. Owners/Platform Admins re-send them through `invitations`. Plaintext columns are nulled in K1 | partially (plaintext cannot be restored after contract) |
| M8 | Normalise `shift_segments.segment_type 'Normal' → 'WORK'` (log counts first); add CHECKs `NOT VALID` then `VALIDATE` | yes (reverse map recorded) |
| M9 | Add status/type CHECKs on submissions/leave (`NOT VALID` → `VALIDATE` after cleaning) | yes |
| — | **Dual-write from M4 onward:** every legacy write path (`memberships.ts`, branch/employee/org invites, `employees.ts`, `claim-invite`, member removal) also writes/revokes the matching `role_assignments` row, so the new table never goes stale before the switch. Then the application switches to reading `role_assignments` (dual-read comparison logging in staging first) | code rollback |
| K1 (contract) | Drop `users.role`, `users.org_id`, `organisations.slug`/`portal_slug` (after transition window), `organisation_members.role`, `organisations.owner_user_id`, `location_memberships`, `location_invitations`, `invitation_tokens`, `org_invitation_tokens`, plaintext token columns, `audit_logs.user_id`/`timestamp` (or keep as views), `is_public_searchable`, lock password hashes | **no** — backup + sign-off |

### 9.3 Role backfill mapping (access-preserving)

| Legacy source | Condition | New assignment(s) |
|---|---|---|
| `organisations.owner_user_id` | set | `ORG_OWNER` (organisation) |
| `organisation_members.role` in (`'Company Admin'`, `'Owner'`, `OWNER`) | | `ORG_OWNER` |
| `organisation_members.role` in (`'Admin'`, `ORG_ADMIN`) | | `ORG_ADMIN` |
| `organisation_members.role` in (`'Manager'`, `ORG_MANAGER`) | user has ≥ 1 branch membership | **no org assignment** (branch assignments below carry their access) |
| `organisation_members.role` in (`'Manager'`, `ORG_MANAGER`) | user has **no** branch membership | `BRANCH_MANAGER` at the org's primary branch **only if** the org was branchless before M2 (preserves today's fallback access); otherwise flagged for manual review, no assignment |
| `organisation_members.role` = `'Platform Admin'` | | none (membership row marked `removed`) |
| `location_memberships.role` in (`'manager'`, `BRANCH_MANAGER`) | active | `BRANCH_MANAGER` at that branch |
| `location_memberships.role` in (`'admin'`, `BRANCH_ADMIN`) | active | `BRANCH_ADMIN` **and** `BRANCH_MANAGER` at that branch (preserves current approve/lock ability; owners can remove the manager half afterwards) |
| `location_memberships.role` in (`'employee'`, `EMPLOYEE`) | active | (covered by self assignment below) |
| `employees.user_id` | active employee | `EMPLOYEE` (self, that employee) |
| `'Company Admin'` with no branch membership in an org that was branchless | | `ORG_OWNER` **plus** `BRANCH_MANAGER` at the new Main Branch (preserves today's fallback operational access) — **flagged** |

**Owner-held operational access is flagged, not silently kept.** Every provisioned owner today holds branch `admin` (from `POST /api/platform/claim-invite`), which maps to operational roles. The migration keeps these assignments (`source='migration'`) so nobody loses access mid-release. Every operational assignment held by an `ORG_OWNER`/`ORG_ADMIN` is listed in the migration report. After deploy, each Owner sees a one-time "Review your access" prompt to keep it (recorded as `ASSIGNMENT_SELF_GRANTED` with reason "confirmed after migration") or remove it. This brings existing data into line with PRD §5.2.

The migration writes a report (counts per mapping row, plus every "manual review" user) to `audit_logs` (`category='administration'`, `action='HIERARCHY_MIGRATION'`) and to deploy logs.

### 9.4 Legacy / redundant / dangerous items

| Item | Classification | Action |
|---|---|---|
| `users.role` | Dangerous (global role, source of D-5/D-9) | Stop reading → drop (K1) |
| `users.org_id` (CASCADE) | Dangerous | FK → SET NULL (M1) → drop (K1) |
| `organisation_members.role` + CHECK | Legacy, conflicting | Stop writing canonical values (M0) → drop (K1) |
| `organisations.owner_user_id` | Duplicate | Keep in sync → drop (K1) |
| `location_memberships` | Superseded | Read-only after switch → drop (K1) |
| `org_invitation_tokens.token`, `location_invitations.token` | Dangerous (plaintext) | Migrate (M7) → drop (K1) |
| `invitation_tokens`, `org_invitation_tokens`, `location_invitations` | Superseded | Keep until outstanding invites expire → drop (K1) |
| `audit_logs.user_id`, `audit_logs.timestamp` | Duplicate | Stop writing → keep or drop (K1) |
| `employees UNIQUE (org_id, full_name)` | Wrong constraint | Drop (M1) after verifying no code path depends on it |
| `organisations.is_public_searchable` | Unused after finder removal | Drop (K1) |
| `organisations.slug`, `organisations.portal_slug` | Public identifiers replaced by `entry_code` | Redirect window → drop (K1) |
| `users.is_active` (global) | Dangerous (cross-org lockout) | Repurpose as `login_disabled`; per-org access via membership status |
| `roster_lock_password_hash`, `timesheet_lock_password_hash` | Shared secrets | Retain until re-auth replaces them → drop (K1) |
| `login_verification_challenges.role` | Dangerous (carries authority) | Stop reading/writing → drop (K1) |
| `sessions.location_id` | Retain (UI preference) | Keep |
| `xero_connections` | Deferred feature | Retain unchanged |
| `backend/.db_snapshot.json`, `database.sqlite*` in `legacy-backend/` | Dev/legacy artefacts containing hashes/user data | Git-ignored or legacy; not production. Do not commit. |

### 9.5 Rollback

- Before the application switches to `role_assignments`, rollback = redeploy previous build (legacy columns untouched).
- After switch but before contract, legacy columns are still maintained by a sync step for one release, so rollback remains possible.
- After contract, rollback = restore from backup (documented, rehearsed in staging).
