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
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

describe('RepoDetail mobile: imports', () => {
    it('imports useBreakpoint hook', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useBreakpoint } from '../../hooks/ui/useBreakpoint'");
    });

    it('imports MobileTabBar for mobile actions', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { MobileTabBar } from '../../layout/MobileTabBar'");
    });

    it('destructures isMobile from useBreakpoint', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const { isMobile } = useBreakpoint()');
    });
});

describe('RepoDetail mobile: header layout', () => {
    it('desktop header is guarded with !isMobile and uses flex-row layout', () => {
        // Header is desktop-only — not rendered on mobile (and suppressed when the
        // remote-first shell renders its own RemoteSubBar, hence !chromeless).
        expect(REPO_DETAIL_SOURCE).toContain('!isMobile && !chromeless && (');
        expect(REPO_DETAIL_SOURCE).toContain('repo-detail-header');
        // Desktop header always uses flex-row (no mobile variant needed)
        expect(REPO_DETAIL_SOURCE).toContain('flex flex-row items-center');
    });

    it('desktop layout: tabs come before action buttons (title | tabs | splitter | buttons)', () => {
        // On desktop, the tab strip container appears before the action buttons
        const tabStripIdx = REPO_DETAIL_SOURCE.indexOf('repo-sub-tab-strip-container');
        const splitterIdx = REPO_DETAIL_SOURCE.indexOf('repo-header-splitter');
        const scriptBtnIdx = REPO_DETAIL_SOURCE.indexOf('repo-run-script-btn');
        expect(tabStripIdx).toBeGreaterThan(-1);
        expect(splitterIdx).toBeGreaterThan(tabStripIdx);
        expect(scriptBtnIdx).toBeGreaterThan(splitterIdx);
    });

    it('renders a vertical splitter between tabs and action buttons on desktop', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-header-splitter"');
    });

    it('title row has truncate class to prevent overflow', () => {
        expect(REPO_DETAIL_SOURCE).toContain('truncate');
    });

    it('title row has min-w-0 for proper flex shrinking', () => {
        // The mobile leading slot button has min-w-0 so the repo name truncates correctly
        const leadingSlotIdx = REPO_DETAIL_SOURCE.indexOf('mobileLeadingSlot');
        expect(leadingSlotIdx).toBeGreaterThan(-1);
        const nearby = REPO_DETAIL_SOURCE.substring(leadingSlotIdx, leadingSlotIdx + 500);
        expect(nearby).toContain('min-w-0');
    });
});

describe('RepoDetail mobile: overflow menu removed', () => {
    it('does not render old more-menu button', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-btn"');
    });

    it('does not use BottomSheet', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('<BottomSheet');
    });

    it('does not have old overflow menu Run Script option', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-run-script"');
    });

    it('does not have Edit action', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-edit"');
    });

    it('does not have Remove action', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-remove"');
    });

    it('does not have more-menu container', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-container"');
    });

    it('does not have more-menu items container', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-more-menu-items"');
    });

    it('does not use moreMenuOpen state', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('moreMenuOpen');
        expect(REPO_DETAIL_SOURCE).not.toContain('setMoreMenuOpen');
    });

    it('does not have moreMenuRef click-outside handler', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('moreMenuRef');
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

describe('RepoDetail mobile: tappable repo name (back navigation)', () => {
    it('does not render the old chevron-left back button', () => {
        expect(REPO_DETAIL_SOURCE).not.toContain('data-testid="repo-back-btn"');
    });

    it('renders tappable repo name with data-testid="repo-name-back"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('data-testid="repo-name-back"');
    });

    it('tappable repo name is only shown on mobile (gated on isMobile)', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, nameBackIdx - 1000), nameBackIdx);
        expect(nearby).toContain('isMobile');
    });

    it('tappable repo name dispatches SET_SELECTED_REPO with null', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, nameBackIdx - 400), nameBackIdx + 100);
        expect(nearby).toContain("type: 'SET_SELECTED_REPO', id: null");
    });

    it('tappable repo name clears hash', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, nameBackIdx - 400), nameBackIdx + 100);
        expect(nearby).toContain("''");
    });

    it('tappable repo name has aria-label "Back to repos"', () => {
        expect(REPO_DETAIL_SOURCE).toContain('aria-label="Back to repos"');
    });

    it('tappable repo name includes a chevron-down icon as visual cue', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(nameBackIdx, nameBackIdx + 700);
        expect(nearby).toContain('m19.5 8.25-7.5 7.5-7.5-7.5');
    });

    it('tappable repo name has group-active opacity for tap feedback', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(nameBackIdx, nameBackIdx + 500);
        expect(nearby).toContain('group-active:opacity-70');
    });

    it('tappable repo name wraps h1 in a button element', () => {
        const nameBackIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="repo-name-back"');
        const nearby = REPO_DETAIL_SOURCE.substring(Math.max(0, nameBackIdx - 500), nameBackIdx);
        expect(nearby).toContain('<button');
    });
});

describe('RepoDetail mobile: MobileTabBar integration', () => {
    it('imports MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { MobileTabBar } from '../../layout/MobileTabBar'");
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

    it('passes visibleSubTabs list to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabs={visibleSubTabs}');
    });

    it('passes badge counts to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('taskCount={taskCount}');
        expect(REPO_DETAIL_SOURCE).toContain('activityCount={');
        expect(REPO_DETAIL_SOURCE).toContain('workItemCount={');
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
