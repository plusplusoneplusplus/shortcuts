/**
 * Tests for McpServersPanel — loading/error/empty states, toggle checkbox.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServersPanel } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';
import type { McpServerEntry } from '../../../../src/server/spa/client/react/features/skills/McpServersPanel';

const servers: McpServerEntry[] = [
    { name: 'github-mcp', type: 'stdio' },
    { name: 'search-mcp', type: 'sse' },
];

function renderPanel(overrides: Partial<Parameters<typeof McpServersPanel>[0]> = {}) {
    const onToggle = vi.fn();
    const result = render(
        <McpServersPanel
            loading={false}
            error={null}
            saving={false}
            availableServers={[]}
            isEnabled={() => false}
            onToggle={onToggle}
            {...overrides}
        />
    );
    return { ...result, onToggle };
}

describe('McpServersPanel — loading state', () => {
    it('shows loading text when loading is true', () => {
        renderPanel({ loading: true });
        expect(screen.getByText(/loading/i)).toBeTruthy();
    });
});

describe('McpServersPanel — error state', () => {
    it('shows error text when error is set', () => {
        renderPanel({ error: 'Network error' });
        expect(screen.getByText('Network error')).toBeTruthy();
    });
});

describe('McpServersPanel — empty state', () => {
    it('shows empty message when no servers configured', () => {
        renderPanel({ availableServers: [] });
        expect(screen.getByText(/No MCP servers configured/i)).toBeTruthy();
    });

    it('does not show empty message when servers are present', () => {
        renderPanel({ availableServers: servers });
        expect(screen.queryByText(/No MCP servers configured/i)).toBeNull();
    });
});

describe('McpServersPanel — server list', () => {
    it('renders one toggle per server entry', () => {
        renderPanel({ availableServers: servers });
        expect(screen.getByTestId('mcp-toggle-github-mcp')).toBeTruthy();
        expect(screen.getByTestId('mcp-toggle-search-mcp')).toBeTruthy();
    });

    it('renders server names', () => {
        renderPanel({ availableServers: servers });
        expect(screen.getByText('github-mcp')).toBeTruthy();
        expect(screen.getByText('search-mcp')).toBeTruthy();
    });

    it('calls onToggle with correct server name and checked value', async () => {
        const user = userEvent.setup();
        const { onToggle } = renderPanel({ availableServers: servers, isEnabled: () => false });
        const checkbox = screen.getByTestId('mcp-toggle-github-mcp');
        await user.click(checkbox);
        expect(onToggle).toHaveBeenCalledWith('github-mcp', true);
    });

    it('reflects isEnabled state in checkbox', () => {
        renderPanel({
            availableServers: servers,
            isEnabled: (name) => name === 'github-mcp',
        });
        const enabledToggle = screen.getByTestId('mcp-toggle-github-mcp') as HTMLInputElement;
        const disabledToggle = screen.getByTestId('mcp-toggle-search-mcp') as HTMLInputElement;
        expect(enabledToggle.checked).toBe(true);
        expect(disabledToggle.checked).toBe(false);
    });
});

describe('McpServersPanel — source sections', () => {
    it('renders global and workspace section headings, paths, and source-specific empty states', () => {
        renderPanel({
            sources: {
                global: {
                    configPath: '~/.copilot/mcp-config.json',
                    fileExists: false,
                    success: true,
                    servers: [],
                },
                workspace: {
                    configPath: '.vscode/mcp.json',
                    fileExists: false,
                    success: true,
                    servers: [],
                },
            },
        });

        expect(screen.getByText('Global MCP servers')).toBeTruthy();
        expect(screen.getByText('Workspace MCP servers')).toBeTruthy();
        expect(screen.getByText('~/.copilot/mcp-config.json')).toBeTruthy();
        expect(screen.getByText('.vscode/mcp.json')).toBeTruthy();
        expect(screen.getByText('No global MCP servers configured.')).toBeTruthy();
        expect(screen.getByText('No workspace MCP servers configured in .vscode/mcp.json.')).toBeTruthy();
    });

    it('disables overridden global rows and leaves the workspace row toggleable', async () => {
        const user = userEvent.setup();
        const { onToggle } = renderPanel({
            isEnabled: () => true,
            sources: {
                global: {
                    configPath: '~/.copilot/mcp-config.json',
                    fileExists: true,
                    success: true,
                    servers: [
                        { name: 'shared', type: 'stdio', command: 'global-cmd', source: 'global', effective: false, overriddenBy: 'workspace' },
                    ],
                },
                workspace: {
                    configPath: '.vscode/mcp.json',
                    fileExists: true,
                    success: true,
                    servers: [
                        { name: 'shared', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: true },
                    ],
                },
            },
        });

        const globalToggle = screen.getByTestId('mcp-toggle-global-shared') as HTMLInputElement;
        const workspaceToggle = screen.getByTestId('mcp-toggle-workspace-shared') as HTMLInputElement;
        expect(screen.getByText('Overridden by workspace')).toBeTruthy();
        expect(globalToggle.disabled).toBe(true);
        expect(globalToggle.checked).toBe(false);
        expect(workspaceToggle.disabled).toBe(false);
        expect(workspaceToggle.checked).toBe(true);

        await user.click(workspaceToggle);
        expect(onToggle).toHaveBeenCalledWith('shared', false);
    });

    it('shows source-scoped errors without hiding the other source section', () => {
        renderPanel({
            sources: {
                global: {
                    configPath: '~/.copilot/mcp-config.json',
                    fileExists: true,
                    success: false,
                    error: 'Failed to parse MCP config: bad global JSON',
                    servers: [],
                },
                workspace: {
                    configPath: '.vscode/mcp.json',
                    fileExists: true,
                    success: true,
                    servers: [
                        { name: 'workspace-only', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: true },
                    ],
                },
            },
        });

        expect(screen.getByText('Failed to parse MCP config: bad global JSON')).toBeTruthy();
        expect(screen.getByText('Workspace MCP servers')).toBeTruthy();
        expect(screen.getByText('workspace-only')).toBeTruthy();
    });

    it('calls onRefresh when the refresh button is clicked', async () => {
        const user = userEvent.setup();
        const onRefresh = vi.fn();
        renderPanel({ onRefresh });

        await user.click(screen.getByRole('button', { name: 'Refresh' }));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});
