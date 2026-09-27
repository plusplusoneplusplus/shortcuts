/**
 * @vitest-environment jsdom
 *
 * Cmd/Ctrl+\ toggles the workspace right panel. The binding lives in Router's
 * global keydown handler next to Cmd/Ctrl+B: input-guarded, repo-scoped, gated
 * on the split-workspace panel, and matched on the physical `Backslash` key. It
 * flips the cross-tree `split-workspace:<ws>:dock-open` store that the header
 * toggle button also drives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';
import type { DashboardTab } from '../../../../src/server/spa/client/react/types/dashboard';

const { flag } = vi.hoisted(() => ({ flag: { split: true } }));

vi.mock('../../../../src/server/spa/client/react/utils/config', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, isSplitWorkspacePanelEnabled: () => flag.split };
});

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();
let mockActiveTab: DashboardTab = 'repos';
let mockSelectedRepoId: string | null = null;
let mockQueueState: any = {};

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: mockSelectedRepoId,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
        },
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: mockQueueState, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
    ReposProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/repos/MiniReposSidebar', () => ({
    MiniReposSidebar: () => <div data-testid="mini-repos-sidebar" />,
}));

vi.mock('../../../../src/server/spa/client/react/processes/ProcessesView', () => ({
    ProcessesView: () => <div id="view-processes" />,
}));

vi.mock('../../../../src/server/spa/client/react/repos', () => ({
    ReposView: () => <div id="view-repos" />,
}));

vi.mock('../../../../src/server/spa/client/react/wiki/WikiView', () => ({
    WikiView: () => <div id="view-wiki" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/memory/MemoryView', () => ({
    MemoryView: () => <div id="view-memory" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/skills/SkillsView', () => ({
    SkillsView: () => <div id="view-skills" />,
}));

vi.mock('../../../../src/server/spa/client/react/admin/AdminPanel', () => ({
    AdminPanel: () => <div id="view-admin" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/logs/LogsView', () => ({
    LogsView: () => <div id="view-logs" />,
}));

const KEY = workspaceDockOpenStorageKey('feature-repo');

function press(init: KeyboardEventInit, target: EventTarget = document) {
    act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', bubbles: true, ...init }));
    });
}

beforeEach(() => {
    mockActiveTab = 'repos';
    mockSelectedRepoId = 'feature-repo';
    mockQueueState = {
        repoQueueMap: {},
        repoHistoryMap: {},
        selectedTaskId: null,
        selectedTaskIdByRepo: {},
        queued: [],
        running: [],
        history: [],
    };
    mockDispatch.mockReset();
    mockQueueDispatch.mockReset();
    flag.split = true;
    localStorage.clear();
    window.location.hash = '';
});

afterEach(() => {
    cleanup();
    window.location.hash = '';
    localStorage.clear();
});

describe('Router — Cmd/Ctrl+\\ toggles the right panel', () => {
    it('Cmd+\\ opens the panel and Ctrl+\\ closes it again', () => {
        render(<Router />);
        expect(localStorage.getItem(KEY)).toBeNull();
        press({ metaKey: true });
        expect(localStorage.getItem(KEY)).toBe('1');
        press({ ctrlKey: true });
        expect(localStorage.getItem(KEY)).toBe('0');
    });

    it('matches the physical key even when the layout types another character', () => {
        render(<Router />);
        press({ ctrlKey: true, key: '#' });
        expect(localStorage.getItem(KEY)).toBe('1');
    });

    it('prevents the browser default', () => {
        render(<Router />);
        const event = new KeyboardEvent('keydown', { key: '\\', code: 'Backslash', ctrlKey: true, bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(true);
    });

    it('targets the workspace id inside a remote clone selection', () => {
        mockSelectedRepoId = 'remote:srv-1:ws-remote';
        render(<Router />);
        press({ ctrlKey: true });
        expect(localStorage.getItem(workspaceDockOpenStorageKey('ws-remote'))).toBe('1');
    });

    it('works for a repo group selection', () => {
        mockSelectedRepoId = 'group-alpha';
        render(<Router />);
        press({ ctrlKey: true });
        expect(localStorage.getItem(workspaceDockOpenStorageKey('group-alpha'))).toBe('1');
    });

    it('does not fire while an INPUT is focused', () => {
        render(<Router />);
        const input = document.createElement('input');
        document.body.appendChild(input);
        press({ metaKey: true }, input);
        expect(localStorage.getItem(KEY)).toBeNull();
        input.remove();
    });

    it('does nothing when the split-workspace panel is disabled', () => {
        flag.split = false;
        render(<Router />);
        press({ metaKey: true });
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('does nothing when no workspace is selected', () => {
        mockSelectedRepoId = null;
        render(<Router />);
        press({ metaKey: true });
        expect(Object.keys(localStorage).filter((k) => k.endsWith(':dock-open'))).toHaveLength(0);
    });

    it('ignores a bare backslash and Shift/Alt variants', () => {
        render(<Router />);
        press({});
        press({ ctrlKey: true, shiftKey: true });
        press({ ctrlKey: true, altKey: true });
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('leaves the Cmd/Ctrl+B left-sidebar binding alone', () => {
        render(<Router />);
        press({ ctrlKey: true });
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('feature-repo'))).toBeNull();
    });
});
