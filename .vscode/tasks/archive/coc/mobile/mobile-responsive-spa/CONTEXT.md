# Context: Mobile-Responsive CoC SPA Dashboard

## User Story
As a developer who monitors AI pipeline executions from a phone or tablet, I want the CoC SPA dashboard to adapt its layout to smaller screens, so that I can check pipeline status, browse wiki articles, and manage repos on the go. Two critical requirements: (1) no regression to the existing desktop UI, and (2) fully automated tests for all mobile UI behaviors.

## Goal
Make the CoC SPA dashboard (React + Tailwind, at `packages/coc/src/server/spa/`) fully usable on phones (360–430px) and tablets (768–1024px) while preserving the current desktop experience exactly, with comprehensive test coverage for both regression and new mobile functionality.

## Commit Sequence
1. Responsive foundation — Tailwind config, `useBreakpoint` hook, test utilities
2. Responsive sidebar component + swipe-to-dismiss drawer
3. Bottom navigation bar + TopBar responsiveness
4. ProcessesView mobile layout (master-detail pattern)
5. ReposView mobile layout (master-detail + scrollable sub-tabs)
6. WikiView mobile layout (full-screen articles, BottomSheet TOC)
7. Touch targets, full-screen modals, responsive typography
8. Comprehensive E2E test suite (desktop regression + mobile automation)

## Key Decisions
- Mobile-first Tailwind: default styles target mobile, `md:`/`lg:` for wider screens
- Standard breakpoints: mobile < 768px, tablet 768–1023px, desktop ≥ 1024px
- Master-detail navigation on mobile (list → detail → back) rather than side-by-side panes
- Bottom nav bar on mobile (tabs move from TopBar), following mobile platform conventions
- z-index layering: BottomNav (8000) < Sidebar drawer (9000) < BottomSheet (9500) < Dialog (10002)
- Every commit includes unit tests; commit 008 adds dedicated E2E regression + mobile suites

## Conventions
- Responsive hook: `useBreakpoint()` returns `{ isMobile, isTablet, isDesktop }`
- Shared `ResponsiveSidebar` component replaces all hard-coded sidebar widths
- Shared `BottomSheet` component for mobile popovers/TOC
- Test helpers: `mockViewport(width)` for jsdom, Playwright viewport presets object
- `data-testid` attributes on key elements for E2E locators
