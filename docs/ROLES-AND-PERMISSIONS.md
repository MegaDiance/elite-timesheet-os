# SimpleHours — Roles, permissions and scope

> **Status: [CURRENT]** — implemented on branch `refactor/two-role-model` (migration `…800`).
> This replaces the fixed Owner / Branch Admin model. Where `docs/TRD.md`, `docs/PRD.md` and the other
> source-of-truth documents describe roles differently, **this document wins** for roles, permissions
> and scope; those documents should be folded into it in a later pass.

## 1. The model

```
User → assignments (role + scope) → permissions → branches
```

- A **permission** is one capability (`timesheets.approve`). The catalogue lives in
  `backend/src/services/permissions.ts`; the `permissions` table is seeded from the same list and a
  test keeps them identical.
- A **role** is a named set of permissions, per organisation (`roles`, `role_permissions`).
- An **assignment** (`user_roles`) gives one person one role together with its **scope**: the entire
  organisation (`scope_all`), or the branches in `user_role_branches`. The same role can be held with
  different scopes by different people (a Payroll Manager for Melbourne, another for all branches).
- **Effective access is the union of a person's assignments**, each within its own scope, resolved from
  the database on every request (`resolveAccess` in `backend/src/services/policy.ts`). Nothing about
  roles or permissions is read from the token, the URL, the body or the frontend.
- Code asks "does this caller hold permission P (in branch B)?" — it never asks which role they have.

### Levels

| Level | Meaning |
|---|---|
| `branch` | Acts on one branch's data (employees, rosters, timesheets, leave, payroll). Held per branch. |
| `organisation` | Acts on the organisation itself (settings, branches, users, roles, audit, security). Only effective from an **entire-organisation** assignment — a branch-scoped role that includes one has no effect for it, so a branch role can never reach across the organisation. |
| `self` | The employee portal (`portal.access`, `timesheets.submit`, `leave.create`). Only the built-in Employee role holds these; they cannot be added to other roles. |

### Built-in roles

| Role | How the person holds it | Permissions |
|---|---|---|
| **Owner** | `organisations.owner_user_id`. One per organisation. Never stored in `user_roles`. | Every non-self permission, entire organisation. Fixed. Can't be deleted, edited, assigned or removed. Changes hands only through `POST /api/organisation/transfer-ownership` (password re-entry, audited). |
| **Admin** | An assignment. | Stored in `role_permissions`. New organisations get exactly what a Branch Admin always could do (employees, rosters, timesheets incl. approve/reopen/lock, leave view/approve/manage, payroll view/export, `organisation.view`). Only the owner can edit them; name and description are fixed. Existing Branch Admins were migrated to Admin assignments scoped to the branches they administered. |
| **Employee** | An active worker record linked to the login (`employees.user_id`). Never stored in `user_roles`. | `portal.access`, `timesheets.submit`, `leave.create`. Fixed. |
| **Custom** | An assignment. | Whatever the owner (or anyone with `roles.manage`, within their own access) chooses. |

A person can hold several roles (e.g. Admin for Melbourne + Payroll Manager for all branches, or
Employee + Roster Manager).

## 2. Permission catalogue

| Category | Key | Level | Guards |
|---|---|---|---|
| Employees | `employees.view` | branch | list workers with contact details |
| | `employees.create` | branch | add a worker |
| | `employees.edit` | branch | edit / move a worker |
| | `employees.archive` | branch | deactivate, reactivate, delete |
| | `employees.manage_access` | branch | employee-portal invitations, reset links, remove sign-in |
| Rosters | `rosters.view` | branch | see rosters (the worker list also opens for it, without contact details) |
| | `rosters.create` | branch | shifts on empty days, copy-day, Auto-roster, apply default roster |
| | `rosters.edit` | branch | change/clear shifts, breaks, default roster templates |
| Timesheets | `timesheets.view` | branch | worked hours and status |
| | `timesheets.create` | branch | first entry of worked hours for a day, Auto-log |
| | `timesheets.edit` | branch | change/clear worked hours |
| | `timesheets.approve` | branch | approve / bulk-approve |
| | `timesheets.reopen` | branch | reopen an approved timesheet |
| | `timesheets.lock` | branch | lock/unlock roster and timesheets for a pay period |
| Leave | `leave.view` | branch | leave requests |
| | `leave.approve` | branch | approve / decline |
| | `leave.manage` | branch | workforce toggles: employees submit timesheets, leave needs approval, merge leave into roster |
| Payroll | `payroll.view` | branch | payroll hours report |
| | `payroll.export` | branch | CSV / PDF export |
| Organisation | `organisation.view` | organisation | read organisation-wide settings |
| | `organisation.edit` | organisation | name, break rules, public holidays |
| | `branches.manage` | organisation | create/rename/deactivate branches |
| | `users.manage` | organisation | invite people, assign roles, change scope, remove access, reset links |
| | `roles.manage` | organisation | create/edit/delete roles and their permissions |
| | `announcements.moderate` | organisation | delete other people's noticeboard posts |
| Security | `audit.view` | organisation | read the audit log |
| | `security.manage` | organisation | private sign-in link, lock passwords |
| Employee portal | `portal.access`, `timesheets.submit`, `leave.create` | self | the employee portal |

Deliberately **not** in the catalogue, because the product has no such capability: publishing
rosters, reviewing payroll, billing, and a separate "manage permissions" (that is `roles.manage`).
Add a key only together with the feature it guards.

A saved day (`POST /api/records`) is authorised per side: `scope: ROSTER` needs `rosters.create` (empty
side) or `rosters.edit` (side already has entries); `TIMESHEET` likewise with `timesheets.*`; `BOTH`
needs both. `GET /api/records` returns only the side(s) the caller may view in the worker's branch.

## 3. Who may hand out what (`backend/src/services/roleAdmin.ts`)

One rule: **nobody can give, change or take away access they don't hold themselves.**

- Assigning / inviting a role over a scope: the caller must hold every permission of the role in that
  scope — organisation-wide for an entire-organisation assignment; in every chosen branch otherwise.
- Changing a scope must be covered for both the old and the new scope; removing a role must be covered.
- Creating or editing a role: the caller must hold every permission it has or is given, organisation-wide.
- Only the owner edits the Admin role. The Owner and Employee roles are never edited, assigned or deleted.
- Nobody changes their own assignments, and nobody assigns or removes the owner.
- Issuing a password-reset link for someone (a way into their account) needs the same coverage of everything they hold.
- Blocked attempts are written to the audit log (`ACCESS_ESCALATION_BLOCKED`).

## 4. Organisation switching

1. `POST /api/auth/reauthenticate { password }` — verified server-side against the account password,
   rate-limited per account, remembered on the server-side session for 5 minutes
   (`sessions.reauthenticated_at`). A wrong password is only "not correct". Audited.
2. `GET /api/auth/organisations` — the switch list. `403 REAUTH_REQUIRED` unless step 1 was done on this session.
3. `POST /api/auth/switch-organisation { organisation_id }` — same requirement; ends the current
   session and creates a new one for the target organisation, resolved from scratch. The client's
   organisation id is only a request: it succeeds only if this login holds access there. Audited in both organisations.

`GET /api/auth/me` exposes only `has_other_organisations` (a boolean), never the list. After a switch the
frontend reloads the app and clears every remembered branch.

## 5. API

All under `/api`, all require a session; the permission is the coarse gate and handlers additionally
authorise against the resource's own branch.

**Roles** (`roles.ts`; reading needs `roles.manage` or `users.manage`, writing `roles.manage`)

| | |
|---|---|
| `GET /roles/permissions` | catalogue grouped by category: `[{category, permissions:[{key,label,description,level,assignable}]}]` |
| `GET /roles` | `{can_manage, roles:[{id,name,description,system_key,is_system,permissions,member_count,can_edit_permissions,can_edit_details,can_delete}]}` |
| `GET /roles/:id` | role + `members:[{user_id,email,full_name,is_active,assignment_id,scope:{all,branches:[{id,name}]}}]` |
| `POST /roles {name,description?,permissions[]}` | create a custom role |
| `PUT /roles/:id {name?,description?,permissions?}` | edit |
| `DELETE /roles/:id` | delete a custom role (people holding it lose it) |

**Team** (`team.ts`; needs `users.manage`)

| | |
|---|---|
| `GET /team` | `{members:[{user_id,email,full_name,is_owner,is_self,status,two_factor_enabled,worker,assignments:[{id,role_id,role_name,system_key,scope:{all,branches:[{id,name,is_active}]}}]}], invitations:[…], branches:[{id,name}]}` |
| `POST /team/invitations {email,full_name?,role_id,scope}` | invite; `scope` is `{all:true}` or `{branch_ids:[…]}`. While email is off the response includes `invite_link` once. |
| `POST /team/invitations/:id/resend`, `DELETE /team/invitations/:id` | |
| `POST /team/:userId/roles {role_id,scope}` | give a role |
| `PUT /team/:userId/roles/:assignmentId {scope}` | change where it applies |
| `DELETE /team/:userId/roles/:assignmentId` | remove a role |
| `DELETE /team/:userId` | remove all roles |
| `POST /team/:userId/reset-password-link` | copyable one-hour reset link |
| public `GET /team/invitations/verify?token=`, `POST /team/invitations/accept` | accepting an invitation |

**Session / me** (`auth.ts`): `GET /auth/me` →
`{user, organisation, roles:[{id,name,system_key}], is_owner, is_employee, is_manager, permissions:[key], scopes:{[key]:{all,branch_ids}}, branches, has_other_organisations, employee_capabilities?}`.

## 6. Audit actions

`ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_PERMISSIONS_CHANGED`, `ROLE_DELETED`, `ROLE_ASSIGNED`,
`ROLE_REMOVED`, `ROLE_SCOPE_CHANGED`, `USER_ACCESS_REMOVED`, `TEAM_MEMBER_INVITED`,
`TEAM_INVITATION_ACCEPTED`, `TEAM_INVITATION_REVOKED`, `TEAM_PASSWORD_RESET_LINK_CREATED`,
`ACCESS_ESCALATION_BLOCKED`, `REAUTHENTICATION_SUCCEEDED`, `REAUTHENTICATION_FAILED`,
`ORGANISATION_SWITCHED_AWAY`, `ORGANISATION_SWITCHED_IN`, `OWNERSHIP_TRANSFERRED`. All go through
`writeAudit` into `audit_logs`, never into organisation data tables.

## 7. Schema and migration

`…800_roles_and_permissions`: `permissions`, `roles`, `role_permissions`, `user_roles`,
`user_role_branches` (composite foreign keys keep every row inside one organisation), a trigger that
creates the three built-in roles for every new organisation, a trigger that stops built-in roles being
deleted, `branch_admin_invitations.role_id/scope_all`, `sessions.reauthenticated_at`.
Existing Branch Admins were backfilled as Admin assignments scoped to their branches (no extra access).
`branch_admins` is **no longer read** but still exists; dropping it is the contract step and needs a
backup and explicit approval (`docs/BACKEND-SCHEMA.md` §9).

## 8. Behaviour changes to be aware of

- Workforce toggles (employees submit timesheets, leave approval, merge leave) need `leave.manage`
  (in the default Admin role, so Admins keep it). Name, break rules and public holidays now need
  `organisation.edit` (organisation-wide), which the default Admin role does not hold — public holidays
  used to be Owner-only too.
- Team members see only the branches their permissions cover; who has access to a branch is shown only
  to people with `users.manage`.
- A person can hold both management roles and the Employee role; the employee portal is available to
  anyone with a linked worker record.
