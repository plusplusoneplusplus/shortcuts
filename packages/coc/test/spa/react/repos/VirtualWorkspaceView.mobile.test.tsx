/**
 * My Work / My Life mobile chrome.
 *
 * Both virtual workspaces used to render `VirtualWorkspaceInlineHeader` at every
 * width. On mobile they now render `VirtualWorkspaceMobileTabBar` instead, so
 * they get the same back-to-scope-list affordance a repo group has.
 *
 * `RepoGroupView` picked up jsdom coverage for that swap; My Work and My Life
 * did not, and the only thing still asserting their mobile header was a sharded
 * Playwright spec — which kept pointing at the removed inline header and went
 * red instead of catching anything. These tests pin the same contract the e2e
 * walks (`<prefix>-mobile-header`, the back button, which tabs are pinned, and
 * the header actions living in the `···` sheet) somewhere that runs in seconds.
 *
 * Renders the real headers so the tab/action assertions are genuine, with the
 * heavy tab bodies stubbed.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockAppState: any = {};
let mockRemoteShellEnabled = false;
let mockBreakpoint = 'desktop';
let mockTodayViewEnabled = true;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} } }),
    useQueueOptional: () => ({ state: { selectedTaskIdByRepo: {} } }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/Router', async () => {
    const routes = await import('../../../../src/server/spa/client/react/layout/dashboardRoutes');
    return { buildWorkspaceSubTabSuffix: routes.buildWorkspaceSubTabSuffix };
});
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => false,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkTodayViewEnabled', () => ({
    useMyWorkTodayViewEnabled: () => mockTodayViewEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShellEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockBreakpoint,
        isMobile: mockBreakpoint === 'mobile',
        isTablet: false,
        isDesktop: mockBreakpoint === 'desktop',
    }),
}));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/RepoChatTab', () => ({
    RepoChatTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-chat-tab" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: ({ workspaceId, active }: { workspaceId: string; active: boolean }) => (
        <div data-testid="stub-notes-view" data-workspace={workspaceId} data-active={String(active)} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesGitTab', () => ({
    NotesGitTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-notes-git" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/schedules/RepoSchedulesTab', () => ({
    RepoSchedulesTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-schedules" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-settings/RepoSettingsTab', () => ({
    RepoSettingsTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-settings" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/my-work/MyWorkTodayTab', () => ({
    MyWorkTodayTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-today" data-workspace={workspaceId} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/repos/repositoryService', () => ({
    syncMyWork: vi.fn(async () => ({ actionItemCount: 0, followUpCount: 0 })),
    generateMyWorkSummary: vi.fn(async () => ({ path: null })),
    syncMyLife: vi.fn(async () => ({ actionItemCount: 0 })),
    generateMyLifeSummary: vi.fn(async () => ({ path: null })),
}));

import { MyWorkView } from '../../../../src/server/spa/client/react/repos/MyWorkView';
import { MyLifeView } from '../../../../src/server/spa/client/react/repos/MyLifeView';

/** `data-tab` of every button on the mobile tab bar, in render order. */
function barTabs(): (string | null)[] {
    const bar = screen.getByTestId('mobile-tab-bar');
    return [...bar.querySelectorAll('button[data-tab]')].map(b => b.getAttribute('data-tab'));
}

beforeEach(() => {
    cleanup();
    mockDispatch.mockReset();
    mockRemoteShellEnabled = false;
    mockBreakpoint = 'desktop';
    mockTodayViewEnabled = true;
    location.hash = '';
    mockAppState = {
        activeRepoSubTab: 'notes',
        selectedNotePath: null,
        notePathState: {},
        workspaces: [],
    };
});

describe('MyWorkView mobile chrome', () => {
    it('renders the mobile tab bar with a back affordance instead of the inline header', () => {
        mockBreakpoint = 'mobile';
        render(<MyWorkView />);

        expect(screen.getByTestId('my-work-mobile-header')).toBeTruthy();
        expect(screen.getByTestId('my-work-name-back')).toBeTruthy();
        expect(screen.queryByTestId('my-work-header')).toBeNull();
    });

    it('keeps the inline header on desktop in the classic shell', () => {
        // The swap is mobile-only: the desktop classic shell still renders the
        // in-body header, so neither header can quietly take over the other's width.
        render(<MyWorkView />);

        expect(screen.getByTestId('my-work-header')).toBeTruthy();
        expect(screen.queryByTestId('my-work-mobile-header')).toBeNull();
    });

    it('pins Today / Notes / Activity and folds Git, Schedules and Settings behind `···`', () => {
        mockBreakpoint = 'mobile';
        render(<MyWorkView />);

        expect(barTabs()).toEqual(['today', 'notes', 'activity', 'more']);

        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-git')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-schedules')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-settings')).toBeTruthy();
    });

    it('pins Notes / Activity / Git when the Today tab is flagged off', () => {
        mockBreakpoint = 'mobile';
        mockTodayViewEnabled = false;
        render(<MyWorkView />);

        expect(barTabs()).toEqual(['notes', 'activity', 'git', 'more']);
    });

    it('moves the Sync and Generate actions into the `···` sheet', () => {
        // At this width the labelled header buttons have no row of their own, so
        // they are not rendered at all — the sheet is the only way to reach them.
        mockBreakpoint = 'mobile';
        render(<MyWorkView />);

        expect(screen.queryByTestId('my-work-sync-btn')).toBeNull();
        expect(screen.queryByTestId('my-work-generate-btn')).toBeNull();

        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-action-0').textContent).toContain('Sync Work IQ');
        expect(screen.getByTestId('mobile-tab-action-1').textContent).toContain('Generate Summary');
    });

    it('clears the selection and returns to the scope list from the back button', () => {
        mockBreakpoint = 'mobile';
        location.hash = '#repos/my_work/notes';
        render(<MyWorkView />);

        fireEvent.click(screen.getByTestId('my-work-name-back'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: null });
        expect(location.hash).toBe('');
    });
});

describe('MyLifeView mobile chrome', () => {
    it('renders the mobile tab bar with a back affordance instead of the inline header', () => {
        mockBreakpoint = 'mobile';
        render(<MyLifeView />);

        expect(screen.getByTestId('my-life-mobile-header')).toBeTruthy();
        expect(screen.getByTestId('my-life-name-back')).toBeTruthy();
        expect(screen.queryByTestId('my-life-header')).toBeNull();
    });

    it('keeps the inline header on desktop in the classic shell', () => {
        render(<MyLifeView />);

        expect(screen.getByTestId('my-life-header')).toBeTruthy();
        expect(screen.queryByTestId('my-life-mobile-header')).toBeNull();
    });

    it('pins Notes / Activity / Git and folds Schedules and Settings behind `···`', () => {
        mockBreakpoint = 'mobile';
        render(<MyLifeView />);

        expect(barTabs()).toEqual(['notes', 'activity', 'git', 'more']);

        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-schedules')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-settings')).toBeTruthy();
    });

    it('moves the Sync and Generate actions into the `···` sheet', () => {
        mockBreakpoint = 'mobile';
        render(<MyLifeView />);

        expect(screen.queryByTestId('my-life-sync-btn')).toBeNull();
        expect(screen.queryByTestId('my-life-generate-btn')).toBeNull();

        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-action-0').textContent).toContain('Sync');
        expect(screen.getByTestId('mobile-tab-action-1').textContent).toContain('Generate Summary');
    });

    it('clears the selection and returns to the scope list from the back button', () => {
        mockBreakpoint = 'mobile';
        location.hash = '#repos/my_life/notes';
        render(<MyLifeView />);

        fireEvent.click(screen.getByTestId('my-life-name-back'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_REPO', id: null });
        expect(location.hash).toBe('');
    });
});
