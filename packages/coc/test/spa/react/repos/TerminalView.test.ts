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
            readOnly?: boolean;
            onServerSessionCreated?: (session: typeof runningSession) => void;
        }) => React.createElement('div', {
            'data-testid': `mock-terminal-panel-${props.sessionId}`,
            'data-server-session-id': props.serverSessionId ?? '',
            'data-connection-mode': props.connectionMode ?? 'create',
            'data-active': String(props.isActive),
            'data-read-only': String(props.readOnly ?? false),
        }),
    };
});

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'terminal', 'TerminalView.tsx'
);

const runningSession = {
    id: 'sess-running',
    workspaceId: 'ws-123',
    cols: 80,
    rows: 24,
    createdAt: 1,
    lastActivity: 2,
    pid: 1234,
    status: 'running' as const,
    cwd: '/repo',
    title: 'bash',
};

const exitedSession = {
    ...runningSession,
    id: 'sess-exited',
    pid: null,
    status: 'exited' as const,
    exitedAt: 5,
    exitCode: 0,
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

    describe('AC-06: no pin surface remains', () => {
        it('does not reference pin state, controls, or the pin endpoint', () => {
            expect(source).not.toMatch(/pinTerminal|togglePin|pinned|hydratePinnedTerminals/);
        });
    });

    describe('AC-05/AC-06: hydration lists every session', () => {
        it('restores running and exited sessions alike in attach mode', async () => {
            mockFetchSessions([runningSession, exitedSession]);

            render(React.createElement(TerminalView, { workspaceId: 'ws 123' }));

            await waitFor(() => {
                expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws%20123/terminals', expect.any(Object));
            });

            const runningPanel = await screen.findByTestId('mock-terminal-panel-server-sess-running');
            expect(runningPanel.getAttribute('data-server-session-id')).toBe('sess-running');
            expect(runningPanel.getAttribute('data-connection-mode')).toBe('attach');

            const exitedPanel = await screen.findByTestId('mock-terminal-panel-server-sess-exited');
            expect(exitedPanel.getAttribute('data-connection-mode')).toBe('attach');
        });

        it('renders an exited session read-only and badged, and a live one writable', async () => {
            mockFetchSessions([runningSession, exitedSession]);

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));
            await screen.findByTestId('mock-terminal-panel-server-sess-exited');

            expect(
                screen.getByTestId('mock-terminal-panel-server-sess-exited').getAttribute('data-read-only'),
            ).toBe('true');
            expect(
                screen.getByTestId('mock-terminal-panel-server-sess-running').getAttribute('data-read-only'),
            ).toBe('false');

            fireEvent.click(screen.getByTestId('terminal-picker-btn'));
            expect(screen.getByTestId('terminal-tab-exited-badge-server-sess-exited')).toBeTruthy();
            expect(screen.queryByTestId('terminal-tab-exited-badge-server-sess-running')).toBeNull();
            expect(screen.getByTestId('terminal-tab-restart-server-sess-exited')).toBeTruthy();
            expect(screen.queryByTestId('terminal-tab-restart-server-sess-running')).toBeNull();
        });

        it('preserves the empty state when the workspace has no sessions', async () => {
            mockFetchSessions([]);

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));

            await waitFor(() => {
                expect(fetch).toHaveBeenCalledWith('/api/workspaces/ws-123/terminals', expect.any(Object));
            });
            expect(screen.getByTestId('terminal-empty-state')).toBeTruthy();
        });
    });

    describe('AC-05: restart shell here', () => {
        it('POSTs to the restart endpoint and re-keys the tab onto the new session', async () => {
            const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
                if (init?.method === 'POST') {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        json: vi.fn().mockResolvedValue({
                            session: { ...runningSession, id: 'sess-new' },
                            cwdFallback: true,
                            notice: 'Previous directory is gone; started in /repo instead.',
                        }),
                    });
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    json: vi.fn().mockResolvedValue({ sessions: [exitedSession] }),
                });
            });
            vi.stubGlobal('fetch', fetchMock);

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));
            await screen.findByTestId('mock-terminal-panel-server-sess-exited');

            fireEvent.click(screen.getByTestId('terminal-picker-btn'));
            fireEvent.click(screen.getByTestId('terminal-tab-restart-server-sess-exited'));

            await waitFor(() => {
                expect(fetchMock).toHaveBeenCalledWith(
                    '/api/workspaces/ws-123/terminals/sess-exited/restart',
                    expect.objectContaining({ method: 'POST' }),
                );
            });

            const restarted = await screen.findByTestId('mock-terminal-panel-server-sess-new');
            expect(restarted.getAttribute('data-server-session-id')).toBe('sess-new');
            expect(restarted.getAttribute('data-connection-mode')).toBe('attach');
            expect(restarted.getAttribute('data-read-only')).toBe('false');
            expect(restarted.getAttribute('data-active')).toBe('true');
            expect(screen.queryByTestId('mock-terminal-panel-server-sess-exited')).toBeNull();
            expect(screen.getByTestId('terminal-notice').textContent).toContain('Previous directory is gone');
        });

        it('surfaces a missing session instead of silently failing', async () => {
            const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
                if (init?.method === 'POST') {
                    return Promise.resolve({
                        ok: false,
                        status: 404,
                        statusText: 'Not Found',
                        json: vi.fn().mockResolvedValue({ error: 'Terminal session not found' }),
                        text: vi.fn().mockResolvedValue('{"error":"Terminal session not found"}'),
                    });
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    json: vi.fn().mockResolvedValue({ sessions: [exitedSession] }),
                });
            });
            vi.stubGlobal('fetch', fetchMock);
            vi.spyOn(console, 'error').mockImplementation(() => {});

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));
            await screen.findByTestId('mock-terminal-panel-server-sess-exited');

            fireEvent.click(screen.getByTestId('terminal-picker-btn'));
            fireEvent.click(screen.getByTestId('terminal-tab-restart-server-sess-exited'));

            await waitFor(() => {
                expect(screen.getByTestId('terminal-notice').textContent).toBe('Terminal session no longer exists.');
            });
        });
    });

    describe('tab lifecycle', () => {
        it('AC-02: closing a tab kills the server session over REST', async () => {
            const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
                if (init?.method === 'DELETE') {
                    return Promise.resolve({ ok: true, status: 204, statusText: 'No Content', json: vi.fn() });
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    json: vi.fn().mockResolvedValue({ sessions: [runningSession] }),
                });
            });
            vi.stubGlobal('fetch', fetchMock);

            render(React.createElement(TerminalView, { workspaceId: 'ws-123' }));
            await screen.findByTestId('mock-terminal-panel-server-sess-running');

            fireEvent.click(screen.getByTestId('terminal-picker-btn'));
            fireEvent.click(screen.getByTestId('terminal-tab-close-server-sess-running'));

            await waitFor(() => {
                expect(fetchMock).toHaveBeenCalledWith(
                    '/api/workspaces/ws-123/terminals/sess-running',
                    expect.objectContaining({ method: 'DELETE' }),
                );
            });
            expect(screen.queryByTestId('mock-terminal-panel-server-sess-running')).toBeNull();
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
