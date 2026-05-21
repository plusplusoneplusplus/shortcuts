/**
 * Tests for RepoCopilotTab — Split-panel layout with MCP server toggle panel + Agent Skills + Custom Instructions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const mockClient = vi.hoisted(() => ({
    workspaces: {
        getMcpConfig: vi.fn(),
        updateMcpConfig: vi.fn(),
        getInstructions: vi.fn(),
        updateInstruction: vi.fn(),
        deleteInstruction: vi.fn(),
    },
    skills: {
        listWorkspace: vi.fn(),
        getWorkspaceConfig: vi.fn(),
        updateWorkspaceConfig: vi.fn(),
        detailWorkspace: vi.fn(),
        deleteWorkspace: vi.fn(),
        listBundledWorkspace: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mockClient,
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

// global fetch mock for AppProvider calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ToastContext mock
vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn() }),
}));

async function renderTab(workspaceId = 'ws-1') {
    const { RepoCopilotTab } = await import(
        '../../../../src/server/spa/client/react/features/repo-detail/RepoCopilotTab'
    );
    const { AppProvider } = await import(
        '../../../../src/server/spa/client/react/contexts/AppContext'
    );
    return render(<AppProvider><RepoCopilotTab workspaceId={workspaceId} /></AppProvider>);
}

/** Helper: navigate the sidebar to the skills section */
async function navigateToSkills() {
    await waitFor(() => expect(screen.getByTestId('nav-item-skills')).toBeTruthy());
    await act(async () => {
        fireEvent.click(screen.getByTestId('nav-item-skills'));
    });
}

const twoServers = {
    availableServers: [
        { name: 'github', type: 'stdio' },
        { name: 'search', type: 'sse' },
    ],
    enabledMcpServers: null,
};

const emptySkillsResponse = { skills: [] };

beforeEach(() => {
    vi.resetAllMocks();
    location.hash = '';
    mockClient.workspaces.getMcpConfig.mockResolvedValue(twoServers);
    mockClient.workspaces.updateMcpConfig.mockResolvedValue({});
    mockClient.workspaces.getInstructions.mockResolvedValue({ base: null, ask: null, plan: null, autopilot: null });
    mockClient.skills.listWorkspace.mockResolvedValue([]);
    mockClient.skills.getWorkspaceConfig.mockResolvedValue({ disabledSkills: [], extraSkillFolders: [] });
    mockClient.skills.updateWorkspaceConfig.mockResolvedValue({});
    mockClient.skills.detailWorkspace.mockResolvedValue({ skill: null });
    mockClient.skills.deleteWorkspace.mockResolvedValue(undefined);
    mockClient.skills.listBundledWorkspace.mockResolvedValue([]);
    // AppProvider preferences call returns {}
    mockFetch.mockResolvedValue({
        ok: true,
        json: async () => emptySkillsResponse,
    } as any);
});

// ── 1. Loading state ─────────────────────────────────────────────────────────

describe('loading state', () => {
    it('shows loading text while GET is pending', async () => {
        let resolve: (v: any) => void;
        mockClient.workspaces.getMcpConfig.mockReturnValue(new Promise((r) => { resolve = r; }));
        await act(async () => { await renderTab(); });
        expect(screen.getByText('Loading…')).toBeTruthy();
        // resolve to avoid unhandled rejection
        await act(async () => { resolve!(twoServers); });
    });
});

// ── 2. Renders server list ───────────────────────────────────────────────────

describe('server list rendering', () => {
    it('renders server names and type labels', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText('github')).toBeTruthy();
        expect(screen.getByText('search')).toBeTruthy();
        // Transport types appear in server pills (and may also appear in AddServerCard),
        // so use getAllByText to avoid "found multiple elements" errors.
        expect(screen.getAllByText('stdio').length).toBeGreaterThan(0);
        expect(screen.getAllByText('sse').length).toBeGreaterThan(0);
    });
});

// ── 3. null enabledMcpServers → all checked ──────────────────────────────────

describe('null enabledMcpServers', () => {
    it('marks all toggles as checked when enabledMcpServers is null', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
        const search = screen.getByTestId('mcp-toggle-search') as HTMLInputElement;
        expect(github.checked).toBe(true);
        expect(search.checked).toBe(true);
    });
});

// ── 4. Partial enabledMcpServers ─────────────────────────────────────────────

describe('partial enabledMcpServers', () => {
    it('only checks the enabled server', async () => {
        mockClient.workspaces.getMcpConfig.mockResolvedValue({
            availableServers: twoServers.availableServers,
            enabledMcpServers: ['github'],
        });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
        const search = screen.getByTestId('mcp-toggle-search') as HTMLInputElement;
        expect(github.checked).toBe(true);
        expect(search.checked).toBe(false);
    });
});

// ── 5. Toggle off calls PUT with correct body ────────────────────────────────

describe('toggle off', () => {
    it('calls PUT with remaining server when one is toggled off', async () => {
        mockClient.workspaces.getMcpConfig.mockResolvedValueOnce(twoServers);
        mockClient.workspaces.updateMcpConfig.mockResolvedValueOnce({});
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        expect(mockClient.workspaces.updateMcpConfig).toHaveBeenCalledWith('ws-1', { enabledMcpServers: ['search'] });
    });
});

// ── 6. Enabling last disabled server sends null ──────────────────────────────

describe('enable last disabled server', () => {
    it('sends null when all servers are enabled', async () => {
        mockClient.workspaces.getMcpConfig
            .mockResolvedValueOnce({
                availableServers: twoServers.availableServers,
                enabledMcpServers: ['github'],
            });
        mockClient.workspaces.updateMcpConfig.mockResolvedValueOnce({});
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-search'));
        });

        expect(mockClient.workspaces.updateMcpConfig).toHaveBeenCalledWith('ws-1', { enabledMcpServers: null });
    });
});

// ── 7. PUT failure reverts toggle and shows error ────────────────────────────

describe('PUT failure', () => {
    it('shows error state on PUT failure', async () => {
        mockClient.workspaces.getMcpConfig.mockResolvedValueOnce(twoServers);
        mockClient.skills.getWorkspaceConfig.mockResolvedValueOnce({ disabledSkills: [], extraSkillFolders: [] });
        mockClient.workspaces.updateMcpConfig.mockRejectedValueOnce(new Error('Network error'));
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        await act(async () => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        // The component sets error state which replaces the panel with an error message
        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
    });
});

// ── 8. Empty server list ─────────────────────────────────────────────────────

describe('empty server list', () => {
    it('shows empty state message when no servers are configured', async () => {
        mockClient.workspaces.getMcpConfig.mockResolvedValue({ availableServers: [], enabledMcpServers: null });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByText('No MCP servers configured.')).toBeTruthy();
    });
});

// ── 9. GET failure shows error ───────────────────────────────────────────────

describe('GET failure', () => {
    it('shows error text when GET fails', async () => {
        mockClient.workspaces.getMcpConfig.mockRejectedValue(new Error('Failed to fetch'));
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Failed to fetch')).toBeTruthy());
    });
});

// ── 10. Toggles disabled while saving ───────────────────────────────────────

describe('saving state', () => {
    it('disables all toggles during a pending PUT', async () => {
        let resolvePut: (v: any) => void;
        mockClient.workspaces.getMcpConfig.mockResolvedValueOnce(twoServers);
        mockClient.workspaces.updateMcpConfig.mockReturnValueOnce(new Promise((r) => { resolvePut = r; }));

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

        act(() => {
            fireEvent.click(screen.getByTestId('mcp-toggle-github'));
        });

        // While PUT is in-flight, all toggles should be disabled
        await waitFor(() => {
            const github = screen.getByTestId('mcp-toggle-github') as HTMLInputElement;
            expect(github.disabled).toBe(true);
        });

        await act(async () => { resolvePut!({}); });
    });
});

// ── 11. Agent Skills section renders ─────────────────────────────────────────

describe('Agent Skills section', () => {
    it('renders Agent Skills heading', async () => {
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        expect(screen.getAllByText('Agent Skills').length).toBeGreaterThan(0);
    });

    it('renders skills-install-btn', async () => {
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        expect(screen.getByTestId('skills-install-btn')).toBeTruthy();
    });

    it('shows empty-state when no skills are installed', async () => {
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        await waitFor(() => screen.getByTestId('skills-empty-state'));
        expect(screen.getByTestId('skills-empty-state')).toBeTruthy();
    });

    it('renders skills list when skills are returned', async () => {
        mockClient.skills.listWorkspace.mockResolvedValue([{ name: 'my-skill', description: 'A skill' }]);
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        await waitFor(() => screen.getByTestId('skills-list'));
        expect(screen.getByTestId('skill-item-my-skill')).toBeTruthy();
        expect(screen.getByText('A skill')).toBeTruthy();
    });

    it('shows delete confirmation when delete button is clicked', async () => {
        mockClient.skills.listWorkspace.mockResolvedValue([{ name: 'my-skill' }]);
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        await waitFor(() => screen.getByTestId('skills-list'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('skill-delete-btn-my-skill'));
        });
        expect(screen.getByTestId('skill-delete-confirm-my-skill')).toBeTruthy();
    });

    it('opens install dialog when + Install is clicked', async () => {
        await act(async () => { await renderTab(); });
        await navigateToSkills();
        await waitFor(() => screen.getByTestId('skills-install-btn'));
        // Mock bundled skills response for dialog
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ skills: [] }),
        } as any);
        await act(async () => {
            fireEvent.click(screen.getByTestId('skills-install-btn'));
        });
        expect(screen.getByTestId('install-skills-dialog')).toBeTruthy();
    });
});

// ── 12. Sidebar navigation ───────────────────────────────────────────────────

describe('sidebar navigation', () => {
    it('renders all three nav items in the sidebar', async () => {
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('nav-item-mcp')).toBeTruthy();
        expect(screen.getByTestId('nav-item-skills')).toBeTruthy();
        expect(screen.getByTestId('nav-item-instructions')).toBeTruthy();
    });

    it('shows MCP panel by default (mcp is active)', async () => {
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        // MCP toggles visible without navigating
        expect(screen.getByTestId('mcp-toggle-github')).toBeTruthy();
        // Skills panel not rendered yet
        expect(screen.queryByTestId('skills-install-btn')).toBeNull();
    });

    it('switching to skills nav item shows skills panel', async () => {
        await act(async () => { await renderTab(); });
        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-skills'));
        });
        expect(screen.getByTestId('skills-install-btn')).toBeTruthy();
        // MCP panel no longer visible
        expect(screen.queryByTestId('mcp-toggle-github')).toBeNull();
    });

    it('switching to instructions nav item shows instructions panel', async () => {
        await act(async () => { await renderTab(); });
        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-instructions'));
        });
        expect(screen.getByTestId('instr-tab-base')).toBeTruthy();
    });

    it('switching back to mcp nav item shows mcp panel again', async () => {
        await act(async () => { await renderTab(); });
        // Go to skills
        await act(async () => { fireEvent.click(screen.getByTestId('nav-item-skills')); });
        // Go back to mcp
        await act(async () => { fireEvent.click(screen.getByTestId('nav-item-mcp')); });
        await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
        expect(screen.getByTestId('mcp-toggle-github')).toBeTruthy();
    });
});

// ── 13. Deep URL — section reflects context + updates hash ────────────────────

describe('deep URL section routing', () => {
    it('updates location.hash to settings/skills when skills nav item is clicked', async () => {
        await act(async () => { await renderTab('ws-deep'); });
        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-skills'));
        });
        expect(location.hash).toBe('#repos/ws-deep/settings/skills');
    });

    it('updates location.hash to settings/instructions when instructions nav item is clicked', async () => {
        await act(async () => { await renderTab('ws-deep'); });
        await act(async () => {
            fireEvent.click(screen.getByTestId('nav-item-instructions'));
        });
        expect(location.hash).toBe('#repos/ws-deep/settings/instructions');
    });

    it('updates location.hash to settings/mcp when mcp nav item is clicked', async () => {
        await act(async () => { await renderTab('ws-deep'); });
        // Navigate away then back
        await act(async () => { fireEvent.click(screen.getByTestId('nav-item-skills')); });
        await act(async () => { fireEvent.click(screen.getByTestId('nav-item-mcp')); });
        expect(location.hash).toBe('#repos/ws-deep/settings/mcp');
    });
});
