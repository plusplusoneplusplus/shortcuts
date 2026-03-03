/**
 * Tests for RepoDetail mobile responsiveness improvements.
 *
 * Validates header layout adapts for mobile (stacked title, overflow menu),
 * New Chat button deduplication, and tab scroll affordance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoDetail.tsx'),
    'utf-8',
);

describe('RepoDetail mobile: imports', () => {
    it('imports useBreakpoint hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useBreakpoint } from '../hooks/useBreakpoint'");
    });

    it('imports BottomSheet for mobile overflow menu', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { BottomSheet } from '../shared/BottomSheet'");
    });

    it('destructures isMobile from useBreakpoint', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const { isMobile } = useBreakpoint()');
    });
});

describe('RepoDetail mobile: header layout', () => {
    it('uses single-row flex layout on mobile (flex-row items-center)', () => {
        expect(REPO_DETAIL_SOURCE).toContain("isMobile ? 'flex-row items-center py-2'");
    });

    it('title row has truncate class to prevent overflow', () => {
        expect(REPO_DETAIL_SOURCE).toContain('truncate');
    });

    it('title row has min-w-0 for proper flex shrinking', () => {
        // The title row div has min-w-0 class
        const titleRowSection = REPO_DETAIL_SOURCE.split('\n').find(l => l.includes('Title row'));
        expect(titleRowSection).toBeDefined();
        const titleRowIdx = REPO_DETAIL_SOURCE.indexOf('Title row');
        const nearby = REPO_DETAIL_SOURCE.substring(titleRowIdx, titleRowIdx + 200);
        expect(nearby).toContain('min-w-0');
    });
});

describe('RepoDetail mobile: overflow menu', () => {
    it('renders more-menu button on mobile', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-menu-btn"');
    });

    it('more-menu button has ⋯ text', () => {
        const lines = REPO_DETAIL_SOURCE.split('\n');
        const btnIdx = lines.findIndex(l => l.includes('repo-more-menu-btn'));
        const nearby = lines.slice(btnIdx, btnIdx + 5).join('\n');
        expect(nearby).toContain('⋯');
    });

    it('uses BottomSheet for the overflow menu', () => {
        expect(REPO_DETAIL_SOURCE).toContain('<BottomSheet isOpen onClose=');
    });

    it('overflow menu has Queue Task action', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-queue-task"');
    });

    it('overflow menu has Generate Plan action', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-generate"');
    });

    it('overflow menu has Edit action', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-edit"');
    });

    it('overflow menu has Remove action', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-remove"');
    });

    it('more-menu container has data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-menu-container"');
    });

    it('overflow menu items container has data-testid', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-more-menu-items"');
    });

    it('Queue Task, Generate, Edit, Remove buttons are only rendered on non-mobile', () => {
        // These desktop-only buttons appear inside the !isMobile branch
        const desktopBranch = REPO_DETAIL_SOURCE.substring(
            REPO_DETAIL_SOURCE.indexOf('repo-more-menu-container'),
            REPO_DETAIL_SOURCE.indexOf('repo-edit-btn')
        );
        expect(desktopBranch).toContain(') : (');
    });

    it('moreMenuOpen state controls overflow menu visibility', () => {
        expect(REPO_DETAIL_SOURCE).toContain('moreMenuOpen');
        expect(REPO_DETAIL_SOURCE).toContain('setMoreMenuOpen');
    });

    it('closes more-menu on outside click', () => {
        expect(REPO_DETAIL_SOURCE).toContain('moreMenuRef.current && !moreMenuRef.current.contains');
    });

    it('click-outside mousedown listener is skipped on mobile', () => {
        expect(REPO_DETAIL_SOURCE).toContain('if (!moreMenuOpen || isMobile) return;');
    });
});

describe('RepoDetail mobile: New Chat button deduplication', () => {
    it('hides New Chat button on mobile when chat tab is active', () => {
        expect(REPO_DETAIL_SOURCE).toContain("isMobile && activeSubTab === 'chat'");
    });

    it('uses conditional rendering to hide (not CSS display:none)', () => {
        // It should use !(isMobile && chat) guard, not display class
        expect(REPO_DETAIL_SOURCE).toContain("!(isMobile && activeSubTab === 'chat')");
    });
});

describe('RepoDetail mobile: tab scroll affordance', () => {
    it('renders tab strip inside a container with relative positioning', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-sub-tab-strip-container"');
    });

    it('tracks tab scroll state with canScrollLeft and canScrollRight', () => {
        expect(REPO_DETAIL_SOURCE).toContain('canScrollLeft');
        expect(REPO_DETAIL_SOURCE).toContain('canScrollRight');
    });

    it('renders left scroll fade indicator', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="tab-scroll-fade-left"');
    });

    it('renders right scroll fade indicator', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="tab-scroll-fade-right"');
    });

    it('left fade uses gradient-to-r from white', () => {
        const leftFadeIdx = REPO_DETAIL_SOURCE.indexOf('tab-scroll-fade-left');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, leftFadeIdx - 300), leftFadeIdx);
        expect(nearby).toContain('bg-gradient-to-r');
    });

    it('right fade uses gradient-to-l from white', () => {
        const rightFadeIdx = REPO_DETAIL_SOURCE.indexOf('tab-scroll-fade-right');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, rightFadeIdx - 300), rightFadeIdx);
        expect(nearby).toContain('bg-gradient-to-l');
    });

    it('left fade is only shown when canScrollLeft is true', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabScrollState.canScrollLeft');
    });

    it('right fade is only shown when canScrollRight is true', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabScrollState.canScrollRight');
    });

    it('uses scroll event listener for tracking', () => {
        expect(REPO_DETAIL_SOURCE).toContain("addEventListener('scroll', updateTabScrollState");
    });

    it('uses ResizeObserver for tracking container size changes (with guard)', () => {
        expect(REPO_DETAIL_SOURCE).toContain("typeof ResizeObserver !== 'undefined'");
        expect(REPO_DETAIL_SOURCE).toContain('new ResizeObserver(updateTabScrollState)');
    });

    it('cleans up scroll listener and ResizeObserver on unmount', () => {
        expect(REPO_DETAIL_SOURCE).toContain("removeEventListener('scroll', updateTabScrollState)");
        expect(REPO_DETAIL_SOURCE).toContain('ro?.disconnect()');
    });

    it('fade indicators are pointer-events-none', () => {
        const leftFadeIdx = REPO_DETAIL_SOURCE.indexOf('tab-scroll-fade-left');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, leftFadeIdx - 300), leftFadeIdx);
        expect(nearby).toContain('pointer-events-none');
    });
});
