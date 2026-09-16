# Elite Timesheet OS Pro - Agent Guidelines & Engineering Protocol

This document outlines the architecture, engineering standards, and mandatory verification protocols for any AI agent or developer working on **Elite Timesheet OS Pro**.

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

## 🤖 SUBAGENT WORKFLOW PROTOCOL

When working on features or complex tasks:
1. **Subagent Delegation for Research & Coding**: Use subagents for research to explore codebase patterns, trace backend/frontend implementations, and gather technical requirements. Use dedicated subagents for implementation steps when applicable.
2. **Research First, Plan Second**: Always conduct thorough subagent research before generating or presenting implementation plans.
3. **Formal Planning Phase**: Present a clear implementation plan for review prior to executing multi-step functional code changes.

