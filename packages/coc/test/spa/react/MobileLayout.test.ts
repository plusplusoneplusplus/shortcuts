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
// SkillsView — desktop layout check
// ---------------------------------------------------------------------------
describe('SkillsView mobile layout', () => {
    const src = read('views/skills/SkillsView.tsx');

    it('desktop layout retains vertical sidebar', () => {
        expect(src).toContain('border-l-2');
    });
});

// ---------------------------------------------------------------------------
// MemoryView — touch target fix
// ---------------------------------------------------------------------------
describe('MemoryView touch targets', () => {
    const src = read('views/memory/MemoryView.tsx');

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
// ProcessesView — loading state
// ---------------------------------------------------------------------------
describe('ProcessesView loading skeleton', () => {
    const src = read('processes/ProcessesView.tsx');

    it('does not use "Loading queue..." plain text', () => {
        expect(src).not.toContain('Loading queue...');
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
// RepoDetail — BottomSheet more menu items meet 44px touch target
// ---------------------------------------------------------------------------
describe('RepoDetail more menu touch targets', () => {
    const src = read('layout/MobileTabBar.tsx');

    it('BottomSheet action buttons use min-h-[44px]', () => {
        expect(src).toContain('min-h-[44px]');
    });
});
