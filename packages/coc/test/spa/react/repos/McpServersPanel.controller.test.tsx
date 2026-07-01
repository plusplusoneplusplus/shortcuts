/**
 * Integration tests for McpServersPanel ↔ controller wiring: workspace switching
 * resets the inspector and re-discovers, and the Add-server form routes through
 * the controller's REST action.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersPanel } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';
import type { McpServerEntry } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';

const discoverMcpTools = vi.hoisted(() => vi.fn());
const getMcpServerDetail = vi.hoisted(() => vi.fn());
const addMcpServer = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workspaces: {
            discoverMcpTools: (...a: unknown[]) => discoverMcpTools(...a),
            getMcpServerDetail: (...a: unknown[]) => getMcpServerDetail(...a),
            addMcpServer: (...a: unknown[]) => addMcpServer(...a),
        },
    }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

const servers: McpServerEntry[] = [{ name: 'github', type: 'stdio' }];

beforeEach(() => {
    discoverMcpTools.mockImplementation((ws: string) =>
        Promise.resolve({ servers: ws === 'ws-1' ? { github: { status: 'ok', tools: [{ name: 't1' }] } } : {} }));
    getMcpServerDetail.mockImplementation((ws: string, name: string) =>
        Promise.resolve({ description: `${ws}:${name}`, envKeys: [], args: [], toolScope: 'all', source: 'workspace', rawJson: {} }));
    addMcpServer.mockResolvedValue({ name: 'my-server', scope: 'workspace' });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('McpServersPanel — workspace switch resets inspector state', () => {
    it('collapses the open inspector and re-discovers tools for the new workspace', async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <McpServersPanel
                workspaceId="ws-1"
                loading={false}
                error={null}
                saving={false}
                availableServers={servers}
                isEnabled={() => true}
                onToggle={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github').textContent).toBe('1'));

        // Open the inspector for the ws-1 "github" server.
        await user.click(screen.getByRole('button', { name: 'Expand github' }));
        expect(await screen.findByRole('button', { name: 'Overview' })).toBeTruthy();
        await waitFor(() => expect(getMcpServerDetail).toHaveBeenCalledWith('ws-1', 'github'));

        // Switch to ws-2 (a different repo that also happens to have "github").
        rerender(
            <McpServersPanel
                workspaceId="ws-2"
                loading={false}
                error={null}
                saving={false}
                availableServers={servers}
                isEnabled={() => true}
                onToggle={vi.fn()}
            />,
        );

        // The inspector from ws-1 must be gone (expanded row was reset).
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull());
        // Tools were re-discovered for the new workspace; ws-2 has no github tools.
        expect(discoverMcpTools).toHaveBeenCalledWith('ws-1', undefined);
        expect(discoverMcpTools).toHaveBeenCalledWith('ws-2', undefined);
        await waitFor(() => expect(screen.getByTestId('mcp-tools-count-github').textContent).toBe('—'));
    });
});

describe('McpServersPanel — add server routes through the controller', () => {
    it('submits the add form via the client and refreshes the parent', async () => {
        const user = userEvent.setup();
        const onMutate = vi.fn();
        const onRefresh = vi.fn();
        render(
            <McpServersPanel
                workspaceId="ws-1"
                loading={false}
                error={null}
                saving={false}
                availableServers={[]}
                isEnabled={() => false}
                onToggle={vi.fn()}
                onMutate={onMutate}
                onRefresh={onRefresh}
            />,
        );

        await user.type(screen.getByPlaceholderText('e.g. github, postgres, internal-docs'), 'my-server');
        await user.click(screen.getByRole('button', { name: 'Add server' }));

        await waitFor(() => expect(addMcpServer).toHaveBeenCalledTimes(1));
        expect(addMcpServer).toHaveBeenCalledWith('ws-1', expect.objectContaining({
            name: 'my-server',
            type: 'stdio',
            command: 'npx',
            scope: 'workspace',
        }));
        expect(onMutate).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});
