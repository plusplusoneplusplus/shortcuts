/**
 * RepoTabStrip — agent pill highlight tests (container mode).
 *
 * Ensures only the agent pill matching the currently-active agent is highlighted,
 * even when the same workspace ID exists under multiple agents.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RepoTabStrip } from '../../../../src/server/spa/client/react/features/repo-detail/RepoTabStrip';

const mockDispatch = vi.fn();
const mockQueueDispatch = vi.fn();

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mockDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

let mockCurrentAgentId: string | null = null;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    isContainerMode: () => true,
    getRawApiBase: () => '/api',
    getHostname: () => 'localhost',
    isServersEnabled: () => false,
    getCurrentAgentId: () => mockCurrentAgentId,
    setCurrentAgentId: (id: string | null) => { mockCurrentAgentId = id; },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: async () => ({}),
            patchGlobal: async () => ({}),
            replaceGlobal: async () => ({}),
        },
        workspaces: { delete: async () => {} },
    }),
    getSpaCocClientErrorMessage: (e: unknown) => String(e),
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddRepoDialog', () => ({
    AddRepoDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="add-repo-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddFolderDialog', () => ({
    AddFolderDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="add-folder-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/AddAgentDialog', () => ({
    AddAgentDialog: ({ open }: { open: boolean }) =>
        open ? <div data-testid="add-agent-dialog" /> : null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/GenerateTaskDialog', () => ({
    GenerateTaskDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useUiLayoutMode', () => ({
    useUiLayoutMode: () => ['default'],
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ContainerAgentContext', () => ({
    useContainerAgents: () => ({
        agents: [
            { id: 'agent-dev2', name: 'dev2', url: 'http://dev2:4000' },
            { id: 'agent-dev4', name: 'dev4', url: 'http://dev4:4000' },
            { id: 'agent-dev3', name: 'dev3', url: 'http://dev3:4000' },
        ],
        loading: false,
        refresh: async () => {},
        addAgent: async () => { throw new Error('Not in container mode'); },
        removeAgent: async () => { throw new Error('Not in container mode'); },
        renameAgent: async () => { throw new Error('Not in container mode'); },
    }),
}));

// Helper: create a repo entry with agentId
const makeAgentRepo = (id: string, name: string, agentId: string, agentName: string) => ({
    workspace: { id, name, rootPath: `/repos/${name}`, color: '#848484', agentId, agentName },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
});

describe('RepoTabStrip agent pill highlight (container mode)', () => {
    beforeEach(() => {
        cleanup();
        mockCurrentAgentId = null;
    });

    it('highlights only the agent whose repo is actively selected', () => {
        // Same workspace ID "ws-abc" exists under both agents (same path hash)
        const repos = [
            makeAgentRepo('ws-abc', 'Storage-XStore', 'agent-dev2', 'dev2'),
            makeAgentRepo('ws-abc', 'Storage-XStore', 'agent-dev4', 'dev4'),
            makeAgentRepo('ws-xyz', 'OtherRepo', 'agent-dev3', 'dev3'),
        ];

        // Simulate: user selected ws-abc on agent-dev4
        mockCurrentAgentId = 'agent-dev4';

        render(
            <RepoTabStrip
                repos={repos}
                selectedRepoId="ws-abc"
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );

        const pills = screen.getAllByTestId('agent-pill');
        // Only the dev4 pill should have the active highlight class
        const highlightedPills = pills.filter(p => p.className.includes('bg-[#0078d4]'));
        expect(highlightedPills).toHaveLength(1);
        expect(highlightedPills[0].textContent).toContain('dev4');
    });

    it('does not highlight any agent pill when no repo is selected', () => {
        const repos = [
            makeAgentRepo('ws-abc', 'Storage-XStore', 'agent-dev2', 'dev2'),
            makeAgentRepo('ws-xyz', 'OtherRepo', 'agent-dev4', 'dev4'),
        ];

        mockCurrentAgentId = null;

        render(
            <RepoTabStrip
                repos={repos}
                selectedRepoId={null}
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );

        const pills = screen.getAllByTestId('agent-pill');
        const highlightedPills = pills.filter(p => p.className.includes('bg-[#0078d4]'));
        expect(highlightedPills).toHaveLength(0);
    });

    it('highlights the correct agent when workspace is unique to one agent', () => {
        const repos = [
            makeAgentRepo('ws-abc', 'Storage-XStore', 'agent-dev2', 'dev2'),
            makeAgentRepo('ws-xyz', 'OtherRepo', 'agent-dev4', 'dev4'),
        ];

        // ws-abc is unique to agent-dev2
        mockCurrentAgentId = 'agent-dev2';

        render(
            <RepoTabStrip
                repos={repos}
                selectedRepoId="ws-abc"
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );

        const pills = screen.getAllByTestId('agent-pill');
        const highlightedPills = pills.filter(p => p.className.includes('bg-[#0078d4]'));
        expect(highlightedPills).toHaveLength(1);
        expect(highlightedPills[0].textContent).toContain('dev2');
    });

    it('does not highlight agent when selectedRepoId exists in group but agent is not current', () => {
        // ws-abc is in agent-dev2 group only, but currentAgentId is agent-dev4
        const repos = [
            makeAgentRepo('ws-abc', 'Storage-XStore', 'agent-dev2', 'dev2'),
            makeAgentRepo('ws-xyz', 'OtherRepo', 'agent-dev4', 'dev4'),
        ];

        mockCurrentAgentId = 'agent-dev4';

        render(
            <RepoTabStrip
                repos={repos}
                selectedRepoId="ws-abc"
                onSelect={vi.fn()}
                unseenCounts={{}}
                onRefresh={vi.fn()}
            />
        );

        const pills = screen.getAllByTestId('agent-pill');
        // dev2 has the repo but is not current agent, dev4 is current but doesn't have the repo
        const highlightedPills = pills.filter(p => p.className.includes('bg-[#0078d4]'));
        expect(highlightedPills).toHaveLength(0);
    });
});
