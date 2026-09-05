/**
 * AC-02 — the MCP Servers panel in repo-group mode.
 *
 * A repo group is a virtual workspace with no git checkout, so nothing can write
 * a workspace-scoped server definition for it. The panel keeps enablement and the
 * per-tool allow-list (both of which live on the group workspace record and its
 * preferences file) and drops every affordance that edits a server definition.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersPanel } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';
import type { McpServerEntry } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';

const discoverMcpTools = vi.hoisted(() => vi.fn());
const getMcpServerDetail = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            discoverMcpTools: (...args: unknown[]) => discoverMcpTools(...args),
            getMcpServerDetail: (...args: unknown[]) => getMcpServerDetail(...args),
        },
    }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const servers: McpServerEntry[] = [{ name: 'github-mcp', type: 'stdio' }];

function renderPanel(overrides: Partial<Parameters<typeof McpServersPanel>[0]> = {}) {
    return render(
        <McpServersPanel
            workspaceId="group-demo"
            loading={false}
            error={null}
            saving={false}
            availableServers={servers}
            sources={{
                global: { configPath: '~/.copilot/mcp-config.json', fileExists: true, success: true, servers },
                workspace: { configPath: '.vscode/mcp.json', fileExists: false, success: true, servers: [] },
            }}
            isEnabled={() => true}
            onToggle={vi.fn()}
            groupMode
            {...overrides}
        />
    );
}

beforeEach(() => {
    discoverMcpTools.mockResolvedValue({ servers: {} });
    getMcpServerDetail.mockRejectedValue(new Error('no detail'));
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('McpServersPanel — group mode', () => {
    it('drops the add-server form and explains why', () => {
        renderPanel();
        expect(screen.queryByRole('button', { name: /Add server/ })).toBeNull();
        expect(screen.queryByRole('link', { name: /New server/ })).toBeNull();
        expect(screen.getByTestId('mcp-group-readonly-hint').textContent)
            .toMatch(/no repository checkout/);
    });

    it('drops the Configuration inspector tab (env, args, scope, delete)', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(screen.getByRole('button', { name: /Expand github-mcp/ }));
        expect(screen.queryByRole('button', { name: 'Configuration' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove this server/ })).toBeNull();
        // Enablement and the allow-list stay: the Tools tab is still offered.
        expect(screen.getByRole('button', { name: 'Tools' })).toBeTruthy();
        expect(screen.getByTestId('mcp-toggle-github-mcp')).toBeTruthy();
    });

    it('hides the repo config source row — a group has no .vscode/mcp.json', () => {
        renderPanel();
        expect(screen.queryByText('.vscode/mcp.json')).toBeNull();
        expect(screen.getByText('~/.copilot/mcp-config.json')).toBeTruthy();
    });

    it('keeps the full add/edit affordances for an ordinary repo workspace', async () => {
        const user = userEvent.setup();
        renderPanel({ workspaceId: 'repo-1', groupMode: undefined });
        expect(screen.queryByTestId('mcp-group-readonly-hint')).toBeNull();
        expect(screen.getByText('.vscode/mcp.json')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: /Expand github-mcp/ }));
        expect(screen.getByRole('button', { name: 'Configuration' })).toBeTruthy();
    });
});
