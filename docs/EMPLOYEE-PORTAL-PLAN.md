# Employee Timesheets, Breaks, Instant Settings & Leave Merging

*Implementation plan, executed 2026-09-23 on `refactor/two-role-model`. Kept here as a durable
record of what was built and why — see `docs/ROLE-SIMPLIFICATION-PLAN.md` for the two-role model
this deliberately builds on top of, without weakening it (`ROLE_PERMISSIONS.EMPLOYEE` is an empty
permission set).*

## Context

This branch (`refactor/two-role-model`) deleted the entire Employee role, employee login/portal, and leave-request/approval workflow earlier the same day (commits `7b63a36`, `48fa391`, `b99f41c`), moving to a two-role model (OWNER, BRANCH_ADMIN only — admins enter all hours directly). This is documented in `docs/ROLE-SIMPLIFICATION-PLAN.md`, and guarded by `backend/tests/security/role_removal.test.ts`, which fails on purpose if `'EMPLOYEE'` reappears anywhere in the source.

The user confirmed they wanted this deliberately reversed: real employee accounts and a portal, a revived leave request/approval workflow (itself gated by a setting), plus new roster break controls, a leave/roster auto-merge engine, and a consistent colour system — all built on top of the current two-role architecture rather than by resurrecting the old (now-incompatible) deleted code verbatim.

**Decisions locked in during planning:**
1. Full employee accounts + portal (login, Schedule/Timesheet/History/Leave pages, self-submit).
2. Leave requests/approval revived, gated by its own new setting (`leave_requests_require_approval`, default `true`).
3. Colours map onto the *existing* three timesheet statuses only (Draft/Approved/Locked) — no new Submitted/Rejected states.
4. The three new workforce settings (`employees_can_submit_timesheets`, `automatically_merge_leave_with_roster`, `leave_requests_require_approval`) are editable by **Owner and Branch Admin** — `PUT /organisation/settings`'s previously Owner-only gate was split for just these three fields.
5. Leave request approval/rejection is available to **Branch Admins for workers in their own assigned branches**, not Owner-only.

## The key architectural insight

`backend/src/services/policy.ts`'s `ROLE_PERMISSIONS.EMPLOYEE` is an empty `Set`, so `hasPermission()` is false for an employee against *every* existing `Permission` — `requirePermission`, `assertBranchAccess`, `loadWorker`, `resolveBranchFilter` all reject an employee automatically, on **every existing route, with zero changes** to `records.ts`, `roster.ts`, `submissions.ts`, `employees.ts`, `reports.ts`, `locks.ts`, `dashboard.ts`, `audit.ts`, `branchAdmins.ts`, `locations.ts`, `holidays.ts`. New employee-only capability is added as new routes checked against `ctx.role === 'EMPLOYEE'` directly — never as new `Permission` values. Proven by 46 negative rows in `authorisation_matrix.test.ts`.

## What was built

1. **Employee accounts** (`backend/src/routes/employeeAccounts.ts`, `policy.ts`, `middleware/auth.ts`): invite/accept/resend/revoke/reset-password-link, modeled on `branchAdmins.ts`. `employees.user_id` revived with a partial unique index (one login per worker). `resolveAccess()` resolves `role: 'EMPLOYEE'` for a linked, active worker.
2. **Employee portal** (`backend/src/routes/portal.ts`, `frontend/src/pages/Employee{Schedule,Timesheet,History,Leave}.tsx`): schedule/timesheet/history reads and self-submit, always scoped to `req.auth.employeeId` — no route ever accepts a client-supplied employee id. Employee-only nav in `Layout.tsx`, route guards in `App.tsx`, instant-refresh plumbing (focus/visibilitychange/60s interval) in `useAccess.tsx` so a setting change reaches an already-open tab without reload.
3. **Break override** (`shift_segments.has_break`, `roster_templates.has_break`): per-shift opt-out of the org's unpaid-break rule, threaded through `segments.ts`'s `computeDayHours` and its frontend mirror in `day.ts`. Bulk "Apply Break" / "Apply Break to All Days" dialogs (`ApplyBreakDialog.tsx`) call `POST /records/apply-break` and `POST /employees/:id/templates/apply-break`.
4. **Leave requests** (`leave_requests` table, `backend/src/services/leaveRequests.ts`, `backend/src/routes/leaveRequests.ts`, `portal.ts`'s `/leave-requests` routes): whole-day and partial-day requests, request-level overlap rejection, Branch-Admin-scoped review, and materialization through the shared `writeDayRecord` pipeline (retyping existing WORK entries to the leave type, or an hours-only fallback when nothing is rostered).
5. **Leave-merge engine** (`segments.ts`'s `mergeLeaveIntoRoster`, gated by `automatically_merge_leave_with_roster`): splits a WORK entry into surviving sub-intervals around any leave entries it overlaps — covers leave at the start/middle/end of a shift, a leave period covering the whole shift, and multiple leave periods in one shift, with one algorithm. Leave-vs-leave overlaps still reject via the existing `assertNoOverlap`.
6. **Colour system** (`DayBox.tsx`'s `TYPE_HUE`, `WEEKEND_CLASS`, `PUBLIC_HOLIDAY_CLASS`/`PublicHolidayBadge`, `STATUS_VARIANT`): one shared source for leave-type colours (already existed), weekend tinting (de-duplicated between Roster and TimesheetReview), a first-ever visual treatment for public holidays in the grids, and one Draft/Approved/Locked badge mapping shared by Reports and the Dashboard (previously disagreed on Locked's colour).

**Shared refactor**: the transaction body of `POST /records` was extracted into `segments.ts`'s `writeDayRecord()` — the single write path now shared by the admin route, employee self-submit, leave-request materialization, and the break bulk-apply endpoint, instead of four hand-rolled copies of the same delete+reinsert loop.

## Known, deliberate scope limits

- The roster/timesheet day editor's **client-side** overlap validation (`day.ts`'s `checkLines`) has no frontend mirror of the merge engine — an admin who manually types an overlapping WORK+leave day directly into the editor still sees a client-side `OVERLAP` warning even when `automatically_merge_leave_with_roster` is on and the server would accept it. The merge engine is fully correct and tested via the leave-request/approval workflow (the primary path); only this secondary, direct-entry path has the gap.
- The default-roster **template** editor (`Employees.tsx`) got a per-line break checkbox but not its own bulk "Apply Break" dialog (the backend endpoint exists and is tested; only the template-specific bulk UI was left out, in favour of the fortnight roster/timesheet editor's dialog which covers the same need day-to-day).

## Test coverage

575 backend tests (up from 443 before this work), across new files `employee_accounts.test.ts`, `portal.test.ts`, `workforce_settings.test.ts`, `break_override.test.ts`, `leave_requests.test.ts`, plus extensions to `segments.test.ts`, `authorisation_matrix.test.ts`, `role_removal.test.ts`, `route_inventory.test.ts`, `critical_hotfixes.test.ts`, and `migrations.test.ts`. Both backend and frontend production builds verified clean, and every phase was checked against a real running preview (seeded Postgres + dev servers), not just unit tests — this is how the `PUT /organisation/settings` gap (see below) was actually caught.

A real gap was caught mid-build, not by review: `PUT /organisation/settings` still had its old Owner-only gate when the workforce settings were first added, so a Branch Admin (or a test toggle) silently no-opped instead of erroring. Fixed and covered by `workforce_settings.test.ts`. Worth remembering for the next schema/permission change in this codebase: a new role needing *partial* access to an existing admin-only route is easy to miss until it's actually exercised end-to-end.
