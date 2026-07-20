/**
 * @vitest-environment jsdom
 *
 * AC-04 — Cmd/Ctrl+B toggles the whole-left-column collapse state in the split
 * workspace layout. The binding lives in Router's global keydown handler: it is
 * input-guarded (never fires while an INPUT/TEXTAREA/contentEditable is focused),
 * repo-scoped (only when a workspace is selected on the repos tab), and gated on
 * the split-workspace panel being enabled. It flips the cross-tree
 * `split-workspace:<ws>:left-collapsed` store that the sidebar chevron also drives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
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

const KEY = splitWorkspaceLeftCollapsedStorageKey('feature-repo');

function pressToggle(init: KeyboardEventInit) {
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, ...init }));
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

describe('Router — Cmd/Ctrl+B collapses the left sidebar', () => {
    it('Cmd+B toggles the per-workspace left-collapsed flag on and back off', () => {
        render(<Router />);
        expect(localStorage.getItem(KEY)).toBeNull();
        pressToggle({ metaKey: true });
        expect(localStorage.getItem(KEY)).toBe('1');
        pressToggle({ ctrlKey: true });
        expect(localStorage.getItem(KEY)).toBe('0');
    });

    it('does not fire while an INPUT is focused (input-guarded)', () => {
        render(<Router />);
        const input = document.createElement('input');
        document.body.appendChild(input);
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
        });
        expect(localStorage.getItem(KEY)).toBeNull();
        input.remove();
    });

    it('does not fire in a contentEditable region', () => {
        render(<Router />);
        const editable = document.createElement('div');
        editable.contentEditable = 'true';
        // jsdom does not derive isContentEditable from the attribute; force it.
        Object.defineProperty(editable, 'isContentEditable', { value: true });
        document.body.appendChild(editable);
        act(() => {
            editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
        });
        expect(localStorage.getItem(KEY)).toBeNull();
        editable.remove();
    });

    it('does nothing when the split-workspace panel is disabled', () => {
        flag.split = false;
        render(<Router />);
        pressToggle({ metaKey: true });
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('does nothing when no workspace is selected', () => {
        mockSelectedRepoId = null;
        render(<Router />);
        pressToggle({ metaKey: true });
        // No left-collapsed key written for any workspace.
        const keys = Object.keys(localStorage).filter((k) => k.endsWith(':left-collapsed'));
        expect(keys).toHaveLength(0);
    });

    it('ignores a bare "b" without Cmd/Ctrl', () => {
        render(<Router />);
        pressToggle({});
        expect(localStorage.getItem(KEY)).toBeNull();
    });
});
