# SimpleHours — Database Audit (2026-09-22)

Read-only audit of the schema built by migrations `…478` → `…601` (inspected on a freshly migrated
PostgreSQL 16 database) and of every reference in `backend/src` and `frontend/src`.
Production data was **not** inspected (no production credentials were read).

Legend: **KEEP** · **KEEP BUT REVIEW** · **SAFE TO REMOVE** · **MIGRATION/ARCHIVE ONLY** · **UNKNOWN**

## 1. Tables

| Table | Class | Notes |
|---|---|---|
| organisations | KEEP | Tenant; `owner_user_id` is the single owner authority. |
| users | KEEP | Accounts (Owner / Branch Admin). |
| locations | KEEP | Branches. |
| branch_admins | KEEP | The only Branch Admin authority. |
| branch_admin_invitations, branch_admin_invitation_branches | KEEP | Hash-only, expiring invitations. |
| organisation_signups | KEEP | Hash-only sign-up links. |
| employees | KEEP | Worker records (no login). |
| roster_templates | KEEP | Default fortnight roster per worker. |
| daily_records, shift_segments | KEEP | One day per worker; its rostered and worked time. |
| fortnight_locks | KEEP | Per-branch period locks. |
| timesheet_submissions | KEEP | Draft / Approved per worker per period. |
| public_holidays | KEEP | Used by pay classification. |
| audit_logs | KEEP | Owner-visible audit trail. |
| sessions, login_history, login_verification_challenges, two_factor_codes, reset_tokens | KEEP | Authentication and session security. |
| organisation_announcements, announcement_reactions, announcement_replies | KEEP | Team chat. |
| **xero_connections** | **SAFE TO REMOVE** | Deferred feature: no UI, no real token exchange, only a mock connect. The routes (`/api/xero/*`), `xeroService`, the `integrations.manage` permission and `ENCRYPTION_KEY` exist only for it. Rows can only be mock connections. |
| legacy_archive | MIGRATION/ARCHIVE ONLY | See §4. |
| pgmigrations | KEEP | node-pg-migrate history. |

## 2. Columns

| Column | Class | Reason |
|---|---|---|
| organisations.display_name | **SAFE TO REMOVE** (merge) | Duplicate of `name`: sign-up sets both to the same value; every read is `COALESCE(display_name, name)`. Merge into `name`. |
| organisations.logo_url | **SAFE TO REMOVE** | Read by the sign-in page but no code path ever writes it. |
| employees.deleted_at | **SAFE TO REMOVE** (merge) | Duplicate of `is_active`: deactivate sets both, reactivate clears both, delete removes the row. It also made deactivated workers show as "Deleted". Backfill `is_active = false`. |
| audit_logs.timestamp | **SAFE TO REMOVE** | Duplicate of `created_at` (both `NOW()` at insert). |
| sessions.token_hash | **SAFE TO REMOVE** | A random value generated at login and never read; sessions are identified by `id`. |
| organisation_announcements.is_system, announcement_type | **SAFE TO REMOVE** | Only written by the removed roster-publishing feature. Existing posts stay as ordinary posts. |
| employees UNIQUE (org_id, full_name) | KEEP BUT REVIEW | Blocks two workers with the same name in one organisation. Product decision. |
| daily_records.has_actuals | KEEP BUT REVIEW | Denormalised "day has worked time"; maintained by every write path. |
| sessions/login_history/login_verification_challenges.user_agent, ip, device, location | KEEP BUT REVIEW | Written for security forensics; only some are read. |
| branch_admins.assigned_by, branch_admin_invitations.invited_by / accepted_user_id | KEEP | Provenance for audits. |
| organisations.roster_lock_password_hash, timesheet_lock_password_hash | KEEP BUT REVIEW | Shared lock passwords (in use). A caller's own password also works. |
| users.is_active | KEEP BUT REVIEW | Global sign-in switch; no endpoint changes it today. |

Old role / employee-login / leave / submit-review-reject / publishing / Platform Admin / pg-mem structures:
**already removed** by `…601` (tables `organisation_members`, `location_memberships`, `location_invitations`,
`invitation_tokens`, `org_invitation_tokens`, `leave_requests`; columns `users.role`, `users.org_id`,
`employees.user_id`, `sessions.location_id`, `login_verification_challenges.role`, `organisations.slug`,
`timesheet_entry_mode`, `allow_employee_chat`, `is_public_searchable`, `fortnight_locks.is_published`,
`timesheet_submissions.submitted_at/rejection_reason`, `audit_logs.scope/user_id/snapshot`; `services/db.ts` pg-mem).
None remain.

## 3. Indexes

| Index | Class | Reason |
|---|---|---|
| idx_organisations_portal_slug | **SAFE TO REMOVE** | Duplicates `organisations_portal_slug_key`. |
| idx_login_challenges_token_hash | **SAFE TO REMOVE** | Duplicates `login_verification_challenges_token_hash_key`. |
| idx_locations_org | **SAFE TO REMOVE** | Covered by `locations_org_id_name_key` and `locations_org_id_id_key` (both lead with `org_id`). |
| idx_sessions_token_hash, sessions_token_hash_key | **SAFE TO REMOVE** | Go with `sessions.token_hash`. |
| idx_sessions_active | **SAFE TO REMOVE** | No query filters on `(is_active, last_active_at)`. |
| idx_audit_logs_target_user, idx_audit_logs_actor_org | **SAFE TO REMOVE** | No query filters by target or actor. |
| all others | KEEP | Used by list/report/auth queries. |

## 4. `legacy_archive`

Created by `…601` so that dropping the old structures destroyed nothing. One JSON row per dropped row (secrets excluded).

| source | Contents | Needed for | Sensitive |
|---|---|---|---|
| organisation_members, location_memberships, users.role_org, employees.user_id, organisations.settings, fortnight_locks.is_published | Old roles, links, settings | Rollback of `…601` | emails + old roles |
| leave_requests | Leave requests incl. free-text **reason** | Rollback and **employment-record retention** (Fair Work, 7 years pending legal advice) | **yes — reasons may contain health information** |
| timesheet_submissions.status | Old statuses, submitted times, **rejection reasons** | History of the old workflow | low |
| shift_segments.type, roster_templates.type | Original non-standard segment labels | Traceability of normalisation | no |
| location_invitations, org_invitation_tokens, invitation_tokens | Invitee emails, roles, dates (tokens NOT copied) | **Nothing** (rollback does not restore invitations; the invitations were expired) | emails of people who may never have accepted |

Decision: keep the table (rollback + retention). Two follow-ups need an owner decision (§6).

## 5. Actions taken (migration `…602_schema_cleanup`)

Everything marked SAFE TO REMOVE above, each value archived to `legacy_archive` first (except random/secret
values: session token hashes, Xero tokens), with a working `down`. Code, tests and docs updated in the same change.
`…601`'s `down` also now restores `leave_requests` from the archive so a rollback is faithful.

## 6. Needs a decision (not changed)

1. **Invitation rows in `legacy_archive`** serve no purpose and hold invitee emails — delete them?
2. **Leave-request reasons in `legacy_archive`** — keep for the retention period, or export and drop?
3. **Production data** was not inspected: the old bootstrap could have created a "Demo Organisation", a
   `Platform Admin` user and demo accounts (now access-less). Check before real data.
4. **Two Railway Postgres services** exist; which one is live is unverified.
5. `employees UNIQUE (org_id, full_name)` — keep or allow duplicate names?
6. Local `backend/.db_snapshot.json` (git-ignored, from the removed in-memory mode, contains password hashes) — delete it.
