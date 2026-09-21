# SimpleHours — Application Flow Specification

| | |
|---|---|
| Status | Draft for review — authoritative once approved |
| Last audited against code | 2026-09-21, re-baselined on `main` @ `7fa3094` |
| Labels | **[CURRENT] [REQUIRED] [PROPOSED] [DEFERRED]** — see [PRD §0.1](./PRD.md#01-status-labels) |
| Companion documents | [PRD](./PRD.md) · [TRD](./TRD.md) · [UI/UX](./UI-UX-DESIGN.md) · [Backend Schema](./BACKEND-SCHEMA.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md) |

Each flow uses the same structure:

- **Start** — who, in what state.
- **Steps** — user action → backend action → authorisation check → result.
- **Failures** — what can go wrong and what the user sees.
- **Current vs target** — where today's behaviour differs.

"AuthZ" always means the server-side chain from [TRD §5.2](./TRD.md#52-required-model-required): session → membership → assignments → scope (resource-derived) → permission → relationship. Standard failures that apply to every authenticated step are not repeated:

| Failure | Response | UI |
|---|---|---|
| No/invalid token, 2FA-pending token | 401 | Redirect to organisation login |
| Session idle > 15 min / > 24 h / revoked / user deactivated | 401 with `SESSION_EXPIRED` / `SESSION_REVOKED` / `USER_DEACTIVATED` | Redirect to org login with reason message |
| Membership not active | 401 (session invalidated) | Org login with "Your access to this organisation has ended" |
| Resource in another organisation | 404 | Not found state |
| Permission/scope denied | 403 | "You don't have access to this" state |
| Server error | 500, generic message | "Something went wrong. Try again." — no technical detail |

---

## 1. Public website flow

**Start:** anonymous visitor at `/`.

| Step | Detail |
|---|---|
| 1 | Visitor browses Overview, Features, Pricing. [CURRENT] |
| 2 | No sign-in search. A small "Sign in" link explains: "Use the sign-in link your organisation gave you" and offers "Email me my sign-in link". [PROPOSED] |
| 3 | "Email me my sign-in link": visitor enters email → `POST /api/auth/login-links` → server looks up active memberships for that email and emails the private `/o/<entry_code>` links → **same response regardless of whether the email exists**. [PROPOSED] Rate-limited per IP and email. |

**Failures:** rate limit → "Too many requests, try again in a few minutes."

**Current vs target:** [CURRENT] `/portal-access` accepts a typed workspace slug and navigates to `/login/<slug>`; recent workspace is cached in `localStorage`. Hidden platform gate via Cmd/Ctrl+Shift+P and 5-click easter eggs. [PROPOSED] Remove `/portal-access` slug entry and the easter eggs (platform gate stays at an unlinked URL; obscurity is not relied on for security).

---

## 2. Organisation login flow

**Start:** user opens their organisation's private link `/o/<entry_code>` [PROPOSED]. [CURRENT] `/login/<slug>`, where the slug may be the human slug, the `portal_slug` or the UUID.

| Step | User action | Backend action | AuthZ | Result |
|---|---|---|---|---|
| 1 | Opens URL | None. The page is static and generic ("Sign in to SimpleHours"). No organisation data is fetched before authentication. | public | Generic sign-in page |
| 2 | Enters email + password | `POST /api/auth/login {email, password, entry_code}` | Verify password (bcrypt); resolve the org **server-side** as the org with that `entry_code` **and** an active membership for this user; verify org and membership active | — |
| 3a | — | Suspicious login (new device + location) → create challenge, email link/code | challenge bound to user + org | "Check your email to verify this sign-in" (§25.3) |
| 3b | — | 2FA enabled → issue 10-min `2fa_pending` token, email code | temp token cannot call APIs | Code entry screen |
| 4 | — | Create session (`sessions`, `audience='tenant'`, `org_id`), issue JWT `{sub, sid, aud:'tenant'}` [PROPOSED; CURRENT claims `id, email, organisation_id, location_id, role, session_id`] | — | — |
| 5 | — | Frontend calls `GET /api/auth/me` → organisation name/branding, assignments, capabilities | membership re-checked | Organisation shown for the first time; landing page chosen by capabilities (§2.1) |

### 2.1 Landing page resolution [PROPOSED]

| User holds | Lands on |
|---|---|
| Only `EMPLOYEE` | My Schedule — Today |
| Any `BRANCH_MANAGER`/`BRANCH_ADMIN` (with or without `EMPLOYEE`) | Branch Dashboard (their branches) |
| Only `PAYROLL` | Payroll — current pay period |
| Only `ORG_OWNER`/`ORG_ADMIN` | Organisation Overview |
| Owner/Admin **and** branch roles | Branch Dashboard, with Organisation in the navigation |
| No assignments (membership only) | "Your account has no access yet — contact your administrator" |

[CURRENT] OrgLogin redirects Employee → `/portal`, Platform Admin → `/platform`, everyone else → `/roster`; generic Login redirects by legacy role.

**Failures:**

| Case | Target response | Current |
|---|---|---|
| Unknown or rotated entry code | Indistinguishable from a wrong password (same message, same timing) | "Workplace Not Found" page before any credentials are entered (reveals which slugs exist) |
| Wrong password / unknown email / **no membership** / membership removed | Same message: "Email or password is incorrect" (401) | No membership returns distinct `NO_ORGANISATION_ACCESS` (403) — credential oracle |
| Organisation or membership suspended (credentials correct) | "Your access is currently unavailable. Contact your administrator." | 403 "deactivated" |
| Already signed in to another organisation | Offer "Sign out of <Org A> and continue" which calls `POST /api/auth/logout` first | 409 `SESSION_ORG_CONFLICT`; UI clears storage only (session not revoked) |
| Platform Admin credentials | Same generic error | [CURRENT — defect D-9] accepted, gets all permissions in that org |
| Rate limit (5 fails / 15 min) | 429 "Too many attempts" | [CURRENT] |

**Security assumptions:** the URL grants nothing. The entry code only selects which of the user's memberships to use, and reveals nothing before authentication. Membership is verified again on every request. The Owner can rotate the code at any time (§25.6).

---

## 3. Invitation flow (unified) [PROPOSED]

Replaces four current mechanisms (PRD §7.9). Current behaviour noted per variant.

**Start:** inviter with the right to grant the intended assignments.

| Step | User action | Backend action | AuthZ | Result |
|---|---|---|---|---|
| 1 | Inviter enters email and chooses assignments (e.g. `BRANCH_MANAGER` @ Richmond, or "Employee at Richmond") | `POST /api/invitations` | Inviter holds `ORGANISATION_MANAGE_USERS` or `BRANCH_MANAGE_USERS` for each target scope; every requested role is allowed by the grant table (TRD §5.7); role keys from allow-list | `invitations` row (hashed token, 7-day expiry) + `invitation_assignments`; email sent; audit `INVITATION_CREATED` |
| 2 | Invitee opens link `/invite?token=…` | `GET /api/invitations/verify?token=` → hash lookup | token unexpired, unused, unrevoked | Shows org name, what access is being granted, whether an account exists for this email |
| 3a | New user: sets name + password | `POST /api/invitations/accept` | token valid; email = invitation email; password policy; inviter's authority re-checked | User created; membership `active`; assignments granted (`source='invitation'`). For an Employee invite: the employee record is linked (or created with the invited primary branch), plus `employee_branches` and the self assignment. Token consumed; audit. All in one transaction |
| 3b | Existing user: signs in with existing password | same | authenticated user's email **must equal** invitation email; inviter's authority re-checked | Membership activated (if new); assignments added; token consumed |
| 4 | — | Create tenant session | — | Landing page (§2.1) |

**Failures:** expired/used/revoked → "This invitation is no longer valid. Ask your administrator to send a new one." · email mismatch → "This invitation was sent to a different email address." · inviter lost authority → "This invitation can no longer be accepted." · email delivery failure → invite remains, inviter sees "Email not delivered — resend".

**Current variants [CURRENT]:**

| Variant | Behaviour today | Gap |
|---|---|---|
| Platform → new organisation (`/setup-org?token=`) | Plaintext token, **no expiry**, email-bound, creates org + `'Company Admin'` user + primary branch + `admin` branch membership | Plaintext/no expiry (D-6); silent branch admin grant |
| Employee account (`/accept-invite?token=`) | Hashed token (lookup also accepts raw, D-7), 7 days, resend rotates token; user row pre-created inactive with `'PENDING_SETUP'` password; **invite link returned to the inviting manager** | D-6, D-7 |
| Branch invite (`/accept-location-invite?token=`) | Hash-only lookup, 7 days (plaintext column still written). Since `7fa3094`, an existing account must be signed in as the invited email, and no token is issued on acceptance. Creates org `'Manager'`/`'Employee'` row + branch membership | D-6 (plaintext column), org-wide `'Manager'` side effect (D-3) |
| Org member invite (`POST /api/organisation/members/invite`) | Creates user with `'PENDING_SETUP'` and grants org role immediately; **no email, no token**; user cannot set a password through it | Unusable for new users; grants before acceptance |

---

## 4. First-time user flow

**Start:** invitee has accepted an invitation (§3) and has a session.

1. Landing page per §2.1.
2. [CURRENT] Onboarding tutorial auto-opens once (`simplehours_tutorial_seen`). [PROPOSED] Tutorial content depends on capabilities (employee tour vs manager tour); "Take the tour" in the help modal must work (currently fires the wrong event name).
3. Employee with no linked employee record: [CURRENT] "No Staff Profile Linked" card. [PROPOSED] Cannot occur for invitation-created employees (invite links `employee_id`); remains as a safe fallback message.
4. Prompt to enable 2FA for management roles [PROPOSED]; organisation-enforced 2FA [DEFERRED].

---

## 5. Organisation provisioning and Owner first-run [CURRENT, with PROPOSED changes]

**Start:** Platform Admin in the platform console.

| Step | Actor | Backend | AuthZ | Result |
|---|---|---|---|---|
| 1 | Platform Admin enters owner email → "Send invite" | `POST /api/platform/send-invite` → invitation `kind='organisation'` | platform session (`audience='platform'`), user in `platform_operators` | Email sent; audit `category='platform'` |
| 2 | Invitee opens `/setup-org?token=` | verify token (hash, expiry, unused) | public | Wizard with email pre-filled |
| 3 | Completes wizard: org name, password, primary branch (name/address/timezone), entry mode, optional first manager invite, break rules | `POST /api/platform/claim-invite` in one transaction | token valid; submitted email = invited email; password policy | Organisation, primary branch, user, membership, **`ORG_OWNER` assignment**; token consumed |
| 4 | Wizard question: "Will you also run <branch> day-to-day?" [PROPOSED] | if yes: `BRANCH_MANAGER` @ primary branch (`source='provisioning'`) | — | Owner has operational access only if chosen |
| 5 | Redirect to `/o/<entry_code>` (the owner also receives the link by email) | — | — | Owner signs in |

**Failures:** invalid/expired token; email mismatch (403); organisation name taken (slug collision → suffix); password too weak (400).

[CURRENT — defect D-27] The optional "first manager invite" in step 3 inserts a `location_invitations` row without the required `token_hash`. On PostgreSQL the insert fails, and the failure is swallowed.

**Current vs target:** [CURRENT] step 3 always grants branch `admin` (full operational access) and uses no password-strength check; step 4 does not exist; the platform console can display raw invite tokens ("Emergency Debug URLs").

---

## 6. Organisation Owner flow

**Start:** signed-in `ORG_OWNER`.

| Task | Backend | AuthZ | Notes |
|---|---|---|---|
| Edit organisation details, break rules, entry mode | `PUT /api/organisation/settings` | `ORGANISATION_UPDATE` | audit `administration` |
| Security: lock settings, rotate private login link | `POST /api/organisation/rotate-entry-code` [PROPOSED; CURRENT `regenerate-portal-url`] | `ORGANISATION_SECURITY` (Owner only) | Old link stops working immediately; audit `security` |
| Manage branches | `POST/PUT /api/locations`, deactivate/reactivate | `ORGANISATION_MANAGE_BRANCHES` | Deactivation revokes branch assignments' effect |
| Manage people and assignments | §24 | `ORGANISATION_MANAGE_USERS` | May grant `ORG_OWNER` |
| Transfer ownership [PROPOSED] | grant `ORG_OWNER` to another user, then optionally revoke own | Owner; cannot remove last owner | re-authentication required |
| Self-grant an operational role [PROPOSED] | `POST /api/assignments/self-grant {role_key, scope, reason, password}` | `ORG_OWNER` only; password re-check | audit `ASSIGNMENT_SELF_GRANTED` (`security`), visible in access list |
| View audit log (security & administration) | `GET /api/audit?category=security,administration` | `AUDIT_VIEW_ADMIN` | Operational events only where separately assigned |
| Organisation summary report | `GET /api/reports/org-summary?start_date=` [PROPOSED] | `REPORT_ORG_SUMMARY` | Aggregates per branch, **no per-employee lines** |
| Try to open a branch roster/timesheet without branch assignment | e.g. `GET /api/submissions?branch_id=X` | denied | 403; UI shows "You need a role at this branch" with, for Owners, a link to self-grant |

**Security assumption:** Owner authority is administrative; operational data requires an assignment (PRD §5.2).

---

## 7. Organisation Admin flow

Same as §6 except: cannot see/use `ORGANISATION_SECURITY` (including the private link), cannot grant/modify/remove `ORG_OWNER` or `ORG_ADMIN`, cannot transfer ownership, cannot self-grant. Attempts return 403 and are audited (`security`, action `ESCALATION_DENIED`) [PROPOSED].

---

## 8. Branch Manager flow

**Start:** user with `BRANCH_MANAGER` at one or more branches.

1. Lands on Branch Dashboard filtered to "All my branches" (or the single branch).
2. Daily loop: today's staff → roster for the fortnight (§14) → enter/fix hours → review timesheets (§16–18) → approve leave (§21) → lock period (§19) → branch report (§22).
3. Branch selector lists **only** assigned branches (from `/api/auth/me`). Choosing a branch sets a filter; every API call still authorises against each resource's branch.

**Failures:** requesting another branch's data by editing a URL or `branch_id` → 403 (list filter outside scope) / 404 (resource in other org) — never an empty 200 that hides tampering.

---

## 9. Branch Admin flow

As §8 but without timesheet review/approve/reject, leave approval, or **timesheet** lock/unlock. Roster lock and publish are allowed (`ROSTER_PUBLISH`). Approve buttons are not shown; if called directly, the API returns 403. Branch Admins may invite/assign the `EMPLOYEE` role for their own branch only; Branch Managers do not manage access (TRD §5.7).

---

## 10. Payroll flow

**Start:** user with `PAYROLL` (organisation- or branch-scoped).

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| 1 Select pay period | `GET /api/payroll/periods` [PROPOSED] | `PAYROLL_VIEW` | Periods with per-branch status: submitted/approved counts, locked? |
| 2 Review readiness | `GET /api/payroll/report?start_date=` | `PAYROLL_VIEW`; employees ∈ scope; data = approved (or locked) only; unapproved employees listed by name + status only | Classified hours, approved leave, exceptions |
| 3 Lock period | `POST /api/locks {location_id, start_date, timesheet_locked: true}` | `TIMESHEET_LOCK` at each branch | Locked; audit |
| 4 Export | `GET /api/payroll/export/csv|pdf` | `PAYROLL_EXPORT`; same scoping | File; audit `PAYROLL_EXPORTED` (period, branches, row count) |
| 5 Unlock (correction) | `POST /api/locks/unlock {location_id, start_date, reason}` | `TIMESHEET_UNLOCK`; reason required | Unlocked; audit with reason |

**Failures:** no approved data → empty state "No approved timesheets for this period yet"; branch outside scope → 403.

**Current:** [CURRENT] no Payroll role; payroll report at `/api/reports/payroll` available to any `REPORT_VIEW` holder, organisation-wide, includes unapproved data.

---

## 11. Employee flow

**Start:** user with only `EMPLOYEE` (self scope).

| Task | Backend | AuthZ | Current |
|---|---|---|---|
| Today / week / fortnight / month / history schedule | `GET /api/portal/my-timesheet?start_date=` (+ [PROPOSED] `/api/portal/my-schedule?from=&to=`) | self; roster shown only when the period is published for the branch | Today + fortnight exist; week/month [PROPOSED]; history is fake (D-15) |
| Team roster (published) | `GET /api/portal/team-roster` | self; limited to own branches [PROPOSED] | organisation-wide today |
| Enter hours | §15 | self; entry mode `employee`; period unlocked; not approved | [CURRENT] |
| Submit timesheet | §15 | self | [CURRENT] |
| Request / cancel leave | §20 | `LEAVE_REQUEST_SELF` | backend only; UI missing |
| Profile & security | `GET/PUT /api/auth/me/profile` [PROPOSED], 2FA, sessions | self | security [CURRENT] |

Employees never receive management navigation or data. Direct calls to management endpoints → 403.

---

## 12. Multi-branch user flow

**Start:** user with `BRANCH_MANAGER` at Richmond and Geelong (or mixed roles, e.g. Manager at Richmond, Admin at Geelong).

1. `/api/auth/me` returns `assignments` and per-branch capabilities.
2. Branch selector shows Richmond, Geelong, "All my branches".
3. In "All my branches", lists merge both branches; each row shows its branch; actions on a row are enabled according to **that row's branch** capabilities (e.g. Approve shown for Richmond rows, not for Geelong rows if only Admin there).
4. Server authorises each action by the resource's branch.

**Current vs target:** [CURRENT] one active branch per session via `POST /api/auth/select-location` (re-issues token, full page reload); several list endpoints pass if the permission is held in *any* branch and then return organisation-wide data (leave, reports). [PROPOSED] no active-branch security context (TRD §5.5).

---

## 13. Employee + Manager, same account (John)

**Start:** John — `EMPLOYEE` (self, primary branch Melbourne CBD) + `BRANCH_MANAGER` @ Richmond.

| Step | Behaviour | AuthZ |
|---|---|---|
| Login | One login at the org URL | — |
| Landing | Branch Dashboard (Richmond) with "My schedule" section/tab | capabilities |
| My timesheet | Enters and submits his own hours (Melbourne CBD shifts) | self scope |
| Richmond timesheets | Reviews/approves Richmond staff | `TIMESHEET_APPROVE` @ Richmond |
| Melbourne CBD staff | Not visible | no assignment at Melbourne CBD |
| Approve own timesheet | Not possible: own record is at Melbourne CBD (no approver role there); even if he were also Manager at Melbourne CBD, separation of duties blocks it | `resource.employee.user_id ≠ caller` |
| Richmond roster listing himself | Only if he is also rostered at Richmond (`employee_branches`) | roster scope |

**Failures:** self-approval attempt → 403 "You can't approve your own timesheet."

**Current:** [CURRENT] supported partially — one account, branch membership plus employee record — but the JWT role is a single string (e.g. `'Employee'`), so frontend route guards block management pages for such users; self-approval not blocked.

---

## 14. Roster creation flow

**Start:** `BRANCH_MANAGER`/`BRANCH_ADMIN` on Roster for a branch and fortnight.

| Step | User action | Backend | AuthZ | Result |
|---|---|---|---|---|
| 1 | Open roster | `GET /api/employees?branch_id=`, `GET /api/records?start_date=&branch_id=`, `GET /api/locks?branch_id=` | `ROSTER_VIEW` @ branch; employees ∈ branch | Grid of branch employees |
| 2 | Add/edit a shift | `POST /api/records` | `ROSTER_UPDATE` @ **employee's** branch; period `roster_locked=false`; submission not Approved | Saved; overlap rejected with clear message |
| 3 | Apply default templates (Auto-Roster) for selected days | `POST /api/roster/auto-roster {start_date, selected_days, branch_id}` | `ROSTER_CREATE` @ branch; skips employees with approved periods; **never overwrites actuals** | Shifts created |
| 4 | Edit employee's default template | `POST /api/employees/:id/templates` | `EMPLOYEE_MANAGE` @ employee's branch | Autosaved |
| 5 | Copy roster to actuals for selected days (Auto-Log) | `POST /api/roster/auto-log {start_date, selected_days, branch_id}` | `TIMESHEET_EDIT` @ branch; `timesheet_locked=false`; skips employees with approved periods | Actual times filled from roster (only where empty) |

**Failures:** roster locked → 409 `PERIOD_LOCKED` "The roster for this fortnight is locked"; overlap → 400; employee from another branch → 403.

**Current:** [CURRENT] steps exist; `POST /api/records` uses a legacy `'Manager'` role-string branch check (Company Admin/Owner skip it); auto-roster passes on any-branch permission and acts org-wide.

---

## 15. Timesheet submission flow

**Start:** employee (entry mode `employee`) or manager (entry mode `manager`), period unlocked.

| Step | User action | Backend | AuthZ | Result |
|---|---|---|---|---|
| 1 | Open My Timesheet | `GET /api/portal/my-timesheet?start_date=` | self | Days with rostered shifts and entered hours |
| 2 | Enter start/finish/break/notes for a day | `POST /api/portal/enter-hours` | self; mode `employee`; `timesheet_locked=false`; submission ∉ {Submitted?, Under Review, Approved} [PROPOSED: editing after submit returns it to Draft with confirmation] | Hours calculated (2 dp) |
| 3 | Submit fortnight | `POST /api/submissions/submit {start_date}` | self (or `TIMESHEET_SUBMIT` @ employee's branch on behalf, mode `manager`); all segments complete | Status `Submitted`; audit |

**Failures:** incomplete segments → 400 listing days; period locked → 409; wrong entry mode → 403 "Your organisation has managers enter hours"; already approved → 409.

**Current:** [CURRENT] as described; `requireTimesheetMode` middleware exists but is unused (mode enforced inline).

---

## 16. Timesheet review flow

**Start:** `BRANCH_MANAGER` on Timesheets for a period.

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| List | `GET /api/submissions?start_date=&branch_id=` | `TIMESHEET_VIEW`; rows only for employees in caller's permitted branches | Tabs: Ready to review, In review, Needs changes, Approved, Not submitted, All (vocabulary: UI-UX §6.3) |
| Open one | `GET /api/records?start_date=&employee_id=` | `TIMESHEET_VIEW` @ employee's branch | Day-by-day roster vs actual |
| Mark under review | `POST /api/submissions/review` | `TIMESHEET_REVIEW` @ employee's branch | `Under Review` |

**Current:** [CURRENT] list is correctly filtered to permitted branches; detail view fetches all records then filters client-side ([PROPOSED] server-side `employee_id` filter).

---

## 17. Approval flow

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| Approve one | `POST /api/submissions/approve {employee_id, start_date}` | `TIMESHEET_APPROVE` @ employee's branch; status ∈ {Submitted, Under Review}; caller ≠ employee's user; period not locked | `Approved`, `approved_by/at`; audit |
| Bulk approve | `POST /api/submissions/bulk-approve` | each item checked as above; any failure reported per item | Approved set; audit per item |

**Failures:** wrong status → 409; other branch → 403; self → 403; locked → 409.

**Current:** [CURRENT] per-employee branch check exists; self-approval not blocked, and bulk-approve silently skips unauthorised rows (D-22).

---

## 18. Rejection flow

`POST /api/submissions/reject {employee_id, start_date, reason}` — AuthZ as approval; reason required (400 if missing). Result: `Rejected`, reason visible to employee as "Needs changes: <reason>"; employee edits and resubmits (§15). [CURRENT] exists. [DEFERRED] email notification to employee.

---

## 19. Locking flow

**Start:** a user with the permission named in each row, for a branch and period: roster rows need `BRANCH_MANAGER` or `BRANCH_ADMIN`; timesheet lock needs `BRANCH_MANAGER` or `PAYROLL`; unlock needs `PAYROLL`.

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| Lock roster | `POST /api/locks {location_id, start_date, roster_locked: true}` | `ROSTER_PUBLISH` @ branch; re-authentication [PROPOSED replaces shared lock password] | Only `roster_locked` changes |
| Publish roster | `POST /api/locks/publish {location_id, start_date}` | `ROSTER_PUBLISH` @ branch; roster locked | Visible to branch employees; announcement posted |
| Lock timesheets | `POST /api/locks {location_id, start_date, timesheet_locked: true}` | `TIMESHEET_LOCK` @ branch | Only `timesheet_locked` changes |
| Unlock roster | `POST /api/locks/unlock {location_id, start_date, flag: 'roster', reason}` | `ROSTER_PUBLISH` @ branch; not allowed once the timesheet is locked | Roster editable; audit |
| Unlock timesheets | `POST /api/locks/unlock {location_id, start_date, flag: 'timesheet', reason}` | `TIMESHEET_UNLOCK` @ branch; reason | audit with reason |

**Failures:** publish while unlocked → 409; missing reason → 400; re-auth failed → 401 (does not end session).

**Current:** [CURRENT] one endpoint toggles both flags **and clears the one not supplied** (D-1); locks are organisation-wide (D-11); authorised by `TIMESHEET_LOCK` or `ORGANISATION_UPDATE` plus user password or a shared lock password; returns raw error text on failure (D-16).

---

## 20. Leave request flow

**Start:** employee.

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| Open My Leave | `GET /api/portal/leave-requests` | self | List with status |
| Request | `POST /api/portal/leave-requests {leave_type, start_date, end_date, hours, reason}` | `LEAVE_REQUEST_SELF`; employee derived from session; period not locked; no overlapping pending/approved request | `Pending` |
| Cancel (pending only) | `POST /api/portal/leave-requests/:id/cancel` [PROPOSED] | self; status `Pending` | `Cancelled` |

**Failures:** invalid dates/hours/type → 400 with field messages; overlap → 409; locked period → 409.

**Current:** [CURRENT] backend request/list exist; **no routed UI** (D-15).

---

## 21. Leave approval flow

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| List | `GET /api/leave-requests?status=&branch_id=` (moved from `/api/organisation/leave-requests`) | `LEAVE_VIEW`; employees ∈ caller's branches (Payroll: approved only) | Filtered list |
| Approve / reject | `POST /api/leave-requests/:id/review {status, rejection_reason?}` | `LEAVE_APPROVE` @ employee's primary branch; caller ≠ employee; status `Pending`; period not locked | Approved → leave segments written into daily records (hours spread per day); Rejected requires reason; audit |

**Current:** [CURRENT] list is organisation-wide and approval accepts the permission from **any** branch (D-4); no self-approval check.

---

## 22. Reporting and export flow

| Report | Endpoint | AuthZ | Data |
|---|---|---|---|
| Branch operational report | `GET /api/reports/branch?start_date=&branch_id=` [PROPOSED] | `REPORT_BRANCH_VIEW` @ branch | Rostered vs actual, variance, exceptions for branch employees |
| Organisation summary | `GET /api/reports/org-summary?start_date=` [PROPOSED] | `REPORT_ORG_SUMMARY` | Aggregates per branch only |
| Payroll report / CSV / PDF | `/api/payroll/report|export/csv|export/pdf` [PROPOSED] | `PAYROLL_VIEW` / `PAYROLL_EXPORT`, scoped | Approved/locked data, classified |
| Staff list CSV | client-side from `GET /api/employees` | `EMPLOYEE_VIEW` scoped | Branch-scoped fields |
| Audit CSV | client-side from `GET /api/audit` | category permission | as visible |

Every export writes an audit event. Printable HTML escapes all interpolated values.

**Current:** [CURRENT] `/api/reports/payroll`, `/export/csv`, `/export/pdf` — organisation-wide, `REPORT_VIEW` (D-3); used on Reports and Roster pages.

---

## 23. Logout and session timeout flow

| Trigger | Client | Server | Result |
|---|---|---|---|
| User clicks Sign out (any location) | `POST /api/auth/logout`, then clear all auth storage | Session `is_active=false`, `revoked_at` | `/o/<entry_code>?reason=logout` (code remembered locally) |
| 10 min idle | Warning modal with countdown; "Stay signed in" → `POST /api/auth/keep-alive` | touches session | Continue |
| 15 min idle | Clear storage | server rejects with `SESSION_EXPIRED` on next call anyway | org link `?reason=inactivity` |
| 24 h absolute | — | `SESSION_EXPIRED` | Re-login |
| Revoked from another device | — | `SESSION_REVOKED` | Re-login with message |
| Membership removed / user deactivated | — | sessions revoked for that org (member removal [CURRENT] revokes sessions) | Re-login shows generic error |

**Current:** [CURRENT] sidebar Sign out does **not** call `/api/auth/logout` (D-14); timeout redirects to generic `/login` rather than the org URL; multiple tabs synchronise via `storage` events.

---

## 24. Access management flow (assign / change / revoke)

| Step | Backend | AuthZ | Result |
|---|---|---|---|
| View people & access | `GET /api/organisation/members` (+ assignments) | `ORGANISATION_VIEW` (org admins) or `BRANCH_VIEW` + `BRANCH_MANAGE_USERS` @ branch (branch admins see their branch only) | List |
| Grant assignment | `POST /api/assignments {user_id, role_key, scope_type, location_id?}` | target has active membership; caller may grant this role at this scope (TRD §5.7); caller ≠ target | `role_assignments` row; audit `ASSIGNMENT_GRANTED` with previous/new |
| Revoke | `POST /api/assignments/:id/revoke {reason?}` | same; cannot revoke own; cannot remove last owner | `revoked`; effective on next request; audit |
| Remove from organisation | `DELETE /api/organisation/members/:userId` | `ORGANISATION_MANAGE_USERS`; not self; not last owner | membership `removed`, assignments revoked, sessions revoked |

**Current:** [CURRENT] `/api/organisation/members*` and `/api/locations/:id/members*` implement grant/change/revoke with self-modification and owner protections and audit. But they write role values rejected by production CHECKs (D-8); branch-member `PUT`/`DELETE` don't verify the branch's organisation (D-19); the member invite overwrites roles without a hierarchy check (D-21); and Owners can self-assign to branches without re-authentication.

---

## 25. Security-related flows

### 25.1 Password reset

1. `/forgot-password` → `POST /api/auth/forgot-password {email}`. The response is always the same.
2. If the user exists, the server creates a `reset_tokens` row (SHA-256, 1 h) and sends an email with a link built from `PUBLIC_URL` [PROPOSED; CURRENT uses the request `Origin`, D-28].
3. `/reset-password?token=` → `GET /api/auth/verify-reset-token`. Lookup is hash-only [PROPOSED; CURRENT accepts hash or raw, D-7].
4. `POST /api/auth/reset-password {token, password}` → policy check → update the hash, mark the token used, **revoke all sessions** ([CURRENT]) → login page "Password updated".

Failures: expired/used token → "This link has expired"; weak password → field error.

Rate limiting: `reset-password` [CURRENT]; `forgot-password` [PROPOSED].

### 25.2 Two-factor authentication (email code)

Enable: Settings → `POST /api/auth/2fa/send-setup-code` → `POST /api/auth/2fa/enable {code, password}`. Login: temp token → `POST /api/auth/verify-2fa {temp_token, code}` (5 attempts, 10 min) → session. Disable requires password + code. [CURRENT]

### 25.3 Suspicious login verification

Risk detected → challenge row (hashed token + hashed code, 5 attempts, expiry) → email link built from `PUBLIC_URL` [PROPOSED; CURRENT uses request Origin] → `/verify-login?token=` or code entry **with the challenge ID** → `POST /api/auth/verify-login {challenge_id, code | token}` → session. [CURRENT] challenge binding implemented in `7fa3094` (D-2 fixed). [PROPOSED] Verification is a step **before** 2FA, never a replacement for it.

### 25.4 Organisation switch

`POST /api/auth/switch-organisation {organisation_id}` → verify active membership in target (Platform Admin **not** allowed [PROPOSED]) → revoke current session → new session bound to target org → reload → landing page. [CURRENT] exists; Platform Admin may switch to any org.

### 25.5 Session management

Settings → Security: list sessions (`GET /api/auth/security/activity`), revoke one (ownership verified), revoke all others. [CURRENT]

### 25.6 Private login link rotation

Owner → `POST /api/organisation/rotate-entry-code` [PROPOSED] → new `entry_code`; old link stops working immediately; audit `security`. Existing sessions continue (the link is not a credential). [CURRENT] `POST /api/organisation/regenerate-portal-url` generates a new `portal_slug`, but the old human `slug` keeps working and the public lookup reveals the new `portal_slug` (D-23).

### 25.7 Platform console

`/platform-gate` → `POST /api/auth/platform-login` (platform audience, 2FA supported) → console: organisations list, invitations (no raw tokens [PROPOSED]), platform audit log. Platform Admins cannot open tenant pages or tenant APIs [PROPOSED].

---

## 26. Flow ↔ document cross-reference

| Flow | PRD | TRD | Schema | UI |
|---|---|---|---|---|
| Org login | §10 | §4, §6 | `sessions`, `organisation_members` | UI §11 |
| Invitation | §7.9 | §4.3, §5.7 | `invitations`, `invitation_assignments` | UI §12 |
| Assignments | §5, §6 | §5 | `role_assignments` | UI §5 |
| Roster/lock/publish | §7.1, §7.4 | §7 | `period_locks`, `daily_records`, `shift_segments` | UI §7 |
| Timesheets | §7.2–7.4 | §5.3, §8 | `timesheet_submissions` | UI §6 |
| Leave | §7.5 | §5.3 | `leave_requests` | UI §8 |
| Payroll | §8.4 | §5.3 | via submissions/records | UI §5.5 |
