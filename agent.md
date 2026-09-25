# Elite Timesheet OS Pro - Agent Guidelines & Engineering Protocol

This document outlines the architecture, engineering standards, and mandatory verification protocols for any AI agent or developer working on **Elite Timesheet OS Pro** (product name: **SimpleHours**).

---

## 📚 Source of Truth — Read Before Changing Anything

These six documents are the authoritative specification for SimpleHours. Read the relevant ones before any feature, schema, auth or permission change. If code and documents disagree, raise it — do not silently "fix" either one.

| Document | Covers |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product scope, hierarchy, roles, permission matrix, known defects, deferred items |
| [docs/TRD.md](docs/TRD.md) | Architecture, authentication, role + scope + permission model, tenant/branch isolation, security, testing |
| [docs/UI-UX-DESIGN.md](docs/UI-UX-DESIGN.md) | Information architecture, navigation by role, screen behaviour, design system |
| [docs/APP-FLOW.md](docs/APP-FLOW.md) | Every important flow with its backend action, authorisation check and failure states |
| [docs/BACKEND-SCHEMA.md](docs/BACKEND-SCHEMA.md) | Current schema assessment, target schema, constraints, migration strategy |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Phased delivery order, completion criteria, open decisions |

`docs/security/hierarchy-audit-and-design.md` is an earlier audit and design proposal. Its findings are mapped into `docs/PRD.md` §12, and its design is reconciled in `docs/IMPLEMENTATION-PLAN.md` §R. Where it differs from the six documents, the six documents win.

Documents label everything **[CURRENT] / [REQUIRED] / [PROPOSED] / [DEFERRED]**. Never describe or treat planned functionality as already implemented.

### Non-negotiable architecture rules

1. **The hierarchy is fixed:** Organisation → Branch → User → Assignment → Role → Scope → Permission → Resource. Do not change it without updating the documents and getting approval.
2. **Roles and scopes are separate.** A role means nothing without its scope (organisation, a named branch, or self). Never collapse to `User → Role`.
3. **One person, one account.** A user may hold many assignments (e.g. Employee at one branch, Branch Manager at another). Never require a second account.
4. **Authorisation is server-side only.** Every protected request checks authentication → session → organisation membership → assignments → scope → permission → resource relationship. Frontend hiding is **not** security.
5. **Organisation isolation is mandatory.** The active organisation comes from the server session only. Never trust a client-supplied `organisation_id`.
6. **Branch isolation is mandatory.** Authorise against the resource's own branch as stored in the database. Never trust a client-supplied `location_id`/`branch_id`/`x-location-id` to choose permissions.
7. **Organisation ownership ≠ operational access.** Owners/Org Admins do not see branch timesheets, shifts, leave or payroll lines without an explicit assignment.
8. **Deny by default.** Errors, missing data or ambiguous scope must deny, never `next()`.
9. **No self-escalation.** Nobody grants others roles outside the grant table (`docs/TRD.md` §5.7) or grants themselves anything, except the audited, re-authenticated Owner self-grant (`docs/PRD.md` §5.2). Nobody approves their own timesheet or leave.
10. **Never destructively delete production data without verification** — follow the expand → migrate → verify → contract process in `docs/BACKEND-SCHEMA.md` §9, with a backup and explicit approval.
11. **Authorisation changes require tests** — add or update cases in the authorisation matrix (cross-organisation, cross-branch, IDOR, escalation) and run them against real PostgreSQL where the plan requires it, not only pg-mem.

---

## 🛠 Tech Stack & Architecture

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router v7.
  - Theming: Full CSS theme variable support (`var(--bg)`, `var(--panel)`, `var(--text)`, `var(--border)`, `var(--input-bg)`). Both Dark and Light modes must look clean and high-contrast.
- **Backend**: Node.js, Express, TypeScript, JWT auth with bcrypt password hashing.
- **Database**: PostgreSQL (with in-memory `pg-mem` mock database enabled for development via `DATABASE_URL=memory`).
- **Core Services**:
  - `timeParser.ts`: Smart flexible time input parsing (`9` -> `09:00`, `9a` -> `09:00`, `1700` -> `17:00`) and break deduction calculations.
  - `periodUtils.ts`: Fortnight boundary anchor calculations.
  - `rosterService.ts`: Auto-Roster, Auto-Log, Variance, and Leave stats calculations.

---

## ⚠️ MANDATORY VERIFICATION PROTOCOL (MUST RUN BEFORE FINISHING)

Before completing any task or user request, you **MUST** run the TypeScript debugging check:

```bash
# 1. Run TypeScript Typecheck & Build across both backend and frontend workspaces
npm run typecheck

# 2. Run backend unit tests (using bypass sandbox if needed for loopback sockets)
npm test
```

### Requirements:
1. **Zero TypeScript Errors**: Both `backend` (`tsc`) and `frontend` (`tsc -b && vite build`) must exit with code 0.
2. **Zero Unused Imports/Variables**: Strict TS mode forbids unused imports/variables.
3. **Preserve Existing Functionality**:
   - Rostering shifts must NEVER overwrite or delete existing timesheet actuals (`actual_in`, `actual_out`, `actual_hours`).
   - Default roster templates must autosave instantly without requiring a separate manual save click.
   - Shift overlaps must be prevented with a clear user alert.
   - Color coding must reflect timesheet actuals and highlight unplanned shifts/exceptions.
   - Date range selector must open the calendar picker (`showPicker()`).
   - All interactive buttons must trigger their full end-to-end API workflows.
4. **Mandatory Automated End-to-End & Regression Test Suite**:
   - Every API flow, database modification, and invitation/auth lifecycle MUST have automated integration tests executed (`npm test`) covering happy paths, edge cases (invalid tokens, reuse, unauthorized calls), and schema consistency.
   - Any background dev server running old in-memory code must be cleanly restarted and verified against real HTTP endpoints before handing work back to the user.

---

## 🧰 Available Skills

### Caveman (`/caveman`)
- **Purpose:** Development communication / token efficiency.
- **Use during:** Implementation, debugging, code review and development sessions where concise output is useful.
- **Installed at:** user level, `~/.claude/skills/caveman` (from `mattpocock/skills`). Turn off with "stop caveman" or "normal mode".
- **Never compress away** (write these out in full, even in caveman mode): security findings, failed tests, authentication problems, permission problems, database changes, migration issues, deployment failures, and important implementation decisions. Caveman never replaces the Mandatory Verification Protocol above.

### Brag (`/brag:brag`, `/brag:brag-slim`)
- **Purpose:** Product/demo presentation — short launch/demo videos (roster workflow, dashboard, employee and mobile experience, finished UI).
- **Use during:** Marketing and presentation work, only after functionality has been implemented and browser-tested.
- **Do not** use Brag as a development or testing tool, or to implement SimpleHours functionality. It writes only to `brag-output/` and needs Node 22+, FFmpeg and `npx hyperframes` when run.
- **Installed at:** plugin `brag@brag` (marketplace `latent-spaces/brag`), local scope for this project — enabled in `.claude/settings.local.json`.

---

## 🤖 SUBAGENT WORKFLOW PROTOCOL

When working on features or complex tasks:
1. **Subagent Delegation for Research & Coding**: Use subagents for research to explore codebase patterns, trace backend/frontend implementations, and gather technical requirements. Use dedicated subagents for implementation steps when applicable.
2. **Research First, Plan Second**: Always conduct thorough subagent research before generating or presenting implementation plans.
3. **Formal Planning Phase**: Present a clear implementation plan for review prior to executing multi-step functional code changes.

