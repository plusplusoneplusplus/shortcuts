/**
 * VirtualWorkspaceShellHeader + VirtualWorkspaceInlineHeader tests.
 *
 * Both headers render a virtual workspace's identity + sub-tabs + action buttons
 * off a shared `VirtualWorkspaceHeaderConfig` via `useVirtualWorkspaceHeader`.
 * The shell header is the remote-first TopBar variant; the inline header is the
 * classic-shell / mobile in-body variant.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDispatch = vi.fn();
let mockActiveRepoSubTab = 'notes';
let mockSchedulesInScheduledSlideEnabled = false;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { activeRepoSubTab: mockActiveRepoSubTab }, dispatch: mockDispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled', () => ({
    useSchedulesInScheduledSlideEnabled: () => mockSchedulesInScheduledSlideEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

import { VirtualWorkspaceShellHeader } from '../../../../src/server/spa/client/react/features/remote-shell/VirtualWorkspaceShellHeader';
import { VirtualWorkspaceInlineHeader } from '../../../../src/server/spa/client/react/features/remote-shell/VirtualWorkspaceInlineHeader';
import type {
    VirtualWorkspaceHeaderAction,
    VirtualWorkspaceHeaderConfig,
} from '../../../../src/server/spa/client/react/features/remote-shell/virtualWorkspaceHeader';

// ── Fixtures ────────────────────────────────────────────────────────────────

const syncRun = vi.fn<[], Promise<string | null>>();
const generateRun = vi.fn<[], Promise<string | null>>();

function makeConfig(overrides: Partial<VirtualWorkspaceHeaderConfig> = {}): VirtualWorkspaceHeaderConfig {
    const actions: VirtualWorkspaceHeaderAction[] = [
        {
            key: 'sync',
            testId: 'demo-sync-btn',
            title: 'Sync things',
            idleLabel: '🔄 Sync',
            busyLabel: '⏳ Syncing…',
            errorLabel: 'Sync failed',
            run: syncRun,
        },
        {
            key: 'generate',
            testId: 'demo-generate-btn',
            title: 'Generate summary',
            idleLabel: '📝 Generate Summary',
            busyLabel: '⏳ Generating…',
            errorLabel: 'Generation failed',
            run: generateRun,
        },
    ];
    return {
        workspaceId: 'demo_ws',
        icon: '📋',
        label: 'Demo Work',
        testIdPrefix: 'demo',
        tabs: [
            { key: 'notes', label: 'Notes' },
            { key: 'activity', label: 'Activity' },
            { key: 'git', label: 'Git' },
            { key: 'schedules', label: 'Schedules' },
            { key: 'settings', label: 'Settings' },
        ],
        actions,
        ...overrides,
    };
}

beforeEach(() => {
    cleanup();
    mockDispatch.mockReset();
    syncRun.mockReset().mockResolvedValue('Synced 3 items');
    generateRun.mockReset().mockResolvedValue('Summary saved to Weekly/w.md');
    mockActiveRepoSubTab = 'notes';
    mockSchedulesInScheduledSlideEnabled = false;
    location.hash = '';
});

// ── Shell (TopBar) variant ────────────────────────────────────────────────────

describe('VirtualWorkspaceShellHeader', () => {
    it('renders identity, all sub-tabs and the action buttons', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        const header = screen.getByTestId('virtual-workspace-shell-header');
        expect(header.getAttribute('data-workspace')).toBe('demo_ws');
        expect(screen.getByTestId('demo-shell-identity').textContent).toContain('Demo Work');
        for (const key of ['notes', 'activity', 'git', 'schedules', 'settings']) {
            expect(screen.getByTestId(`demo-shell-tab-${key}`)).toBeTruthy();
        }
        expect(screen.getByTestId('demo-sync-btn')).toBeTruthy();
        expect(screen.getByTestId('demo-generate-btn')).toBeTruthy();
    });

    it('marks the active sub-tab', () => {
        mockActiveRepoSubTab = 'git';
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        expect(screen.getByTestId('demo-shell-tab-git').getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('demo-shell-tab-notes').getAttribute('data-active')).toBe('false');
    });

    it('falls back to Notes when the active sub-tab is not in the tab set', () => {
        mockActiveRepoSubTab = 'templates';
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);
        expect(screen.getByTestId('demo-shell-tab-notes').getAttribute('data-active')).toBe('true');
    });

    it('switches sub-tab via dispatch + hash on click', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-shell-tab-activity'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(location.hash).toBe('#repos/demo_ws/activity');
    });

    it('hides the Schedules tab when schedules-in-scheduled-slide is enabled', () => {
        mockSchedulesInScheduledSlideEnabled = true;
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);
        expect(screen.queryByTestId('demo-shell-tab-schedules')).toBeNull();
    });

    it('runs an action and shows its status message', async () => {
        syncRun.mockResolvedValueOnce('Synced 3 items');
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-sync-btn'));

        expect(syncRun).toHaveBeenCalledTimes(1);
        expect(await screen.findByTestId('demo-shell-status')).toBeTruthy();
        expect(screen.getByTestId('demo-shell-status').textContent).toBe('Synced 3 items');
    });

    it('shows a busy label and disables the button while an action runs', async () => {
        let resolveRun!: (v: string | null) => void;
        syncRun.mockReturnValueOnce(new Promise<string | null>(r => { resolveRun = r; }));
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-sync-btn'));

        const btn = screen.getByTestId('demo-sync-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('⏳ Syncing…');

        resolveRun('Synced 1 items');
        await waitFor(() => expect((screen.getByTestId('demo-sync-btn') as HTMLButtonElement).disabled).toBe(false));
        expect(screen.getByTestId('demo-sync-btn').textContent).toBe('🔄 Sync');
    });

    it('surfaces the error label when an action throws', async () => {
        syncRun.mockRejectedValueOnce(new Error('boom'));
        render(<VirtualWorkspaceShellHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-sync-btn'));

        await waitFor(() => expect(screen.getByTestId('demo-shell-status').textContent).toBe('Sync failed: boom'));
    });
});

// ── Inline (in-body) variant ──────────────────────────────────────────────────

describe('VirtualWorkspaceInlineHeader', () => {
    it('renders the flat header with tabs, splitter and action buttons', () => {
        render(<VirtualWorkspaceInlineHeader config={makeConfig()} />);

        expect(screen.getByTestId('demo-header')).toBeTruthy();
        expect(screen.getByTestId('demo-header-splitter')).toBeTruthy();
        for (const key of ['notes', 'activity', 'git', 'schedules', 'settings']) {
            expect(screen.getByTestId(`demo-tab-${key}`)).toBeTruthy();
        }
        expect(screen.getByTestId('demo-sync-btn')).toBeTruthy();
        expect(screen.getByTestId('demo-generate-btn')).toBeTruthy();
    });

    it('renders the active indicator span only on the active tab', () => {
        mockActiveRepoSubTab = 'activity';
        render(<VirtualWorkspaceInlineHeader config={makeConfig()} />);

        expect(screen.getByTestId('demo-tab-activity').querySelector('span')).toBeTruthy();
        expect(screen.getByTestId('demo-tab-notes').querySelector('span')).toBeNull();
    });

    it('switches sub-tab via dispatch + hash on click', () => {
        render(<VirtualWorkspaceInlineHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-tab-git'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'git' });
        expect(location.hash).toBe('#repos/demo_ws/git');
    });

    it('runs the generate action, navigates and shows status', async () => {
        generateRun.mockImplementationOnce(async () => {
            location.hash = '#repos/demo_ws/notes/Weekly%2Fw.md';
            return 'Summary saved to Weekly/w.md';
        });
        render(<VirtualWorkspaceInlineHeader config={makeConfig()} />);

        fireEvent.click(screen.getByTestId('demo-generate-btn'));

        expect(await screen.findByTestId('demo-status')).toBeTruthy();
        expect(screen.getByTestId('demo-status').textContent).toBe('Summary saved to Weekly/w.md');
        expect(location.hash).toBe('#repos/demo_ws/notes/Weekly%2Fw.md');
    });

    it('hides the Schedules tab when schedules-in-scheduled-slide is enabled', () => {
        mockSchedulesInScheduledSlideEnabled = true;
        render(<VirtualWorkspaceInlineHeader config={makeConfig()} />);
        expect(screen.queryByTestId('demo-tab-schedules')).toBeNull();
    });
});
