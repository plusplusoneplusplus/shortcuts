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
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

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

function makeLocalRepo(id: string, name: string, rootPath = `/home/user/${name}`): RepoData {
    return { workspace: { id, name, rootPath } };
}

function makeRemoteRepo(id: string, name: string, serverId = 'server-1', serverLabel = 'My Server', connection = 'online'): RepoData {
    return {
        workspace: {
            id,
            name,
            baseUrl: 'https://server-1.example.com',
            remote: { serverId, serverLabel, connection },
        },
    };
}

const mockOnSelectRepo = vi.fn();

beforeEach(() => {
    cleanup();
    mockDispatch.mockReset();
    mockOnSelectRepo.mockReset();
    syncRun.mockReset().mockResolvedValue('Synced 3 items');
    generateRun.mockReset().mockResolvedValue('Summary saved to Weekly/w.md');
    mockActiveRepoSubTab = 'notes';
    mockSchedulesInScheduledSlideEnabled = false;
    location.hash = '';
});

// ── Shell (TopBar) variant ────────────────────────────────────────────────────

describe('VirtualWorkspaceShellHeader', () => {
    it('renders identity, all sub-tabs and the action buttons', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

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
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

        expect(screen.getByTestId('demo-shell-tab-git').getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId('demo-shell-tab-notes').getAttribute('data-active')).toBe('false');
    });

    it('falls back to Notes when the active sub-tab is not in the tab set', () => {
        mockActiveRepoSubTab = 'templates';
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        expect(screen.getByTestId('demo-shell-tab-notes').getAttribute('data-active')).toBe('true');
    });

    it('switches sub-tab via dispatch + hash on click', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

        fireEvent.click(screen.getByTestId('demo-shell-tab-activity'));

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_REPO_SUB_TAB', tab: 'activity' });
        expect(location.hash).toBe('#repos/demo_ws/activity');
    });

    it('hides the Schedules tab when schedules-in-scheduled-slide is enabled', () => {
        mockSchedulesInScheduledSlideEnabled = true;
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        expect(screen.queryByTestId('demo-shell-tab-schedules')).toBeNull();
    });

    it('runs an action and shows its status message', async () => {
        syncRun.mockResolvedValueOnce('Synced 3 items');
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

        fireEvent.click(screen.getByTestId('demo-sync-btn'));

        expect(syncRun).toHaveBeenCalledTimes(1);
        expect(await screen.findByTestId('demo-shell-status')).toBeTruthy();
        expect(screen.getByTestId('demo-shell-status').textContent).toBe('Synced 3 items');
    });

    it('shows a busy label and disables the button while an action runs', async () => {
        let resolveRun!: (v: string | null) => void;
        syncRun.mockReturnValueOnce(new Promise<string | null>(r => { resolveRun = r; }));
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

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
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);

        fireEvent.click(screen.getByTestId('demo-sync-btn'));

        await waitFor(() => expect(screen.getByTestId('demo-shell-status').textContent).toBe('Sync failed: boom'));
    });

    // ── Repo picker dropdown ────────────────────────────────────────────────

    it('identity chip is a button with aria-haspopup and aria-expanded', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        const btn = screen.getByTestId('demo-shell-identity');
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.getAttribute('aria-haspopup')).toBe('menu');
        expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('clicking the identity chip opens the dropdown', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        expect(screen.queryByTestId('demo-repo-dropdown')).toBeNull();
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        expect(screen.getByTestId('demo-repo-dropdown')).toBeTruthy();
        expect(screen.getByTestId('demo-shell-identity').getAttribute('aria-expanded')).toBe('true');
    });

    it('clicking the identity chip again closes the dropdown', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        expect(screen.queryByTestId('demo-repo-dropdown')).toBeNull();
    });

    it('shows empty state with hamburger hint when no repos and dropdown is open', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const dropdown = screen.getByTestId('demo-repo-dropdown');
        expect(dropdown.textContent).toContain('No repositories');
        expect(dropdown.textContent).toContain('☰');
    });

    it('shows local repos in the dropdown with a Local section header', () => {
        const repos = [makeLocalRepo('ws-1', 'shortcuts'), makeLocalRepo('ws-2', 'dotfiles')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const dropdown = screen.getByTestId('demo-repo-dropdown');
        expect(dropdown.textContent).toContain('Local');
        const rows = screen.getAllByTestId('demo-repo-local-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('shortcuts');
        expect(rows[1].textContent).toContain('dotfiles');
    });

    it('shows remote repos in the dropdown with a Remote section header', () => {
        const repos = [makeRemoteRepo('ws-r1', 'shortcuts', 'srv-1', 'Dev Server')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const dropdown = screen.getByTestId('demo-repo-dropdown');
        expect(dropdown.textContent).toContain('Remote');
        const rows = screen.getAllByTestId('demo-repo-remote-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('shortcuts');
        expect(rows[0].textContent).toContain('Dev Server');
    });

    it('clicking a local repo row calls onSelectRepo and closes the dropdown', () => {
        const repos = [makeLocalRepo('ws-local', 'myrepo')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        fireEvent.click(screen.getByTestId('demo-repo-local-row'));
        expect(mockOnSelectRepo).toHaveBeenCalledWith('ws-local');
        expect(screen.queryByTestId('demo-repo-dropdown')).toBeNull();
    });

    it('clicking a remote repo row calls onSelectRepo with the remote clone key', () => {
        const repo = makeRemoteRepo('ws-r1', 'myrepo', 'srv-1', 'Dev Server', 'online');
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[repo]} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        fireEvent.click(screen.getByTestId('demo-repo-remote-row'));
        // Remote clone key is "remote:<encodedServerId>:<encodedWorkspaceId>"
        expect(mockOnSelectRepo).toHaveBeenCalledWith(expect.stringContaining('srv-1'));
    });

    it('offline remote repo is disabled and does not call onSelectRepo', () => {
        const repo = makeRemoteRepo('ws-offline', 'offline-repo', 'srv-1', 'Dev Server', 'offline');
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[repo]} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const row = screen.getByTestId('demo-repo-remote-row') as HTMLButtonElement;
        expect(row.disabled).toBe(true);
        expect(row.textContent).toContain('offline');
        fireEvent.click(row);
        expect(mockOnSelectRepo).not.toHaveBeenCalled();
    });

    it('filter hides repos that do not match the query', () => {
        const repos = [makeLocalRepo('ws-1', 'shortcuts'), makeLocalRepo('ws-2', 'dotfiles')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const search = screen.getByTestId('demo-repo-search');
        fireEvent.change(search, { target: { value: 'short' } });
        const rows = screen.getAllByTestId('demo-repo-local-row');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain('shortcuts');
    });

    it('filter shows "No repositories match" when nothing passes the filter', () => {
        const repos = [makeLocalRepo('ws-1', 'shortcuts')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        fireEvent.change(screen.getByTestId('demo-repo-search'), { target: { value: 'zzz-no-match' } });
        expect(screen.getByTestId('demo-repo-dropdown').textContent).toContain('No repositories match');
    });

    it('Escape closes the dropdown', () => {
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={[]} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        expect(screen.getByTestId('demo-repo-dropdown')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('demo-repo-dropdown')).toBeNull();
    });

    it('shows both Local and Remote sections when both types are present', () => {
        const repos = [
            makeLocalRepo('ws-1', 'local-repo'),
            makeRemoteRepo('ws-r1', 'remote-repo', 'srv-1', 'Dev Server', 'online'),
        ];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const dropdown = screen.getByTestId('demo-repo-dropdown');
        expect(dropdown.textContent).toContain('Local');
        expect(dropdown.textContent).toContain('Remote');
    });

    it('short path of rootPath is shown as sublabel for local repos', () => {
        const repos = [makeLocalRepo('ws-1', 'myrepo', '/home/user/projects/myrepo')];
        render(<VirtualWorkspaceShellHeader config={makeConfig()} repos={repos} onSelectRepo={mockOnSelectRepo} />);
        fireEvent.click(screen.getByTestId('demo-shell-identity'));
        const row = screen.getByTestId('demo-repo-local-row');
        expect(row.textContent).toContain('projects/myrepo');
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
