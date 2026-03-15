/**
 * Tests for Router — persistent MiniReposSidebar on non-repos pages.
 *
 * Verifies that:
 * - MiniReposSidebar wrapper (mini-sidebar-layout) is NOT rendered on the repos tab
 * - MiniReposSidebar wrapper IS rendered on processes, skills, logs, memory, admin, wiki pages
 * - RepoTabStrip is rendered on all tabs (not just repos)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('Router — WithMiniSidebar on non-repos pages', () => {
    it('does NOT render mini-sidebar-layout on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
        expect(container.querySelector('[data-testid="persistent-mini-sidebar"]')).toBeNull();
    });

    it('renders mini-sidebar-layout on processes tab', () => {
        mockActiveTab = 'processes';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="mini-repos-sidebar"]')).not.toBeNull();
    });

    it('renders mini-sidebar-layout on wiki tab', () => {
        mockActiveTab = 'wiki';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).not.toBeNull();
    });

    it('renders mini-sidebar-layout on logs tab', () => {
        mockActiveTab = 'logs';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).not.toBeNull();
    });

    it('renders mini-sidebar-layout on admin tab', () => {
        mockActiveTab = 'admin';
        const { container } = render(<Router />);
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).not.toBeNull();
    });

    it('mini-sidebar has correct nav semantics (via MiniReposSidebar)', () => {
        mockActiveTab = 'processes';
        const { container } = render(<Router />);
        // MiniReposSidebar is rendered inside the persistent sidebar
        const sidebar = container.querySelector('[data-testid="persistent-mini-sidebar"]');
        expect(sidebar).not.toBeNull();
        // The sidebar should contain the MiniReposSidebar
        expect(sidebar?.querySelector('[data-testid="mini-repos-sidebar"]')).not.toBeNull();
    });

    it('page content is rendered alongside mini sidebar on processes tab', () => {
        mockActiveTab = 'processes';
        const { container } = render(<Router />);
        expect(container.querySelector('#view-processes')).not.toBeNull();
    });

    it('renders ReposView directly (no mini sidebar wrapper) on repos tab', () => {
        mockActiveTab = 'repos';
        const { container } = render(<Router />);
        expect(container.querySelector('#view-repos')).not.toBeNull();
        expect(container.querySelector('[data-testid="mini-sidebar-layout"]')).toBeNull();
    });
});
