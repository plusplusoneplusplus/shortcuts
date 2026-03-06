# Mobile-Responsive CoC SPA Dashboard

## User Story

**As a** developer who monitors AI pipeline executions from a phone or tablet,
**I want** the CoC SPA dashboard to adapt its layout to smaller screens,
**so that** I can check pipeline status, browse wiki articles, and manage repos on the go without horizontal scrolling or unusable UI elements.

### Personas

| Persona | Device | Key Tasks |
|---------|--------|-----------|
| **On-call dev** | Phone (360–430px) | Check pipeline status, read process logs, stop/restart runs |
| **Reviewer** | Tablet (768–1024px) | Browse wiki articles, review repo details, manage queue |
| **Presenter** | Tablet landscape | Demo dashboard on iPad, share screen from mobile |

---

## Current State

The SPA (`packages/coc/src/server/spa/`) is a React + Tailwind dashboard with:

- **Viewport meta tag** present (`width=device-width, initial-scale=1.0`)
- **Zero `@media` queries** — layout is entirely desktop-fixed
- **Hard-coded 320px sidebars** (`w-[320px]`, `min-w-[320px]`, `max-w-[320px]`) in Repos, Processes, and Wiki views
- **Fixed 48px top bar** with horizontal tab labels
- **No touch-friendly sizing** — buttons and interactive elements use default small sizes
- **A custom Tailwind breakpoint** (`md-split: 900px`) defined but unused
- **Manual `window.innerWidth`** calculations only for tooltip collision avoidance

The dashboard is essentially unusable on screens narrower than ~700px.

---

## Entry Points

This is a web app served by `coc serve`. Users access it via a browser URL. The same URL must work across all device sizes — there is no separate "mobile app" or alternate route.

---

## Design Principles

1. **Mobile-first Tailwind** — Default styles target mobile; layer `md:` and `lg:` variants for wider screens.
2. **Progressive disclosure** — Show less on small screens, let users drill in. Sidebars become overlay panels on mobile.
3. **Touch-first interactions** — Minimum 44px tap targets, generous spacing in lists and menus.
4. **No feature removal** — Every feature available on desktop remains accessible on mobile, just reorganized.

---

## Responsive Breakpoints

| Token | Width | Behavior |
|-------|-------|----------|
| **Default (mobile)** | < 640px | Single-column, stacked layout, sidebars hidden by default |
| **`sm`** | ≥ 640px | Minor spacing increases |
| **`md`** | ≥ 768px | Two-column layouts begin to appear |
| **`lg`** | ≥ 1024px | Full desktop layout (current behavior) |

---

## User Flows

### 1. Top Bar & Navigation

**Current:** Fixed 48px bar with hamburger + text tabs ("Repos", "Processes", "Wiki") + theme toggle + WS indicator.

**Mobile (< 768px):**
- Tabs move to a **bottom navigation bar** (fixed to bottom of screen) with icon + short label for each tab — this follows mobile platform conventions and frees the top bar.
- Top bar retains: hamburger (context sidebar toggle), title (truncated or hidden), theme toggle, WS dot.
- Title "AI Execution Dashboard" becomes a small icon/logo only on mobile.

**Tablet (≥ 768px):**
- Tabs remain in top bar but use compact labels or icon+label.

### 2. Repos View

**Current:** 320px sidebar (ReposGrid cards) + flexible right panel (RepoDetail with tabs).

**Mobile (< 768px):**
- **Full-screen list mode** — ReposGrid takes full width as a vertical card list.
- Tapping a repo card navigates to a **full-screen RepoDetail** view with a back arrow.
- RepoDetail internal tabs (Git, Queue, Chat, Schedules, Info) rendered as a horizontal scrollable tab strip.

**Tablet (≥ 768px, < 1024px):**
- Sidebar narrows to 260px or becomes a collapsible drawer (overlay).
- Detail panel takes remaining width.

### 3. Processes View

**Current:** 320px sidebar (filters + process list) + flexible right panel (ProcessDetail).

**Mobile (< 768px):**
- Full-screen process list with filters in a collapsible top section (accordion).
- Tapping a process opens full-screen ProcessDetail with back navigation.
- DAG visualizations: enable **pinch-to-zoom** and **horizontal scroll** in a contained viewport. Show a "Rotate device" hint for complex DAGs.

**Tablet (≥ 768px):**
- Sidebar becomes a narrow panel or collapsible drawer.

### 4. Wiki View

**Current:** 320px sidebar (WikiComponentTree) + content + optional right TOC sidebar.

**Mobile (< 768px):**
- Full-screen article list → full-screen article reading experience.
- TOC available as a floating "Table of Contents" button that opens a bottom sheet.
- Mermaid diagrams: horizontally scrollable container with pinch-to-zoom.
- "Ask" tab: full-screen chat interface.

**Tablet (≥ 768px):**
- Two-pane: narrow sidebar + content. TOC hidden behind a toggle.

### 5. Admin Panel

**Current:** Grid of cards for admin functions.

**Mobile:** Cards stack to single column. Forms and inputs full-width.

---

## Component-Level Changes

### Sidebar Pattern (shared across views)

Replace the hard-coded `w-[320px]` sidebar with a responsive sidebar component:

| Screen | Behavior |
|--------|----------|
| Mobile (< 768px) | Hidden by default. Hamburger opens as full-screen overlay or slide-in drawer from left. Tap outside or swipe left to dismiss. |
| Tablet (768–1023px) | Collapsible 260px panel. Toggle via hamburger. |
| Desktop (≥ 1024px) | Always visible 320px panel (current behavior). |

### Touch Targets

- All buttons, list items, and interactive elements: **minimum height 44px** on mobile.
- Increase padding in dropdowns, context menus, and popovers.
- `AICommandMenu`, `ContextMenu`, `InlineCommentPopup`: render as **bottom sheets** on mobile instead of floating popovers.

### Typography & Spacing

- Body text: `text-sm` (14px) on mobile → `text-base` (16px) on desktop.
- Headings scale down one step on mobile.
- Container padding: `p-3` on mobile → `p-4`/`p-6` on desktop.

### Modals & Dialogs

- On mobile (< 768px): modals become **full-screen overlays** with a close button in top-right corner.
- On tablet+: centered modal with backdrop (current behavior, if any).

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Landscape phone (< 640px height) | Bottom nav compresses; content scrolls freely. Avoid fixed-height panels. |
| Very narrow screens (< 320px) | Minimum supported width: 320px. Below that, horizontal scroll is acceptable. |
| Orientation change | Layout reflows automatically via CSS breakpoints. No JS listener needed for layout. |
| Large DAG on mobile | Contained in scrollable/zoomable viewport. Show simplified node labels. |
| Long process logs | Virtualized scrolling maintained. Full-width on mobile. |
| Offline / WS disconnect | Existing WS status indicator remains visible in top bar (not hidden on mobile). |
| Deep links (hash routes) | Work identically — `#repos`, `#processes`, `#wiki` open the correct view on any screen size. |

---

## Visual Design Considerations

- **No new icons needed** — reuse existing Tailwind/heroicon set.
- **Bottom navigation bar**: use filled icons for active tab, outlined for inactive (standard mobile pattern).
- **Back navigation**: left-arrow icon in top bar when in detail views on mobile.
- **Drawer overlay**: semi-transparent backdrop (bg-black/50) when sidebar drawer is open on mobile.
- **Smooth transitions**: sidebar drawer slide-in/out should animate (200ms ease-in-out).
- **Dark mode**: all responsive changes must work in both light and dark themes.

---

## Settings & Configuration

No new user-facing settings required. Responsiveness is automatic based on viewport width.

**Tailwind config change:** activate the unused `md-split` breakpoint or remove it in favor of standard `sm`/`md`/`lg` tokens.

---

## Discoverability

- The dashboard simply works on mobile — no feature flags or toggles.
- If the SPA is accessed from a mobile browser for the first time, no onboarding is needed; the layout should be self-explanatory.

---

## Implementation Priority

| Phase | Scope | Impact |
|-------|-------|--------|
| **P0 — Layout foundations** | Responsive sidebar pattern, bottom nav, stacked layouts for all three views | Dashboard becomes usable on mobile |
| **P1 — Touch & interaction** | 44px tap targets, bottom sheets for menus/popovers, swipe-to-dismiss drawer | Dashboard feels native on mobile |
| **P2 — Content polish** | Responsive typography, DAG zoom/pan, Mermaid scroll containers, full-screen modals | Polished mobile experience |
| **P3 — Stretch** | PWA manifest + service worker for offline shell, add-to-homescreen support | App-like experience |

---

## Out of Scope

- Native mobile app (iOS/Android)
- Server-side rendering or separate mobile route
- Offline-first data sync (beyond basic PWA shell in P3)
- Redesigning the desktop layout — this spec only adds mobile adaptations
