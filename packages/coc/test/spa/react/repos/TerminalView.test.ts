/**
 * Tests for TerminalView component source structure.
 * Uses the source-inspection pattern (reads .tsx source and asserts
 * structural contracts via string matching).
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TerminalView } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalPanel', async () => {
    const React = await import('react');
    return {
        TerminalPanel: (props: {
            sessionId: string;
            serverSessionId?: string;
            connectionMode?: 'create' | 'attach';
            isActive: boolean;
            onServerSessionCreated?: (session: typeof pinnedSession) => void;
        }) => React.createElement('div', {
            'data-testid': `mock-terminal-panel-${props.sessionId}`,
            'data-server-session-id': props.serverSessionId ?? '',
            'data-connection-mode': props.connectionMode ?? 'create',
            'data-active': String(props.isActive),
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
}));

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'terminal', 'TerminalView.tsx'
);

const pinnedSession = {
    id: 'sess-pinned',
    workspaceId: 'ws-123',
    cols: 80,
    rows: 24,
    createdAt: 1,
    lastActivity: 2,
    pid: 1234,
    pinned: true,
};

const unpinnedSession = {
    ...pinnedSession,
    id: 'sess-unpinned',
    pinned: false,
};

function mockFetchSessions(sessions: unknown[]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ sessions }),
    }));
}

describe('TerminalView', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('exports', () => {
        it('exports TerminalViewProps interface', () => {
            expect(source).toContain('export interface TerminalViewProps');
        });

        it('exports TerminalView as a named export', () => {
            expect(source).toContain('export function TerminalView');
        });
    });

    describe('props', () => {
        it('accepts workspaceId prop', () => {
            expect(source).toContain('workspaceId: string');
        });
    });

    describe('state management', () => {
        it('manages terminal tabs state', () => {
            expect(source).toContain('useState<TerminalTab[]>');
        });

        it('manages activeId state', () => {
            expect(source).toContain('activeId');
            expect(source).toContain('setActiveId');
        });

        it('does not auto-create a terminal on mount', () => {
            // No useEffect auto-creates terminals; the component starts with an empty list
            expect(source).not.toMatch(/useEffect\([^)]*terminals\.length === 0/s);
        });

        it('tracks server session ids separately from UI tab ids', () => {
            expect(source).toContain('serverSessionId?: string');
            expect(source).toContain("connectionMode: 'create' | 'attach'");
        });
    });

    describe('terminal management', () => {
        it('createTerminal generates UUID', () => {
            expect(source).toContain('crypto.randomUUID()');
        });

        it('createTerminal increments counter for default title', () => {
            expect(source).toContain('counterRef');
            expect(source).toContain('Terminal ${');
        });

        it('closeTerminal removes tab from list', () => {
            expect(source).toContain('filter');
        });

        it('closeTerminal switches active tab when closing active', () => {
            // When closing the active tab, it reassigns activeId to the last remaining tab
            expect(source).toContain('id === activeId');
            expect(source).toContain('next.length === 0');
        });

        it('closeTerminal clears activeId when last terminal is closed', () => {
            expect(source).toContain("setActiveId('')");
        });
    });

    describe('rendering', () => {
        it('renders TerminalPanel for each tab', () => {
            expect(source).toContain('<TerminalPanel');
        });

        it('uses display:none pattern for tab switching', () => {
            expect(source).toContain('display:');
            expect(source).toContain("activeId ? undefined : 'none'");
        });

        it('passes isActive prop to TerminalPanel', () => {
            expect(source).toContain('isActive={');
        });

        it('passes attach mode fields to TerminalPanel', () => {
            expect(source).toContain('serverSessionId={tab.serverSessionId}');
            expect(source).toContain('connectionMode={tab.connectionMode}');
        });

        it('passes server-created sessions back to TerminalView', () => {
            expect(source).toContain('onServerSessionCreated');
            expect(source).toContain('handleServerSessionCreated');
        });

        it('has new terminal button', () => {
            expect(source).toContain('terminal-new-btn');
        });

        it('has close button per tab', () => {
            expect(source).toContain('terminal-tab-close');
        });

        it('has data-testid terminal-view', () => {
            expect(source).toContain('data-testid="terminal-view"');
        });

        it('renders empty state when no terminals exist', () => {
            expect(source).toContain('data-testid="terminal-empty-state"');
            expect(source).toContain('No terminals open');
            expect(source).toContain('Click + to create a terminal');
        });
    });

    describe('exit handling', () => {
        it('handles onExit to mark tab as exited', () => {
            expect(source).toContain('exited');
        });

        it('handles onTitleChange', () => {
            expect(source).toContain('onTitleChange');
        });
    });

    describe('pinned terminal hydration', () => {
        it('persists pin clicks through the terminal REST endpoint', () => {
            expect(source).toContain('pinTerminal');
            expect(source).toContain('requestedPinned');
            expect(source).toContain('body.pinned');
        });

        it('does not pin tabs before a server session id exists', () => {
            expect(source).toContain('!tab.serverSessionId');
            expect(source).toContain('Waiting for terminal session');
        });

        it('surfaces pin failures and clears false pinned state for missing sessions', () => {
            expect(source).toContain('terminal-pin-error');
            expect(source).toContain('markSessionMissing');
            expect(source).toContain('Terminal session no longer exists.');
        });

        it('fetches workspace terminal sessions and restores only pinned tabs in attach mode', async () => {
            mockFetchSessions([pinnedSession, unpinnedSession]);

            render(React.createElement(TerminalView, { workspaceId: 'ws 123' }));

            await waitFor(() => {
                expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws%20123/terminals', expect.any(Object));
            });

            const restoredPanel = await screen.findByTestId('mock-terminal-panel-server-sess-pinned');
            expect(restoredPanel.getAttribute('data-server-session-id')).toBe('sess-pinned');
            expect(restoredPanel.getAttribute('data-connection-mode')).toBe('attach');
            expect(screen.queryByTestId('mock-terminal-panel-server-sess-unpinned')).toBeNull();
        });

        it('preserves the empty state when no pinned terminal sessions are returned', async () => {
            mockFetchSessions([unpinnedSession]);

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));

            await waitFor(() => {
                expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-123/terminals', expect.any(Object));
            });
            expect(screen.getByTestId('terminal-empty-state')).toBeTruthy();
            expect(screen.queryByTestId('mock-terminal-panel-server-sess-unpinned')).toBeNull();
        });

        it('keeps new terminal creation in create mode after hydration', async () => {
            mockFetchSessions([]);
            vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'client-tab-id') });

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));
            await waitFor(() => {
                expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-123/terminals', expect.any(Object));
            });

            fireEvent.click(screen.getByTestId('terminal-new-btn'));

            const createdPanel = screen.getByTestId('mock-terminal-panel-client-tab-id');
            expect(createdPanel.getAttribute('data-server-session-id')).toBe('');
            expect(createdPanel.getAttribute('data-connection-mode')).toBe('create');
            expect(screen.getByTestId('terminal-tab-title-client-tab-id').textContent).toBe('Terminal 1');
        });
    });
});
