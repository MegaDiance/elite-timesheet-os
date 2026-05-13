# Elite Timesheet OS Pro - Agent Guide

Welcome to the **Elite Timesheet OS Pro** project. This file serves as a guide for future AI agents working on this codebase to ensure consistency, stability, and high performance.

## 🚀 Project Overview
Elite Timesheet OS Pro is a Secure Roster & Timesheet Management System. It handles employee management, shift scheduling, timesheet logging, and tracks variations between rostered and actual hours. Features include:
- Roster Master View
- Staff Management
- Employee Portal
- Timesheet auto-logging and locking mechanisms

## 🛠 Tech Stack
The project is built entirely with a pure, lightweight, vanilla stack:
- **HTML5**: For semantic structure.
- **CSS3 (Vanilla)**: For styling, including native CSS variables for theming (light/dark mode), modern design aesthetics (glassmorphism), and responsiveness.
- **JavaScript (Vanilla)**: For core logic, DOM manipulation, custom dialog engines, state management (using `localStorage`), and dynamic interactions. No heavy frameworks (like React, Angular, or Vue) are used currently.

## 🧪 Development Protocol
To improve efficiency and maintain stability, we strictly adhere to a **PLAN -> EXECUTE -> TEST** protocol. All agents must follow this workflow:

1. **PLAN**: 
   - Analyze the user request and review the existing codebase (`index.html` and other related files).
   - Outline the intended changes, identifying the specific HTML elements, CSS styles, and JavaScript functions impacted.
   - Consider the impact on existing data models.

2. **EXECUTE**: 
   - Implement the planned changes systematically.
   - Ensure backwards compatibility with existing `localStorage` data structures.
   - Prioritize clean, well-commented, and robust code. Avoid adding unnecessary dependencies.

3. **TEST**: 
   - Ensure your code changes work as intended.
   - Verify edge cases (e.g., parsing varying time formats, switching between fortnights, data persistence) are handled without breaking existing features.
   - Confirm UI responsiveness and verify no console errors are introduced.

By adhering strictly to this protocol, you help maintain a stable, efficient, and robust codebase.
