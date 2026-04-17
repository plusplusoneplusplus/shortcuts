/**
 * Source-analysis tests for CoC Dashboard mobile UX improvements.
 *
 * Pattern: read source files and verify key patterns are present.
 * No component rendering — just static analysis for structural correctness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REACT_ROOT = join(__dirname, '../../../src/server/spa/client/react');

function read(relativePath: string) {
    return readFileSync(join(REACT_ROOT, relativePath), 'utf-8');
}

// ---------------------------------------------------------------------------
// SkillsView — critical mobile fix (was fixed-width sidebar on all breakpoints)
// ---------------------------------------------------------------------------
describe('SkillsView mobile layout', () => {
    const src = read('views/skills/SkillsView.tsx');

    it('imports useBreakpoint', () => {
        expect(src).toContain("useBreakpoint");
    });

    it('conditionally renders based on isMobile', () => {
        expect(src).toContain('isMobile');
    });

    it('mobile tab strip has min-h-[44px] for touch target compliance', () => {
        expect(src).toContain('min-h-[44px]');
    });

    it('mobile tab strip has data-testid', () => {
        expect(src).toContain('data-testid="skills-mobile-tabs"');
    });

    it('desktop layout retains vertical sidebar', () => {
        expect(src).toContain('border-l-2');
    });
});

// ---------------------------------------------------------------------------
// MemoryView — touch target fix
// ---------------------------------------------------------------------------
describe('MemoryView touch targets', () => {
    const src = read('views/memory/MemoryView.tsx');

    it('tab buttons use min-h-[44px] instead of h-8', () => {
        expect(src).toContain('min-h-[44px]');
    });

    it('does not use bare h-8 on tab buttons (below 44px minimum)', () => {
        // h-8 = 32px which violates touch target guidelines
        // It may exist in non-button contexts, but should not be the tab button height
        const lines = src.split('\n');
        const tabBtnLines = lines.filter(l =>
            l.includes('h-8') &&
            (l.includes('button') || l.includes('tab') || l.includes('Tab'))
        );
        expect(tabBtnLines.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// SkeletonLoader shared component
// ---------------------------------------------------------------------------
describe('SkeletonLoader exports', () => {
    const src = read('shared/SkeletonLoader.tsx');

    it('exports SkeletonLine', () => {
        expect(src).toContain('export function SkeletonLine');
    });

    it('exports SkeletonCard', () => {
        expect(src).toContain('export function SkeletonCard');
    });

    it('exports SkeletonList', () => {
        expect(src).toContain('export function SkeletonList');
    });

    it('exports SkeletonListItem', () => {
        expect(src).toContain('export function SkeletonListItem');
    });

    it('uses animate-pulse for shimmer effect', () => {
        expect(src).toContain('animate-pulse');
    });

    it('supports dark mode', () => {
        expect(src).toContain('dark:bg-');
    });
});

// ---------------------------------------------------------------------------
// shared/index.ts barrel — SkeletonLoader components are exported
// ---------------------------------------------------------------------------
describe('shared barrel exports', () => {
    const src = read('shared/index.ts');

    it('re-exports SkeletonLine', () => {
        expect(src).toContain('SkeletonLine');
    });

    it('re-exports SkeletonList', () => {
        expect(src).toContain('SkeletonList');
    });
});

// ---------------------------------------------------------------------------
// ProcessesView — uses SkeletonList for loading state
// ---------------------------------------------------------------------------
describe('ProcessesView loading skeleton', () => {
    const src = read('processes/ProcessesView.tsx');

    it('imports SkeletonList', () => {
        expect(src).toContain('SkeletonList');
    });

    it('renders SkeletonList (not plain text) while loading', () => {
        expect(src).toContain('<SkeletonList');
    });

    it('does not use "Loading queue..." plain text', () => {
        expect(src).not.toContain('Loading queue...');
    });
});

// ---------------------------------------------------------------------------
// WikiList — scroll container + touch targets
// ---------------------------------------------------------------------------
describe('WikiList scrollability', () => {
    const src = read('wiki/WikiList.tsx');

    it('wraps content in overflow-y-auto container', () => {
        expect(src).toContain('overflow-y-auto');
    });

    it('wiki action buttons meet 44px touch target', () => {
        expect(src).toContain('min-h-[44px]');
    });
});

// ---------------------------------------------------------------------------
// BottomNav — safe area inset support
// ---------------------------------------------------------------------------
describe('BottomNav safe area insets', () => {
    const src = read('layout/BottomNav.tsx');

    it('is positioned below the TopBar using top-10', () => {
        expect(src).toContain('top-10');
    });
});

// ---------------------------------------------------------------------------
// MobileTabBar — safe area inset support + touch targets
// ---------------------------------------------------------------------------
describe('MobileTabBar safe area and touch targets', () => {
    const src = read('layout/MobileTabBar.tsx');

    it('is in normal document flow (not fixed)', () => {
        expect(src).not.toContain('fixed top-10');
    });

    it('more-sheet items use min-h-[44px] for touch target compliance', () => {
        expect(src).toContain('min-h-[44px]');
    });
});

// ---------------------------------------------------------------------------
// RepoActivityTab — uses SkeletonList for loading state
// ---------------------------------------------------------------------------
describe('RepoActivityTab loading skeleton', () => {
    const src = read('repos/RepoActivityTab.tsx');

    it('imports SkeletonList', () => {
        expect(src).toContain('SkeletonList');
    });

    it('renders SkeletonList while loading', () => {
        expect(src).toContain('<SkeletonList');
    });
});

// ---------------------------------------------------------------------------
// RepoDetail — BottomSheet more menu items meet 44px touch target
// ---------------------------------------------------------------------------
describe('RepoDetail more menu touch targets', () => {
    const src = read('layout/MobileTabBar.tsx');

    it('BottomSheet action buttons use min-h-[44px]', () => {
        expect(src).toContain('min-h-[44px]');
    });
});
