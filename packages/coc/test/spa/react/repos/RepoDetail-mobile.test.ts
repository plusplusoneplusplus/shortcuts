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

    it('no longer imports BottomSheet (mobile menu moved to MobileTabBar)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain("import { BottomSheet } from '../shared/BottomSheet'");
    });

    it('destructures isMobile from useBreakpoint', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const { isMobile } = useBreakpoint()');
    });
});

describe('RepoDetail mobile: header layout', () => {
    it('header only renders on desktop (!isMobile)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('!isMobile && (');
        expect(REPO_DETAIL_SOURCE).toContain('repo-detail-header');
    });

    it('desktop layout: tabs come before action buttons (title | tabs | splitter | buttons)', () => {
        // On desktop, the tab strip container appears before the action buttons
        const tabStripIdx = REPO_DETAIL_SOURCE.indexOf('repo-sub-tab-strip-container');
        const splitterIdx = REPO_DETAIL_SOURCE.indexOf('repo-header-splitter');
        const runScriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(tabStripIdx).toBeGreaterThan(-1);
        expect(splitterIdx).toBeGreaterThan(tabStripIdx);
        expect(runScriptBtnIdx).toBeGreaterThan(splitterIdx);
    });

    it('renders a vertical splitter between tabs and action buttons on desktop', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-splitter"');
    });

    it('mobile header has no title row (repo name shown in TopBar)', () => {
        // Title row was removed — repo name is now in TopBar
        expect(REPO_DETAIL_SOURCE).not.toContain('Title row');
    });
});

describe('RepoDetail mobile: overflow menu moved to MobileTabBar', () => {
    it('no longer renders inline more-menu button (moved to MobileTabBar actions)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-btn"');
    });

    it('no longer has inline BottomSheet for the overflow menu', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('<BottomSheet isOpen onClose=');
    });

    it('overflow menu no longer has Queue Task action (removed from menu)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-queue-task"');
    });

    it('overflow menu no longer has Generate Plan action (removed from menu)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-generate"');
    });

    it('overflow menu does not have Edit action (removed from menu)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-edit"');
    });

    it('overflow menu does not have Remove action (removed from menu)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-remove"');
    });

    it('no longer has inline more-menu container', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-container"');
    });

    it('no longer has inline overflow menu items container', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-items"');
    });

    it('Queue Task and Generate Plan buttons are removed from the header', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-queue-task-btn');
        expect(REPO_DETAIL_SOURCE).not.toContain('repo-generate-btn');
    });

    it('no longer has moreMenuOpen state (overflow menu moved to MobileTabBar)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('moreMenuOpen');
        expect(REPO_DETAIL_SOURCE).not.toContain('setMoreMenuOpen');
    });

    it('no longer has click-outside handler for more-menu', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('moreMenuRef.current && !moreMenuRef.current.contains');
    });

    it('passes actions prop to MobileTabBar with Run Script', () => {
        expect(REPO_DETAIL_SOURCE).toContain("label: 'Run Script'");
        expect(REPO_DETAIL_SOURCE).toContain("icon: '⚡'");
    });
});

describe('RepoDetail mobile: New Chat button removed from header', () => {
    it('does not render New Chat button (removed in Activity cutover)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-new-chat-btn"');
    });

    it('does not have chat deduplication guard (no longer needed)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain("!(isMobile && activeSubTab === 'chat')");
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

describe('RepoDetail mobile: back button removed (repo switching via TopBar)', () => {
    it('does not render a back button (repo name is in TopBar)', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-back-btn"');
        expect(REPO_DETAIL_SOURCE).not.toContain('aria-label="Back to repos"');
    });
});

describe('RepoDetail mobile: MobileTabBar integration', () => {
    it('imports MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { MobileTabBar } from '../layout/MobileTabBar'");
    });

    it('renders MobileTabBar only on mobile', () => {
        expect(REPO_DETAIL_SOURCE).toContain('isMobile && (');
        expect(REPO_DETAIL_SOURCE).toContain('<MobileTabBar');
    });

    it('passes activeTab to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('activeTab={activeSubTab}');
    });

    it('passes onTabChange to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('onTabChange={switchSubTab}');
    });

    it('passes VISIBLE_SUB_TABS list to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabs={VISIBLE_SUB_TABS}');
    });

    it('passes badge counts to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('taskCount={tasksRunning + tasksQueued}');
        expect(REPO_DETAIL_SOURCE).toContain('activityCount={');
    });

    it('hides top tab strip on mobile', () => {
        // Tab strip is in the desktop-only branch of the top-level isMobile ternary (not wrapped in !isMobile && ())
        expect(REPO_DETAIL_SOURCE).toContain('repo-sub-tab-strip-container');
        // The old !isMobile guard wrapper is no longer present (now in desktop ternary branch)
        const noMobileGuardIdx = REPO_DETAIL_SOURCE.indexOf('!isMobile && (');
        // If present at all, it should NOT be just before the tab strip container
        if (noMobileGuardIdx !== -1) {
            const afterGuard = REPO_DETAIL_SOURCE.substring(noMobileGuardIdx, noMobileGuardIdx + 100);
            expect(afterGuard).not.toContain('repo-sub-tab-strip-container');
        }
    });
});
