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

describe('McpServersPanel — configuration sources', () => {
    it('renders source paths when sources are provided', () => {
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

        expect(screen.getByText('Configuration sources')).toBeTruthy();
        expect(screen.getByText('.vscode/mcp.json')).toBeTruthy();
        expect(screen.getByText('~/.copilot/mcp-config.json')).toBeTruthy();
    });

    it('disables overridden server toggles', () => {
        renderPanel({
            availableServers: [
                { name: 'shared', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: false, overriddenBy: 'workspace' },
            ],
            isEnabled: () => true,
        });

        const toggle = screen.getByTestId('mcp-toggle-shared') as HTMLInputElement;
        expect(toggle.disabled).toBe(true);
        expect(toggle.checked).toBe(false);
    });

    it('allows toggling non-overridden servers', async () => {
        const user = userEvent.setup();
        const { onToggle } = renderPanel({
            availableServers: [
                { name: 'shared', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: true },
            ],
            isEnabled: () => true,
        });

        const toggle = screen.getByTestId('mcp-toggle-shared') as HTMLInputElement;
        expect(toggle.disabled).toBe(false);
        expect(toggle.checked).toBe(true);

        await user.click(toggle);
        expect(onToggle).toHaveBeenCalledWith('shared', false);
    });

    it('shows servers from sources even if they have errors', () => {
        renderPanel({
            availableServers: [
                { name: 'workspace-only', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: true },
            ],
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

        expect(screen.getByText('workspace-only')).toBeTruthy();
    });

    it('calls onRefresh when the refresh button is clicked', async () => {
        const user = userEvent.setup();
        const onRefresh = vi.fn();
        renderPanel({ onRefresh });

        const buttons = screen.getAllByRole('button');
        const refreshBtn = buttons.find(b => b.textContent?.includes('Refresh status'));
        expect(refreshBtn).toBeTruthy();
        await user.click(refreshBtn!);
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });
});

describe('McpServersPanel — page title', () => {
    it('renders the MCP servers heading', () => {
        renderPanel();
        expect(screen.getByText('MCP servers')).toBeTruthy();
    });
});
