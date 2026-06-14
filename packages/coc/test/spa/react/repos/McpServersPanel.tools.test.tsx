/**
 * Tests for the MCP Servers panel Tools tab — live discovery, row counts,
 * search, collapsible schema, per-tool toggle, and bulk enable/disable
 * (AC-02 + AC-03).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersPanel } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';
import type { McpServerEntry } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';

const discoverMcpTools = vi.hoisted(() => vi.fn());
const updateMcpConfig = vi.hoisted(() => vi.fn());
const getMcpServerDetail = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            discoverMcpTools: (...args: unknown[]) => discoverMcpTools(...args),
            updateMcpConfig: (...args: unknown[]) => updateMcpConfig(...args),
            getMcpServerDetail: (...args: unknown[]) => getMcpServerDetail(...args),
        },
    }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const servers: McpServerEntry[] = [
    { name: 'github-mcp', type: 'stdio' },
    { name: 'search-mcp', type: 'sse' },
];

function renderPanel(overrides: Partial<Parameters<typeof McpServersPanel>[0]> = {}) {
    return render(
        <McpServersPanel
            workspaceId="ws-1"
            loading={false}
            error={null}
            saving={false}
            availableServers={servers}
            isEnabled={() => true}
            enabledMcpServers={null}
            onToggle={vi.fn()}
            {...overrides}
        />
    );
}

beforeEach(() => {
    discoverMcpTools.mockResolvedValue({
        servers: {
            'github-mcp': {
                status: 'ok',
                tools: [
                    { name: 'create_issue', description: 'Create a new issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
                    { name: 'list_issues', description: 'List repository issues' },
                ],
            },
            'search-mcp': { status: 'error', tools: [], error: 'ECONNREFUSED' },
        },
    });
    updateMcpConfig.mockResolvedValue({ workspace: {} });
    getMcpServerDetail.mockRejectedValue(new Error('no detail'));
});

afterEach(() => {
    vi.clearAllMocks();
});

async function openToolsTab(serverName: string) {
    const user = userEvent.setup();
    // Expand the server row.
    await user.click(screen.getByRole('button', { name: new RegExp(`Expand ${serverName}`) }));
    // Switch to the Tools inspector tab.
    await user.click(screen.getByRole('button', { name: 'Tools' }));
    return user;
}

describe('McpServersPanel — Tools tab discovery', () => {
    it('eagerly discovers tools and populates the per-row count', async () => {
        renderPanel();
        await waitFor(() => {
            expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2');
        });
        // Unreachable server shows an error marker, not a number.
        expect(screen.getByTestId('mcp-tools-count-search-mcp').textContent).toBe('!');
        expect(discoverMcpTools).toHaveBeenCalledWith('ws-1', undefined);
    });

    it('shows the discovered tools with name + description in the Tools tab', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2'));
        await openToolsTab('github-mcp');

        const list = await screen.findByTestId('mcp-tool-list');
        expect(within(list).getByText('create_issue')).toBeTruthy();
        expect(within(list).getByText('Create a new issue')).toBeTruthy();
        expect(within(list).getByText('list_issues')).toBeTruthy();
    });

    it('expands the collapsible input schema', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2'));
        const user = await openToolsTab('github-mcp');

        expect(screen.queryByText(/"properties"/)).toBeNull();
        await user.click(screen.getAllByText('Show input schema')[0]);
        expect(screen.getByText(/"properties"/)).toBeTruthy();
    });

    it('filters the tool list with the search box', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2'));
        const user = await openToolsTab('github-mcp');

        await user.type(screen.getByTestId('mcp-tools-search'), 'create');
        const list = screen.getByTestId('mcp-tool-list');
        expect(within(list).queryByText('create_issue')).toBeTruthy();
        expect(within(list).queryByText('list_issues')).toBeNull();
    });

    it('shows a per-server error state for an unreachable server', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-search-mcp').textContent).toBe('!'));
        await openToolsTab('search-mcp');
        expect(await screen.findByTestId('mcp-tools-error')).toBeTruthy();
        expect(screen.getByText(/ECONNREFUSED/)).toBeTruthy();
    });
});

describe('McpServersPanel — Tools tab persistence (allow-list)', () => {
    it('persists a toggle-off as the complement of discovered tools', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2'));
        const user = await openToolsTab('github-mcp');

        await user.click(await screen.findByTestId('mcp-tool-toggle-create_issue'));
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalled());
        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', {
            enabledMcpServers: null,
            enabledMcpTools: { 'github-mcp': ['list_issues'] },
        });
    });

    it('Disable all writes an empty allow-list for the server', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('2'));
        const user = await openToolsTab('github-mcp');

        await user.click(await screen.findByTestId('mcp-tools-disable-all'));
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalled());
        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', {
            enabledMcpServers: null,
            enabledMcpTools: { 'github-mcp': [] },
        });
    });

    it('Enable all clears the server entry (no entry = all on)', async () => {
        renderPanel({ enabledMcpTools: { 'github-mcp': ['list_issues'] } });
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('1/2'));
        const user = await openToolsTab('github-mcp');

        await user.click(await screen.findByTestId('mcp-tools-enable-all'));
        await waitFor(() => expect(updateMcpConfig).toHaveBeenCalled());
        expect(updateMcpConfig).toHaveBeenCalledWith('ws-1', {
            enabledMcpServers: null,
            enabledMcpTools: null,
        });
    });

    it('reflects a pre-existing allow-list in the tool toggles', async () => {
        renderPanel({ enabledMcpTools: { 'github-mcp': ['list_issues'] } });
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github-mcp').textContent).toBe('1/2'));
        await openToolsTab('github-mcp');

        const createToggle = await screen.findByTestId('mcp-tool-toggle-create_issue') as HTMLInputElement;
        const listToggle = screen.getByTestId('mcp-tool-toggle-list_issues') as HTMLInputElement;
        expect(createToggle.checked).toBe(false);
        expect(listToggle.checked).toBe(true);
    });
});
