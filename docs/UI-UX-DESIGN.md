# SimpleHours — UI/UX Design Specification

| | |
|---|---|
| Status | Draft for review — authoritative once approved |
| Last audited against code | 2026-09-21, re-baselined on `main` @ `7fa3094` (`frontend/src`) |
| Labels | **[CURRENT] [REQUIRED] [PROPOSED] [DEFERRED]** — see [PRD §0.1](./PRD.md#01-status-labels) |
| Derived from | [PRD](./PRD.md) (who needs what) and [App Flow](./APP-FLOW.md) (what happens, in what order). Companion: [TRD](./TRD.md) · [Backend Schema](./BACKEND-SCHEMA.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md) |

> **UI visibility is not security.** Every rule here about hiding or showing something is a usability decision. The same rule must be enforced by the API ([TRD §5](./TRD.md#5-authorisation--role--scope--permission)). A control that is hidden but still works when called directly is a defect.

---

## 1. How this document was derived

1. List each role's jobs from PRD §5–§8.
2. Take each flow from APP-FLOW and identify the screens and states it needs.
3. Define the smallest navigation that reaches those screens for each combination of assignments.
4. Only then specify components and visual rules, reusing what exists.

No new visual identity is invented. Colours and fonts below are the ones already in the codebase.

---

## 2. Design principles [REQUIRED]

SimpleHours should feel **professional, clear, trustworthy, fast, modern, business-focused, and easy for someone who has never used workforce software.**

| Principle | In practice |
|---|---|
| Plain language first | "My hours", "Submit for approval", "Needs changes", not "Segment", "Actuals", "Under Review state". |
| One primary action per screen | The thing the user most likely came to do is the one filled (primary) button. |
| Show status, not mechanics | "Approved by Sarah on 14 Apr" beats a coloured dot alone. |
| Calm density | Tables are compact for managers; employee screens use larger touch targets and fewer columns. |
| Predictable | The same action is in the same place on every page; no hidden gestures for important actions. |
| Honest | Never show made-up data (the current Timesheet History placeholder violates this). Empty states say what's missing and what to do. |

Avoid: generic AI-SaaS aesthetics, gradients on surfaces, decorative animation, oversized rounded "bubble" cards everywhere, emoji in interface chrome, glassmorphism, and marketing-style headings inside the app ("Operational Command Centre" → "Today").

Emoji remain acceptable only as user content (e.g. announcement reactions).

---

## 3. Current UI state [CURRENT] (summary of audit)

| Area | State |
|---|---|
| Shell | Left sidebar (60 px collapsed / 240 px expanded, hover-expand, pin stored in `localStorage`), mobile top bar + drawer + bottom tab bar (`components/Layout.tsx`). |
| Navigation logic | Permission-driven sidebar (`usePermissions`), but route guards use legacy role strings (`App.tsx`), so links can bounce users to `/dashboard`. |
| Pages | Dashboard, Roster, Timesheets (review), My Timesheet, My Schedule, Timesheet History (fake past data), Employees, Locations, Leave Requests (manager-only), Reports, Settings, Audit, Team Chat, Platform Admin; public Home/Features/Pricing/Portal Access; auth pages. `Portal.tsx` orphaned. |
| Design tokens | CSS variables in `frontend/src/index.css` (dark default, light via `data-theme='light'`); sidebar stays dark in light mode. |
| Fonts | Inter (UI) and JetBrains Mono (loaded but not referenced) from Google Fonts. |
| Components | `components/ui`: Button, Card, Modal, ConfirmModal, Badge, Input, Select, Table, Tabs, Toast, Skeleton, EmptyState. Adoption uneven — Roster, Employees, Leave, Audit, Announcements, Platform use hand-rolled markup and local toasts. |
| Icons | lucide-react. |
| Theme | Only the app shell applies the stored theme; public/auth pages render the dark `:root` palette by default; no `prefers-color-scheme`. |
| Brand | "SimpleHours" and "Simple Hours" both used; some email template bodies still say "Elite Timesheet OS". |
| Accessibility gaps | Modal has no focus trap; Tabs lack ARIA roles; Toast lacks `aria-live`; many icon-only buttons rely on `title`; custom modals in Roster/Employees lack `role="dialog"`. |

---

## 4. Information architecture [PROPOSED]

The app is organised into **areas**. A user sees an area only if their capabilities include it.

| Area | Screens | Who |
|---|---|---|
| **My work** | Today · Schedule (week / fortnight / month) · My hours (timesheet) · History · My leave · Profile & security | Anyone with `EMPLOYEE` (self) |
| **Branch** | Branch dashboard · Roster · Timesheets · Leave · Staff · Branch reports · Branch activity (operational audit) | `BRANCH_MANAGER`, `BRANCH_ADMIN` (per branch) |
| **Payroll** | Pay periods · Payroll report · Exports · Public holidays (org-scoped payroll) | `PAYROLL` |
| **Organisation** | Overview (aggregate) · Branches · People & access · Staff records · Settings (details, break rules, entry mode, holidays) · Security (Owner) · Audit log (security/admin) | `ORG_OWNER`, `ORG_ADMIN` |
| **Shared** | Team chat · Help | All tenant users |
| **Platform** | Organisations · Invitations · Platform audit | Platform Admin only (separate console, separate login) |

Terminology in UI: **Branch** everywhere (the current UI says "Locations"). **Staff** for the employee directory. **Pay period** or **fortnight** (use "fortnight" in employee-facing text, "pay period" in payroll text).

---

## 5. Navigation by role [PROPOSED]

### 5.1 Rules

1. Navigation is built from `capabilities` returned by `GET /api/auth/me` (TRD §2.2). No page decodes the JWT.
2. Sections appear in this order: My work → Branch → Payroll → Organisation → Shared. A section with no visible items is not rendered.
3. Every nav item corresponds to a route guarded by the same capability; a user following a stale link sees an explicit "No access" page, not a silent redirect.
4. The sidebar footer shows the organisation name, the user's name and a short role summary (e.g. "Manager · Richmond + 1"), theme toggle, and Sign out (which revokes the session).

### 5.2 Organisation Owner / Organisation Admin

```
Organisation
  Overview
  Branches
  People & access
  Staff records
  Settings
  Security            (Owner only)
  Audit log
Shared
  Team chat
  Help
```

Overview shows aggregate figures per branch (headcount, hours this period, periods locked) and admin tasks (pending invitations, branches without a manager). It never shows individual employees' hours or timesheet rows. A banner explains: "Timesheets and rosters are managed by branch managers. To manage a branch yourself, give yourself a branch role." (Owners get a button to the audited self-grant flow; Org Admins do not.)

### 5.3 Branch Manager

```
Branch   [branch selector: Richmond ▾ / All my branches]
  Dashboard
  Roster
  Timesheets
  Leave
  Staff
  Reports
  Activity
Shared
  Team chat
  Help
```

### 5.4 Branch Admin

Same as Branch Manager. Differences are in page controls, not navigation: no Approve / Reject / Lock-timesheets buttons, and no leave approval buttons (leave is shown read-only with status). Their Staff page has **Invite employee** for their own branch. A Branch Manager's Staff page has no invite or access controls; Branch Managers edit staff records only (TRD §5.7).

### 5.5 Payroll

```
Payroll
  Pay periods
  Payroll report
  Exports
  Public holidays     (organisation-scoped payroll only)
Shared
  Team chat
  Help
```

No roster, no staff editing, no branch settings. Timesheets appear read-only inside the payroll report, approved data only; unapproved employees are listed by name and status only.

### 5.6 Employee

```
My work
  Today
  Schedule
  My hours
  History
  My leave
Shared
  Team chat
  Help
Account (footer menu)
  Profile & security
```

Mobile bottom bar: **Today · Schedule · My hours · Leave · More**.

The employee UI contains no management terms, counts of other people's timesheets, or links into Branch/Organisation areas.

### 5.7 Combined assignments

Sections simply stack. John (Employee + Manager @ Richmond) sees **My work** and **Branch**. The landing page follows APP-FLOW §2.1. On mobile, a user with both sets gets a bottom bar of **Today · Branch · My hours · Timesheets · More**.

### 5.8 Current vs proposed

[CURRENT] Management users see: Dashboard, Roster, Timesheets, Leave / Employees, Team Chat / Locations, Reports, Audit Log, Settings, Help. Everyone else: Dashboard, My Timesheet, My Schedule, Timesheet History, Team Chat / Settings, Help. A user holding both employee and management roles sees **only** the management set — they lose "My Timesheet". [PROPOSED] stacked sections fix this.

---

## 6. Timesheet UX [REQUIRED]

Goal (PRD §15): a first-time employee enters and submits a fortnight in under 5 minutes with no training.

### 6.1 Employee: My hours

- Header: fortnight date range with previous/next arrows, and a clear status chip: **Draft**, **Submitted — waiting for approval**, **Needs changes**, **Approved**, **Locked**.
- If "Needs changes": a prominent note box at the top with the manager's reason and who wrote it.
- One row/card per day (cards on mobile, rows on desktop), showing:
  - Rostered shift (if any) in muted text: "Rostered 9:00 am – 5:00 pm".
  - Start, Finish, Break (select: 0/15/30/45/60 min; default from organisation break rules), Notes.
  - Calculated hours for the day, updated as you type.
  - "Same as rostered" button that fills start/finish from the roster.
- Time input accepts natural entries (`9`, `9a`, `930`, `17`, `5pm`) and shows the interpreted time immediately ([CURRENT] `SmartTimeInput`, `timeParser.ts`). Invalid entries show an inline message, never a silent reset.
- Autosave per day with a small "Saved" confirmation; no separate Save button for the whole sheet.
- Sticky footer: total hours this fortnight vs contracted hours, and the primary button **Submit for approval**. The button explains why it is disabled ("2 days have a start time but no finish time").
- Submit opens a confirmation summarising days and total hours.
- Locked / approved / manager-entry mode: fields read-only with a one-line explanation ("Your manager enters hours for your organisation").

### 6.2 Manager: Timesheets

- Filter tabs: **Ready to review**, **In review**, **Needs changes**, **Approved**, **Not submitted**, **All** (labels from §6.3); search by name; branch filter (own branches only).
- Row: employee, branch, submitted date, total hours, variance vs roster, status, actions.
- Row expands inline to show day-by-day rostered vs actual with differences highlighted (unplanned shifts, missing days, long shifts).
- Actions: **Approve** (primary), **Request changes** (requires a reason; the reason is shown to the employee verbatim). Bulk "Approve selected" asks for confirmation and reports per-row failures.
- The user's own timesheet never shows Approve (separation of duties); a note says "Someone else must approve your timesheet."

### 6.3 Status vocabulary (UI ↔ data)

| Data status | Employee sees | Manager sees |
|---|---|---|
| Draft / no row | Draft — not submitted | Not submitted |
| Submitted | Submitted — waiting for approval | Ready to review |
| Under Review | Submitted — being reviewed | In review |
| Rejected | Needs changes | Needs changes |
| Approved | Approved | Approved |
| Approved + period locked | Locked | Locked |

---

## 7. Roster UX [REQUIRED]

- Grid: employees (rows) × 14 days (columns), sticky name column with contracted hours ([CURRENT]). Each cell shows planned shift and, once entered, actual hours (split cell [CURRENT]) with colour meaning: matches roster / differs / unplanned / leave. Colour is never the only signal — use an icon or text label too.
- Toolbar (left → right): branch selector, fortnight navigation, status chips (**Roster: Draft / Locked / Published**, **Timesheets: Open / Locked**), then actions: Apply default rosters, Copy roster to actuals, Publish, More (export, print).
- Publish is a two-step, explicit action: "Publish roster to Richmond staff?" listing what staff will see. Publishing requires the roster to be locked; the dialog locks and publishes in one confirmation ([CURRENT] "Push & Finalise" modal).
- Re-authentication replaces the shared "lock password" prompt [PROPOSED]: "Confirm your password to lock this roster."
- Overlapping shifts are refused with a clear message naming the conflicting shift ([CURRENT]).
- Controls are enabled per capability for the selected branch (e.g. Branch Admin sees Publish but not Lock timesheets).
- [CURRENT] Roster page shows every control to anyone who reaches it. [REQUIRED] capability-gated controls, backed by API checks.

---

## 8. Leave UX [REQUIRED]

### 8.1 Employee: My leave

- List of requests with status chips: **Pending**, **Approved**, **Declined** (with reason; data status `Rejected`), **Cancelled**.
- **Request leave** primary button → form: leave type (Annual, Sick, Time in lieu, Unpaid, Other — plain names for `Annual`, `Sick`, `TIL`, `Unpaid`, `Other`), start date, end date, hours (pre-filled from rostered hours in that range [PROPOSED], editable), optional reason. Inline validation for dates and hours.
- Cancel available while Pending.
- [CURRENT] This screen does not exist in routed UI; the dashboard's "Request Leave" link sends employees to a manager-only page. Must be built (IMPLEMENTATION-PLAN Phase 7).

### 8.2 Manager: Leave

- Tabs: Pending, Approved, Declined, All; branch filter (own branches); search.
- Approve / Decline (reason required). Warning when the request overlaps a locked period (action disabled with explanation).
- Branch Admin: read-only view.

---

## 9. Dashboard UX [REQUIRED]

Dashboards are composed from blocks the user's capabilities allow.

| Block | Shown to | Content |
|---|---|---|
| My day | `EMPLOYEE` | Today's shift (or "No shift today"), next shift, hours this fortnight, timesheet status + action |
| My leave | `EMPLOYEE` | Upcoming/pending leave |
| Working today | Branch roles (per branch) | Who is rostered, who has entered hours |
| Waiting for you | `BRANCH_MANAGER` | Timesheets ready to review, leave pending — counts link to filtered lists |
| Roster status | Branch roles | This and next fortnight: draft/locked/published |
| Payroll readiness | `PAYROLL` | Approved vs outstanding per branch for current period |
| Organisation overview | `ORG_OWNER`/`ORG_ADMIN` | Branch count, staff count, pending invitations, branches without a manager, aggregate hours per branch |
| Team today | `EMPLOYEE` | Teammates at own branch today (names + shift times only) |

[CURRENT] Dashboard switches between a "manager" and "employee" variant using the legacy role string; the owner card shows the private URL and counts; the "Audit Log" quick link points to a non-existent route (`/audit-log`). [REQUIRED] fix links; compose by capability.

---

## 10. Organisation and branch switching [REQUIRED]

### 10.1 Organisation switching

- Shown only when the user has active memberships in more than one organisation.
- Location: organisation name in the sidebar header opens a menu listing organisations with the user's summary role in each.
- Switching signs the user into the other organisation (new session) and reloads to that organisation's landing page. A short confirmation explains that work in the current organisation is saved.
- The organisation name is always visible in the shell so users know which tenant they are in.

### 10.2 Branch selection

- Shown when the user has branch-scoped assignments in more than one branch.
- A selector at the top of the Branch area: each assigned branch plus **All my branches**. It shows the user's role per branch ("Richmond — Manager", "Geelong — Admin").
- Selecting a branch filters views; it does not change permissions. In "All my branches" each row displays its branch and actions follow that row's branch.
- Choice is remembered per user on this device (`localStorage`, convenience only).
- Owners/Org Admins without branch roles do not see the selector; the Branches page (administration) lists all branches without operational data.
- A user with an **all branches** assignment sees every active branch in the selector, labelled "All branches — Manager".
- [CURRENT] Branch switching re-issues the token via `POST /api/auth/select-location` and reloads the page; it is a security context today. [PROPOSED] filter only (TRD §5.5).

---

## 11. Login UX [REQUIRED]

- Private link page (`/o/<entry_code>`): a generic SimpleHours sign-in: "Sign in to SimpleHours", email, password, **Sign in**, "Forgot password?". Nothing else.
  - No organisation name or logo is shown before authentication (PRD §10). After sign-in, the organisation name appears in the shell header.
  - [CURRENT] `/login/:slug` shows the organisation's logo and name, fetched from the public lookup.
- Error: one generic message "Email or password is incorrect" (APP-FLOW §2). Rate-limit message tells the user how long to wait.
- Verification / 2FA screen: 6-digit code input (numeric keypad on mobile, paste support), resend with countdown, "Use a different account".
- "Signed in to another organisation" state: explain and offer "Sign out of <Org A> and continue".
- Session-ended messages from `?reason=` (inactivity, revoked, deactivated, logout) shown as a neutral info banner.
- Public site "Sign in" → explanation + "Email me my sign-in link" [PROPOSED]. The workspace-slug entry page is removed [PROPOSED].
- Platform console login is visually distinct (existing dark console) and not linked from the public site.

---

## 12. Invitation UX [REQUIRED]

- Invite form (People & access or Staff): email, name (optional), and **what access** as plain sentences built from assignments: "Employee at Richmond", "Branch manager at Richmond". The form only offers roles the inviter may grant.
- After sending: confirmation with delivery status; "Resend" and "Revoke" available on pending invites. Raw invite links are never displayed or returned by the API [PROPOSED]. [CURRENT] Employee create/update/resend responses return `inviteLink`, and the platform console can show "emergency" org-invite links (D-6).
- Accept page: "<Inviter> invited you to <Organisation> as Branch manager at Richmond." Then either create password (new account) or sign in (existing account for that email). Expired/used/mismatched states have their own clear messages (APP-FLOW §3).

---

## 13. Accessibility [REQUIRED] — WCAG 2.2 AA

| Requirement | Current gap to fix |
|---|---|
| All interactive elements reachable and operable by keyboard; visible focus ring | Custom div modals (Roster, Employees) |
| Modals: `role="dialog"`, `aria-modal`, labelled by their own title id, focus trapped, focus returned on close | `ui/Modal` has no focus trap; fixed `id="modal-title"` shared by all modals |
| Tabs: `role="tablist"/"tab"/"tabpanel"`, `aria-selected`, arrow-key navigation | `ui/Tabs` |
| Toasts/status updates announced (`aria-live="polite"`, errors `assertive`) | `ui/Toast`, inline page toasts |
| Icon-only buttons have `aria-label` | many use `title` only |
| Colour contrast ≥ 4.5:1 text, 3:1 UI; colour never the only signal | roster colour coding needs text/icon cues |
| Form fields have programmatic labels and error associations (`aria-describedby`) | `ui/Input` has label; errors not associated |
| Touch targets ≥ 44×44 px on mobile | mobile bottom bar is 48 px [CURRENT ✓] |
| Respect `prefers-reduced-motion` | not handled |
| Language set (`lang="en-AU"`), dates/times in Australian format (e.g. `Mon 14 Apr`, `9:00 am`) | `frontend/index.html` currently `lang="en"` |

---

## 14. Responsive / mobile behaviour [REQUIRED]

- Breakpoints follow Tailwind defaults (`sm 640`, `md 768`, `lg 1024`, `xl 1280`).
- Employee areas are designed mobile-first (≥ 360 px): day cards, bottom tab bar, large inputs.
- Manager tables: horizontal scroll with sticky first column below `lg`; the roster grid is desktop-first (min width 1200 px [CURRENT]) with a **day view** on mobile [PROPOSED] (one day, list of employees).
- No horizontal page scroll outside designated scroll containers.
- Sidebar: collapsible on desktop [CURRENT]; drawer on mobile [CURRENT].

---

## 15. Components and design system

### 15.1 Existing tokens [CURRENT] (`frontend/src/index.css`)

Keep these; do not introduce new brand colours.

| Token | Dark (default) | Light |
|---|---|---|
| `--bg` | `#09090b` | `#f8f9fb` |
| `--panel` | `#141417` | `#ffffff` |
| `--panel-subtle` | `#1c1c21` | `#f1f4f8` |
| `--primary` / `--primary-h` | `#3b5bdb` / `#2f4ac4` | same |
| `--success` | `#10b981` | `#0a8a5e` |
| `--danger` | `#ef4444` | `#c42b2b` |
| `--warn` | `#f59e0b` | `#c27d0a` |
| `--text` | `#f4f4f5` | `#1a1f36` |
| `--muted` | `#a1a1aa` | `#6b7a99` |
| `--border` | `rgba(255,255,255,.08)` | `#e3e8f0` |
| `--sidebar-bg` | `#0d0e12` | `#0f172a` |

[PROPOSED] cleanup: align `theme-color` meta (`#2563EB`) and favicon gradient with `--primary`; replace raw Tailwind palette classes (indigo/emerald/rose/amber) with the tokens; apply the stored theme (or `prefers-color-scheme`) on public and auth pages too. Default theme for the app: **light** ([CURRENT] default when no stored value).

### 15.2 Typography

- [CURRENT] Inter for all UI text; tabular numbers (`font-variant-numeric: tabular-nums`) for hours and money columns [PROPOSED].
- [PROPOSED] Either use JetBrains Mono (already loaded) for codes/IDs only, or stop loading it.
- Scale (Tailwind): page title `text-xl`/`2xl` semibold; section title `text-base` semibold; body `text-sm` (manager) / `text-base` (employee mobile); helper `text-xs` muted. No all-caps headings except small labels.

### 15.3 Spacing and shape

- 4 px base grid (Tailwind spacing). Page padding 16 px mobile / 24 px desktop.
- Radius: 6–8 px for inputs, buttons, cards; avoid pill shapes except status chips.
- Elevation: borders first; shadows only for overlays (menus, modals).

### 15.4 Components (use and extend `components/ui`)

| Component | Rules |
|---|---|
| **Button** | Variants: primary (one per view), secondary, outline, ghost, danger. Loading state disables and shows spinner with label kept. Destructive actions use danger + confirmation. |
| **Forms** | Label above field; helper text below; inline error text in `--danger` with icon; required fields marked in text ("Required") not only `*`; validate on blur and on submit; never clear user input on error. |
| **Tables** | Compact rows, sticky header, right-aligned numbers, sortable where useful, empty state inside the table body, row actions in a trailing column or overflow menu. |
| **Navigation** | Sidebar items: icon + label; active item uses `--sidebar-active-*`; section headings small muted text. |
| **Modals** | For confirmations and short forms only; long forms get their own page or side panel. Title states the action ("Approve 12 timesheets?"). Escape and Cancel close; destructive confirm button on the right. |
| **Alerts / banners** | Info, success, warning, danger; used for page-level state (locked period, needs changes, session ended). |
| **Toasts** | Brief confirmations of completed actions ("Timesheet approved"); errors that need action use inline alerts instead. Single global toast system (retire page-local toasts). |
| **Status chips** | Text label always present; colours from tokens. |
| **Empty states** | Say what is missing, why, and the next action ("No shifts published for this fortnight yet. Your manager will publish the roster soon."). |
| **Loading states** | Skeletons matching the layout for first load; inline spinners for actions; no full-screen spinners after first paint. |
| **Error states** | Plain-language message + retry; 403 page "You don't have access to this page" + link to the user's landing page; 404 page; never show technical details. |

### 15.5 Content and voice

- Australian English (organisation, rostered, licence), dates `Mon 14 Apr 2026`, times `9:00 am`, hours to 2 decimal places.
- Brand name: **SimpleHours** (one word) in product UI, emails and documents [PROPOSED decision — the codebase mixes "SimpleHours" and "Simple Hours"].
- Remove marketing claims that are not true in the product (e.g. Xero sync in the help chatbot and pricing page) until those features ship.

---

## 16. Consistency with other documents

- Navigation areas (§4–5) map 1:1 to capability groups in TRD §5.3.
- Every screen action listed here appears as an APP-FLOW step with the same permission.
- Screens that require data not yet in the schema (per-branch locks, multi-branch employees, payroll role) are delivered only after the corresponding BACKEND-SCHEMA migration (IMPLEMENTATION-PLAN ordering).
