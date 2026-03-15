/**
 * Tests for Router — persistent MiniReposSidebar removed.
 *
 * Verifies that:
 * - mini-sidebar-layout and persistent-mini-sidebar are never rendered on any tab
 * - Each tab still renders its view content directly
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Router } from '../../../../src/server/spa/client/react/layout/Router';
import type { DashboardTab } from '../../../../src/server/spa/client/react/types/dashboard';

// ── Minimal mocks ──────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
let mockActiveTab: DashboardTab = 'repos';

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            selectedRepoId: null,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
        },
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: { repoQueueMap: {}, queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
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

vi.mock('../../../../src/server/spa/client/react/views/memory/MemoryView', () => ({
    MemoryView: () => <div id="view-memory" />,
}));

vi.mock('../../../../src/server/spa/client/react/views/skills/SkillsView', () => ({
    SkillsView: () => <div id="view-skills" />,
}));

vi.mock('../../../../src/server/spa/client/react/admin/AdminPanel', () => ({
    AdminPanel: () => <div id="view-admin" />,
}));

vi.mock('../../../../src/server/spa/client/react/views/logs/LogsView', () => ({
    LogsView: () => <div id="view-logs" />,
}));

// ── Tests ──────────────────────────────────────────────────────────────────

const NON_REPOS_TABS: DashboardTab[] = ['processes', 'wiki', 'memory', 'skills', 'admin', 'logs'];

describe('Router — no persistent mini sidebar on any tab', () => {
    it('does NOT render mini-sidebar-layout on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
        expect(container.querySelector('[data-testid="persistent-mini-sidebar"]')).toBeNull();
    });

    it.each(NON_REPOS_TABS)('does NOT render mini-sidebar-layout on %s tab', (tab) => {
        mockActiveTab = tab;
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
        expect(container.querySelector('[data-testid="persistent-mini-sidebar"]')).toBeNull();
        expect(container.querySelector('[data-testid="mini-repos-sidebar"]')).toBeNull();
    });

    it('renders view content directly on processes tab', () => {
        mockActiveTab = 'processes';
        const { container } = render(<Router />);
        expect(container.querySelector('#view-processes')).not.toBeNull();
    });

    it('renders ReposView directly on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('#view-repos')).not.toBeNull();
    });
});

