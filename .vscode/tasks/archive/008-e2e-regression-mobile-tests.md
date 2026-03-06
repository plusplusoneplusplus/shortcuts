---
status: done
---

# 008 — E2E Regression & Mobile Tests

**Commit:** 8 of 8 — Mobile-Responsive SPA Dashboard  
**Depends on:** 001-007 (all prior responsive commits)  
**Scope:** `packages/coc/test/e2e/mobile-responsive/`

---

## Goal

Add comprehensive E2E test coverage for the mobile-responsive SPA, organized into three categories:
1. **Desktop regression** — verify the desktop experience at 1280×800 is unchanged by responsive commits
2. **Mobile UI automation** — verify all mobile behaviors at 375×812 (iPhone-class viewport)
3. **Tablet layout** — verify hybrid behavior at 768×1024

Tests reuse the existing `server-fixture.ts` infrastructure (per-test server, seed helpers, `patchApiResponses`). No changes to `playwright.config.ts` needed — the new specs set viewport per-test via `page.setViewportSize()` or `test.use()`.

---

## Viewport Presets (from commit 001)

```ts
const MOBILE  = { width: 375,  height: 812  };
const TABLET  = { width: 768,  height: 1024 };
const DESKTOP = { width: 1280, height: 800  };
```

All spec files import these from a shared `viewports.ts` helper created as part of this commit.

---

## File Layout

```
packages/coc/test/e2e/mobile-responsive/
├── viewports.ts                       # Shared viewport constants
├── desktop-regression.spec.ts         # Category 1 — 12 tests
├── mobile-navigation.spec.ts          # Category 2 — 9 tests
├── mobile-processes.spec.ts           # Category 2 — 7 tests
├── mobile-repos.spec.ts              # Category 2 — 7 tests
├── mobile-wiki.spec.ts               # Category 2 — 7 tests
├── mobile-touch-interaction.spec.ts  # Category 2 — 6 tests
├── tablet-layout.spec.ts             # Category 3 — 7 tests
└── cross-viewport-deeplinks.spec.ts  # Cross-cutting — 6 tests
```

**Total: ~61 tests across 8 spec files + 1 shared helper.**

---

## Shared Helper: `viewports.ts`

```ts
// packages/coc/test/e2e/mobile-responsive/viewports.ts
export const MOBILE  = { width: 375,  height: 812  };
export const TABLET  = { width: 768,  height: 1024 };
export const DESKTOP = { width: 1280, height: 800  };
```

All spec files import from `./viewports` and use `page.setViewportSize()` or `test.use({ viewport: ... })` at the describe level.

---

## Category 1: Desktop Regression Tests

### File: `desktop-regression.spec.ts`

Uses `test.use({ viewport: DESKTOP })` at the top level so every test runs at 1280×800.

Imports: `test, expect` from `../fixtures/server-fixture`, `seedWorkspace`, `seedProcess`, `seedProcesses` from `../fixtures/seed`, `DESKTOP` from `./viewports`.

#### Test Cases

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `desktop: ProcessesView shows 320px sidebar and detail side-by-side` | Navigate to `#processes`, seed 3 processes. Assert `aside` in `#view-processes` has `w-[320px]` class (or computed width ~320px via `boundingBox()`). Assert `.process-item` list visible alongside `#detail-content` or `#detail-empty`. |
| 2 | `desktop: ProcessesView sidebar + detail are both visible` | Seed 1 process, navigate to `#processes`, click `.process-item`. Assert both sidebar (`aside` with `.process-item`) and `#detail-content` are simultaneously visible (both have `boundingBox()` with width > 0). |
| 3 | `desktop: ReposView shows 280px sidebar` | Navigate to repos, seed 1 workspace. Assert `#repos-sidebar` has computed width ~280px (via `boundingBox()`). Assert `#repos-sidebar` does NOT have `w-12` class. |
| 4 | `desktop: ReposView sidebar collapses to 48px` | Navigate to repos, click `#hamburger-btn`. Assert `#repos-sidebar` has `w-12` or `min-w-[48px]` class. Assert `MiniReposSidebar` renders (icon-only sidebar). |
| 5 | `desktop: ReposView two-pane layout with repo selected` | Seed workspace, select repo. Assert `#repos-sidebar` and `#repo-detail-content` both visible simultaneously. |
| 6 | `desktop: WikiView shows wiki list in grid layout` | Navigate to `#wiki`. Assert `#view-wiki` renders. Assert wiki cards use grid layout (multiple columns at desktop width). |
| 7 | `desktop: TopBar shows text tab labels` | Navigate to any page. Assert `[data-tab="repos"]`, `[data-tab="processes"]`, `[data-tab="wiki"]` are all visible and contain text "Repos", "Processes", "Wiki". Assert NO bottom navigation bar is present (`[data-testid="bottom-nav"]` has count 0 or is hidden). |
| 8 | `desktop: no bottom navigation visible` | Navigate to any page. Assert bottom nav element (`[data-testid="bottom-nav"]` or `nav.bottom-nav`) either does not exist or is hidden. |
| 9 | `desktop: dialog renders as centered modal, not full-screen` | Navigate to repos, click `#add-repo-btn`. Assert `#add-repo-overlay` is visible. Assert overlay width < viewport width (not full-screen) via `boundingBox()`. Assert overlay is horizontally centered (left offset > 0). |
| 10 | `desktop: tab navigation works across all tabs` | Click `[data-tab="repos"]` → assert `#view-repos` visible. Click `[data-tab="processes"]` → assert `#view-processes` visible. Click `[data-tab="wiki"]` → assert `#view-wiki` visible. |
| 11 | `desktop: deep links resolve correctly` | Navigate to `${serverUrl}/#repos` → assert repos view. Navigate to `${serverUrl}/#processes` → assert processes view. Navigate to `${serverUrl}/#wiki` → assert wiki view. |
| 12 | `desktop: admin panel renders as grid` | Navigate to admin via `#admin-toggle`. Assert `#view-admin` visible. Assert admin stat cards (`#admin-stat-processes`, `#admin-stat-wikis`, `#admin-stat-disk`) are laid out in a grid (all three have `boundingBox().y` approximately equal, meaning same row). |

#### Playwright Patterns

```ts
test.use({ viewport: DESKTOP });

test('desktop: ProcessesView shows 320px sidebar and detail side-by-side', async ({ page, serverUrl }) => {
    await seedProcesses(serverUrl, 3);
    await page.goto(`${serverUrl}/#processes`);
    
    const sidebar = page.locator('#view-processes aside');
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box!.width).toBeCloseTo(320, -1); // within 10px
    
    // Detail pane should also be visible
    await expect(page.locator('#view-processes main')).toBeVisible();
});

test('desktop: dialog renders as centered modal, not full-screen', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await page.click('#add-repo-btn');
    
    const overlay = page.locator('#add-repo-overlay');
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box!.width).toBeLessThan(1280); // not full-screen
    expect(box!.x).toBeGreaterThan(0); // has left margin (centered)
});
```

---

## Category 2: Mobile UI Automation Tests

All mobile spec files use `test.use({ viewport: MOBILE })`.

### File: `mobile-navigation.spec.ts`

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `mobile: bottom nav visible with 3 tabs` | Navigate to SPA. Assert `[data-testid="bottom-nav"]` is visible. Assert it contains exactly 3 tab buttons (Repos, Processes, Wiki). |
| 2 | `mobile: bottom nav tabs have correct labels` | Assert bottom nav buttons contain text "Repos", "Processes", "Wiki" (may be icon+label or label-only). |
| 3 | `mobile: TopBar is compact, no text tab buttons` | Assert `#tab-bar` is hidden or its tab buttons are hidden at mobile width. Assert TopBar exists but does NOT show clickable text tabs. |
| 4 | `mobile: tapping bottom nav Processes switches view` | Tap Processes in bottom nav. Assert `#view-processes` is visible. Assert hash updates to `#processes`. |
| 5 | `mobile: tapping bottom nav Wiki switches view` | Tap Wiki in bottom nav. Assert `#view-wiki` or wiki content is visible. |
| 6 | `mobile: tapping bottom nav Repos switches view` | Start on processes, tap Repos in bottom nav. Assert `#view-repos` is visible. |
| 7 | `mobile: bottom nav highlights active tab` | Navigate to processes. Assert the Processes bottom nav button has active styling class. Tap Wiki. Assert Wiki button now has active class, Processes does not. |
| 8 | `mobile: TopBar shows compact title` | Assert TopBar header is visible but title may be truncated or abbreviated. Assert hamburger button exists. |
| 9 | `mobile: no desktop tab bar visible` | Assert `#tab-bar` buttons are not visible (display:none or visibility:hidden at 375px). Verify via `isVisible()` returning false or `toBeHidden()`. |

#### Playwright Patterns

```ts
test.use({ viewport: MOBILE });

test('mobile: bottom nav visible with 3 tabs', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toBeVisible();
    
    const tabs = bottomNav.locator('button');
    await expect(tabs).toHaveCount(3);
});

test('mobile: tapping bottom nav Processes switches view', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.locator('button', { hasText: /Processes/i }).tap();
    
    await expect(page.locator('#view-processes')).toBeVisible();
    expect(page.url()).toContain('#processes');
});
```

### File: `mobile-processes.spec.ts`

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `mobile: process list is full-width, no sidebar` | Seed 3 processes, navigate to `#processes`. Assert process list container spans full viewport width (no 320px sidebar). Assert `#view-processes aside` is either hidden or has width 0 at mobile. |
| 2 | `mobile: process list shows all seeded items` | Seed 5 processes. Assert `.process-item` count is 5. |
| 3 | `mobile: tap process opens full-screen detail with back button` | Seed 1 process, tap `.process-item`. Assert detail view (`#detail-content` or `[data-testid="process-detail"]`) is visible and spans full width. Assert a back button (`[data-testid="back-button"]` or `button` with aria-label "Back") is visible. |
| 4 | `mobile: back button returns to process list` | Open process detail (from test 3), tap back button. Assert process list is visible again. Assert detail view is hidden. |
| 5 | `mobile: filters in collapsible accordion` | Navigate to `#processes`. Assert filter controls are in a collapsible section. Tap the filter toggle/accordion header. Assert filter options expand (become visible). |
| 6 | `mobile: search input is full-width` | Navigate to `#processes`. Assert `#search-input` is visible and its width is close to viewport width (within padding). |
| 7 | `mobile: status filter works on mobile` | Seed running + completed processes. Select status filter "running". Assert only running process items are shown. |

#### Playwright Patterns

```ts
test.use({ viewport: MOBILE });

test('mobile: process list is full-width, no sidebar', async ({ page, serverUrl }) => {
    await seedProcesses(serverUrl, 3);
    await page.goto(`${serverUrl}/#processes`);
    
    await expect(page.locator('.process-item')).toHaveCount(3, { timeout: 5000 });
    
    // Sidebar should be hidden or have 0 width at mobile
    const sidebar = page.locator('#view-processes aside');
    if (await sidebar.count() > 0) {
        const box = await sidebar.boundingBox();
        // Either hidden (null box) or zero width
        if (box) expect(box.width).toBe(0);
    }
    
    // Process list should span close to full viewport width
    const list = page.locator('.process-item').first();
    const listBox = await list.boundingBox();
    expect(listBox!.width).toBeGreaterThan(300); // ≈375px minus padding
});

test('mobile: tap process opens full-screen detail with back button', async ({ page, serverUrl }) => {
    await seedProcess(serverUrl, 'mobile-detail', { promptPreview: 'Mobile Detail Test' });
    await page.goto(`${serverUrl}/#processes`);
    
    await expect(page.locator('.process-item')).toHaveCount(1, { timeout: 5000 });
    await page.locator('.process-item').first().tap();
    
    // Detail should be full-screen
    const detail = page.locator('#detail-content');
    await expect(detail).toBeVisible();
    const detailBox = await detail.boundingBox();
    expect(detailBox!.width).toBeGreaterThan(350); // full viewport
    
    // Back button must be present
    await expect(page.locator('[data-testid="back-button"]')).toBeVisible();
});
```

### File: `mobile-repos.spec.ts`

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `mobile: repos show as full-width card list` | Seed 2 workspaces, navigate to repos. Assert `.repo-item` or `.repo-card` elements span close to full viewport width. Assert no sidebar panel visible. |
| 2 | `mobile: tap repo card opens full-screen RepoDetail with back button` | Seed 1 workspace, tap repo card. Assert `#repo-detail-content` is visible and full-width. Assert back button is visible. |
| 3 | `mobile: back button returns to card list` | From repo detail, tap back button. Assert repo card list is visible again. Assert detail view is hidden. |
| 4 | `mobile: sub-tabs scroll horizontally` | Seed workspace, open repo detail. Assert sub-tab container (`.repo-sub-tab` parent) has `overflow-x: auto` or `scroll` behavior. Assert all sub-tabs exist in the DOM (info, pipelines, tasks, queue, schedules, chat). |
| 5 | `mobile: add repo button visible on mobile` | Navigate to repos. Assert `#add-repo-btn` is visible. |
| 6 | `mobile: add repo dialog opens full-screen` | Tap `#add-repo-btn`. Assert `#add-repo-overlay` is visible with width close to viewport width (full-screen). |
| 7 | `mobile: empty state renders correctly` | Navigate to repos with no seeded workspaces. Assert `#repos-empty` is visible and readable. |

#### Playwright Patterns

```ts
test.use({ viewport: MOBILE });

test('mobile: tap repo card opens full-screen RepoDetail with back button', async ({ page, serverUrl }) => {
    await seedWorkspace(serverUrl, 'ws-mobile', 'test-repo', '/tmp/test-repo');
    await page.goto(serverUrl);
    
    // Navigate to repos (via bottom nav on mobile)
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    if (await bottomNav.isVisible()) {
        await bottomNav.locator('button', { hasText: /Repos/i }).tap();
    } else {
        await page.click('[data-tab="repos"]');
    }
    
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
    await page.locator('.repo-item').first().tap();
    
    await expect(page.locator('#repo-detail-content')).toBeVisible();
    const detailBox = await page.locator('#repo-detail-content').boundingBox();
    expect(detailBox!.width).toBeGreaterThan(350);
    
    // Back button
    await expect(page.locator('[data-testid="back-button"]')).toBeVisible();
});

test('mobile: sub-tabs scroll horizontally', async ({ page, serverUrl }) => {
    await seedWorkspace(serverUrl, 'ws-subtab', 'subtab-repo', '/tmp/subtab');
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('.repo-item')).toHaveCount(1, { timeout: 10000 });
    await page.locator('.repo-item').first().tap();
    await expect(page.locator('#repo-detail-content')).toBeVisible();
    
    // Sub-tab bar should have horizontal scroll
    const subTabBar = page.locator('.repo-sub-tabs, [data-testid="sub-tab-bar"]');
    const overflowX = await subTabBar.evaluate(el => getComputedStyle(el).overflowX);
    expect(['auto', 'scroll']).toContain(overflowX);
});
```

### File: `mobile-wiki.spec.ts`

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `mobile: wiki list stacks to single column` | Navigate to `#wiki`. Assert wiki card grid renders in a single column (all cards have approximately the same x position or cards are stacked vertically). |
| 2 | `mobile: wiki detail shows full-width article` | Seed wiki, navigate to `#wiki/:id`. Assert article content spans full viewport width. Assert sidebar/component-tree is hidden. |
| 3 | `mobile: TOC button opens bottom sheet` | On wiki detail browse view, assert a TOC toggle button is visible. Tap it. Assert a bottom sheet or drawer appears containing the component tree / table of contents. |
| 4 | `mobile: bottom sheet TOC can be dismissed` | Open TOC bottom sheet (from test 3), tap close/dismiss. Assert bottom sheet is hidden. Article content visible. |
| 5 | `mobile: Ask tab shows full-screen chat` | Navigate to wiki Ask tab (`#wiki/:id/ask`). Assert chat input and message area span full width. |
| 6 | `mobile: wiki card tap navigates to detail` | Seed wiki, tap wiki card. Assert `WikiDetail` renders (wiki component tree or article content visible). |
| 7 | `mobile: back from wiki detail returns to list` | From wiki detail, tap back. Assert wiki list is visible again. |

#### Playwright Patterns

```ts
test.use({ viewport: MOBILE });

test('mobile: wiki list stacks to single column', async ({ page, serverUrl }) => {
    // Seed a wiki (need wiki fixture for real data, or use mock)
    await page.goto(`${serverUrl}/#wiki`);
    await expect(page.locator('#view-wiki')).toBeVisible();
    
    // If wiki cards exist, verify single-column layout
    const cards = page.locator('[data-testid="wiki-card"]');
    if (await cards.count() > 1) {
        const box1 = await cards.nth(0).boundingBox();
        const box2 = await cards.nth(1).boundingBox();
        // Single column: cards stacked vertically (same x, different y)
        expect(Math.abs(box1!.x - box2!.x)).toBeLessThan(10);
        expect(box2!.y).toBeGreaterThan(box1!.y);
    }
});

test('mobile: wiki detail shows full-width article', async ({ page, serverUrl }) => {
    // Navigate to a wiki detail via deep link
    await seedWiki(serverUrl, 'wiki-mobile', '/tmp/wiki-dir', '/tmp/repo');
    await page.goto(`${serverUrl}/#wiki/wiki-mobile`);
    
    // Article area should be full-width
    const article = page.locator('[data-testid="wiki-article"], .wiki-article-content, main');
    await expect(article.first()).toBeVisible({ timeout: 10000 });
    const box = await article.first().boundingBox();
    expect(box!.width).toBeGreaterThan(340);
    
    // Component tree sidebar should be hidden
    const sidebar = page.locator('[data-testid="wiki-sidebar"], .wiki-component-tree');
    if (await sidebar.count() > 0) {
        await expect(sidebar.first()).toBeHidden();
    }
});
```

### File: `mobile-touch-interaction.spec.ts`

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `mobile: all bottom nav buttons meet 44px min touch target` | Assert each bottom nav button has `boundingBox().height >= 44`. |
| 2 | `mobile: process list items meet 44px min tap height` | Seed processes. Assert each `.process-item` has `boundingBox().height >= 44`. |
| 3 | `mobile: repo card items meet 44px min tap height` | Seed workspaces. Assert each `.repo-item` (or `.repo-card`) has `boundingBox().height >= 44`. |
| 4 | `mobile: dialog renders full-screen` | Open add-repo dialog. Assert `#add-repo-overlay` width ≈ viewport width (within padding tolerance). Assert height covers most of viewport. |
| 5 | `mobile: sidebar drawer opens and closes` | Assert hamburger button is visible. Tap it. Assert sidebar/drawer animates open (sidebar element becomes visible or gets open class). Tap close or hamburger again. Assert sidebar/drawer is closed. |
| 6 | `mobile: back button has adequate touch target` | Open a detail view (process or repo). Assert back button `boundingBox().height >= 44` and `width >= 44`. |

#### Playwright Patterns

```ts
test.use({ viewport: MOBILE });

test('mobile: all bottom nav buttons meet 44px min touch target', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toBeVisible();
    
    const buttons = bottomNav.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
        const box = await buttons.nth(i).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
    }
});

test('mobile: dialog renders full-screen', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await page.click('#add-repo-btn');
    
    const overlay = page.locator('#add-repo-overlay');
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    
    // Full-screen: width within 20px of viewport
    expect(box!.width).toBeGreaterThan(355);
    // Height covers most of viewport
    expect(box!.height).toBeGreaterThan(700);
});
```

---

## Category 3: Tablet Tests

### File: `tablet-layout.spec.ts`

Uses `test.use({ viewport: TABLET })`.

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `tablet: sidebar is collapsible` | Navigate to repos. Assert sidebar is visible. Click hamburger. Assert sidebar collapses. Click again. Assert it expands. |
| 2 | `tablet: TopBar shows compact labels` | Assert TopBar tab buttons are visible but may have shorter labels or icon-only presentation at 768px. |
| 3 | `tablet: no bottom navigation visible` | Assert `[data-testid="bottom-nav"]` is not visible at tablet width. |
| 4 | `tablet: ProcessesView renders two-pane layout` | Seed processes, navigate to `#processes`. Assert sidebar and detail pane are both visible simultaneously. |
| 5 | `tablet: ReposView renders two-pane layout` | Seed workspace, navigate to repos, select repo. Assert sidebar and detail both visible. |
| 6 | `tablet: dialog renders as centered modal` | Open add-repo dialog. Assert overlay width < viewport width. Assert it is centered. |
| 7 | `tablet: wiki list uses multi-column grid` | Navigate to `#wiki`. If wiki cards present, assert they render in 2+ columns (cards in same row have different x positions). |

#### Playwright Patterns

```ts
test.use({ viewport: TABLET });

test('tablet: no bottom navigation visible', async ({ page, serverUrl }) => {
    await page.goto(serverUrl);
    
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    if (await bottomNav.count() > 0) {
        await expect(bottomNav).toBeHidden();
    }
});

test('tablet: ProcessesView renders two-pane layout', async ({ page, serverUrl }) => {
    await seedProcesses(serverUrl, 2);
    await page.goto(`${serverUrl}/#processes`);
    
    await expect(page.locator('.process-item')).toHaveCount(2, { timeout: 5000 });
    
    const sidebar = page.locator('#view-processes aside');
    const main = page.locator('#view-processes main');
    await expect(sidebar).toBeVisible();
    await expect(main).toBeVisible();
    
    const sidebarBox = await sidebar.boundingBox();
    const mainBox = await main.boundingBox();
    // Both visible side by side
    expect(sidebarBox!.width).toBeGreaterThan(200);
    expect(mainBox!.width).toBeGreaterThan(300);
});
```

---

## Cross-Viewport Deep Link Tests

### File: `cross-viewport-deeplinks.spec.ts`

Tests that hash-based routing works correctly at all viewport sizes.

| # | Test Name | What It Asserts |
|---|-----------|-----------------|
| 1 | `deeplinks: #repos resolves at mobile viewport` | Set mobile viewport, navigate to `#repos`. Assert repos view renders. |
| 2 | `deeplinks: #processes/:id resolves at mobile viewport` | Set mobile viewport, seed process, navigate to `#processes/:id`. Assert process detail renders (full-screen on mobile). |
| 3 | `deeplinks: #repos/:id resolves at mobile viewport` | Set mobile viewport, seed workspace, navigate to `#repos/:id`. Assert repo detail renders (full-screen on mobile). |
| 4 | `deeplinks: #wiki/:id resolves at mobile viewport` | Set mobile viewport, seed wiki, navigate to `#wiki/:id`. Assert wiki detail renders. |
| 5 | `deeplinks: #repos/:id/:subTab resolves at desktop viewport` | Set desktop viewport, seed workspace, navigate to `#repos/:id/pipelines`. Assert repo detail with pipelines sub-tab active. |
| 6 | `deeplinks: #admin resolves at all viewports` | For each viewport (mobile, tablet, desktop): navigate to `#admin`, assert `#view-admin` is visible. |

#### Playwright Patterns

```ts
import { MOBILE, TABLET, DESKTOP } from './viewports';

test('deeplinks: #processes/:id resolves at mobile viewport', async ({ page, serverUrl }) => {
    await page.setViewportSize(MOBILE);
    await seedProcess(serverUrl, 'dl-mobile-proc', { promptPreview: 'DeepLink Test' });
    await page.goto(`${serverUrl}/#processes/dl-mobile-proc`);
    
    // Detail should render (on mobile, this is full-screen)
    await expect(page.locator('#detail-content')).toBeVisible({ timeout: 10000 });
});

test('deeplinks: #admin resolves at all viewports', async ({ page, serverUrl }) => {
    for (const vp of [MOBILE, TABLET, DESKTOP]) {
        await page.setViewportSize(vp);
        await page.goto(`${serverUrl}/#admin`);
        await expect(page.locator('#view-admin')).toBeVisible({ timeout: 5000 });
    }
});
```

---

## Implementation Notes

### Fixture Reuse

All tests reuse the existing infrastructure:
- `server-fixture.ts` — `test`, `expect` with per-test server
- `seed.ts` — `seedProcess`, `seedProcesses`, `seedWorkspace`, `seedWiki`, `request`
- `repo-fixtures.ts` — `createRepoFixture`, `createTasksFixture`

No new fixtures needed. Wiki tests that need loaded wiki data may need to use `seedWiki()` from `seed.ts` and point to a temporary directory with mock wiki artifacts (module-graph.json, articles).

### Locator Strategy

Use this priority order for locators:
1. `data-testid` attributes (e.g., `[data-testid="bottom-nav"]`, `[data-testid="back-button"]`)
2. `id` attributes (e.g., `#view-processes`, `#repos-sidebar`, `#add-repo-overlay`)
3. `data-tab` attributes (e.g., `[data-tab="repos"]`)
4. CSS class-based locators as fallback (e.g., `.process-item`, `.repo-item`)

New `data-testid` attributes that MUST be added to SPA components (in prior responsive commits):
- `data-testid="bottom-nav"` on the mobile bottom navigation bar
- `data-testid="back-button"` on mobile back buttons in detail views
- `data-testid="wiki-card"` on wiki list cards
- `data-testid="wiki-sidebar"` on wiki component tree sidebar
- `data-testid="wiki-article"` on wiki article content area
- `data-testid="sub-tab-bar"` on the repo sub-tab container
- `data-testid="toc-toggle"` on wiki TOC toggle button (mobile)
- `data-testid="toc-bottom-sheet"` on wiki TOC bottom sheet (mobile)

### Viewport Assertion Patterns

```ts
// Assert element width via boundingBox
const box = await page.locator('#element').boundingBox();
expect(box!.width).toBeCloseTo(320, -1); // within 10px

// Assert element is hidden at a viewport
await expect(page.locator('#desktop-only')).toBeHidden();

// Assert full-screen (width ≈ viewport)
expect(box!.width).toBeGreaterThan(viewport.width - 20);

// Assert touch target size
expect(box!.height).toBeGreaterThanOrEqual(44);

// Assert single-column layout (cards stacked)
const card1 = await cards.nth(0).boundingBox();
const card2 = await cards.nth(1).boundingBox();
expect(Math.abs(card1!.x - card2!.x)).toBeLessThan(10);

// Assert multi-column layout (cards side by side)
expect(Math.abs(card1!.y - card2!.y)).toBeLessThan(10);
expect(card2!.x).toBeGreaterThan(card1!.x + card1!.width - 10);
```

### Touch Interaction via Playwright

Use `.tap()` instead of `.click()` for mobile tests to simulate touch events:

```ts
// Mobile touch
await page.locator('.process-item').first().tap();

// Desktop click
await page.locator('.process-item').first().click();
```

Note: `.tap()` requires `hasTouch: true` in Playwright config or `test.use()`. Add to mobile tests:

```ts
test.use({ viewport: MOBILE, hasTouch: true });
```

### Config Compatibility

No changes to `playwright.config.ts` required. The existing config:
- `testMatch: '**/*.spec.ts'` — picks up `mobile-responsive/*.spec.ts` automatically
- `fullyParallel: true` — mobile tests run in parallel
- Chromium project uses `devices['Desktop Chrome']` — viewport override via `test.use()` per file

### Test Isolation

Each test gets its own fresh server instance (from `server-fixture.ts`). No shared state between tests. Viewport is set per describe block, not globally, so other E2E tests are unaffected.

---

## Validation Criteria

- [ ] All 61 tests pass on desktop Chrome
- [ ] `npx playwright test --project=chromium packages/coc/test/e2e/mobile-responsive/` runs clean
- [ ] Desktop regression tests confirm existing layouts unchanged
- [ ] Mobile tests confirm responsive behavior (full-screen detail, bottom nav, touch targets)
- [ ] Tablet tests confirm hybrid layout
- [ ] Deep link tests pass at all viewports
- [ ] No flakiness — tests use explicit `waitFor` / `toBeVisible` with timeouts
- [ ] No changes to existing E2E test files
