---
name: web-visual-inspector
description: Visual inspection, layout auditing, screenshot capture, and UI interaction for web applications using browser screenshots and DOM snapshots. Make sure to use this skill whenever the user asks to "see the browser", "take a screenshot", "look at the web page", "navigate the website", "check UI rendering", "inspect visual state", or test UI interactive flows visually.
---

# Web Visual Inspector

This skill provides step-by-step instructions for inspecting web pages visually, navigating websites, taking screenshots, and interacting with UI components.

## Core Capabilities

1. **Visual Screenshots**: Capturing image screenshots of what is rendered on screen.
2. **Page Navigation**: Opening URLs, creating tabs, listing open pages, and reloading.
3. **DOM & Snapshot Inspection**: Getting exact UIDs for buttons, text inputs, links, and containers.
4. **Interactive Automation**: Clicking elements, filling out forms, scrolling, and verifying state changes visually.

---

## Standard Workflow

### Step 1: Prepare the Target Environment

- **Remote / Online URLs**: Navigate directly using `https://...`.
- **Local Static Files (e.g. `index.html`)**: 
  - Check if a local web server is already active.
  - If not active, start a lightweight HTTP server in the background:
    ```bash
    python3 -m http.server 8080
    ```
  - Target URL: `http://localhost:8080` (or `http://localhost:8080/index.html`).

---

### Step 2: Navigate and Establish Page Context

1. **Check Open Pages**:
   - Call `list_pages` to verify current active tabs.
2. **Navigate**:
   - Call `navigate_page` with target URL, or `new_page` if opening a new tab.
3. **Wait for Render**:
   - Use `wait_for` if waiting for specific selectors, dynamic content, or fonts to load.

---

### Step 3: Take Screenshots & Visual Inspection ("See with Eyes")

1. **Capture Full Page / Viewport**:
   - Call `take_screenshot` to get a visual representation of the web page.
   - Save screenshots to the conversation artifact scratch directory or inspect them visually.
2. **Analyze Visual Elements**:
   - Check layout alignment, color contrast, responsive layout breaks, element overlap, typography, and light/dark theme correctness.

---

### Step 4: DOM Snapshot & UI Interaction

1. **Get Element UIDs**:
   - Call `take_snapshot` to extract element boundaries, accessible names, and unique `uid` references.
2. **Execute Interactions**:
   - **Click**: Use `click` with element `uid`.
   - **Form Entry**: Use `fill` with element `uid` and desired input text.
   - **Hover / Focus**: Interact with hover states or focused fields.
3. **Re-evaluate Visual State**:
   - Take a new `take_screenshot` after significant actions (e.g., submitting a form, toggling a modal, changing themes) to confirm visual state updates.

---

## Best Practices

- **Pair Snapshots with Screenshots**: Use `take_snapshot` to accurately identify clickable target `uid`s, and `take_screenshot` to visually evaluate the visual result.
- **Form & Modal Validation**: Always take a screenshot before and after opening dialogs/modals or changing fortnight views to verify state persistence and clean UI transitions.
