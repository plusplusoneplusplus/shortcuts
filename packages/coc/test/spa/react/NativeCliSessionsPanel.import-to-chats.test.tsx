/**
 * @vitest-environment jsdom
 *
 * AC-06 / AC-07: the native session detail view offers "Import to chats" only
 * for Copilot sessions and only while `nativeCliSessions` is enabled. Clicking
 * it POSTs to the Copilot import API for the current workspace and navigates
 * to the resulting chat (new or already imported).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/features/chat/ChatHeader', () => ({
    ChatHeader: ({ viewToggle }: { viewToggle?: React.ReactNode }) => <div data-testid="chat-header">{viewToggle}</div>,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/ConversationArea', () => ({
    ConversationArea: () => <div data-testid="conversation-area" />,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/conversation/ConversationMiniMap', () => ({
    ConversationMiniMap: () => <div data-testid="conversation-minimap" />,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/FollowUpInputArea', () => ({
    FollowUpInputArea: () => <div data-testid="follow-up-input-area" />,
}));

import { NativeCliSessionsPanel } from '../../../src/server/spa/client/react/features/native-copilot-sessions/NativeCopilotSessionsPanel';
import { buildNativeCliSessionHash } from '../../../src/server/spa/client/react/layout/dashboardRoutes';
import { resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS } from '@plusplusoneplusplus/coc-client';

// Every non-Copilot provider the SPA can open a detail view for (providers not
// yet available, e.g. OpenCode, cannot reach the detail view at all).
const NON_COPILOT_PROVIDERS = AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS
    .map(d => d.id)
    .filter(id => id !== 'copilot');

const WS = 'ws-import-1';
const SESSION_ID = 'session-import-aaaa';

function jsonResponse(data: unknown, status = 200): Partial<Response> {
    return {
        ok: status < 400,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

const LIST_RESPONSE = {
    enabled: true, available: true, items: [], total: 0, searchIndexAvailable: true, limit: 50, offset: 0,
};

function detailResponse(provider: string) {
    return {
        enabled: true,
        available: true,
        session: {
            id: SESSION_ID,
            repository: 'owner/repo',
            cwd: '/somewhere/else',
            hostType: 'github',
            branch: 'main',
            summary: 'Fix the flaky test',
            createdAt: '2026-06-11T17:56:21.130Z',
            updatedAt: '2026-06-11T17:56:22.081Z',
            turns: [],
            provider,
            storePath: '/home/me/.copilot/session-store.db',
        },
    };
}

let calls: Array<{ url: string; method: string }>;
let importResult: { status: number; body: unknown };

function setup(provider: string, enabled = true): void {
    (window as unknown as { __DASHBOARD_CONFIG__: unknown }).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        features: { nativeCliSessionsEnabled: enabled },
    };
    window.location.hash = buildNativeCliSessionHash(WS, provider as never, SESSION_ID);
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method });
        if (url.includes(`/native-copilot-sessions/${SESSION_ID}/import`)) {
            return Promise.resolve(jsonResponse(importResult.body, importResult.status));
        }
        if (url.includes(`/native-cli-sessions/${SESSION_ID}`)) {
            return Promise.resolve(jsonResponse(detailResponse(provider)));
        }
        return Promise.resolve(jsonResponse(LIST_RESPONSE));
    }));
}

beforeEach(() => {
    resetCloneRegistryForTests();
    calls = [];
    importResult = { status: 201, body: { processId: 'queue_new_1', created: true } };
});

afterEach(() => {
    cleanup();
    window.location.hash = '';
    delete (window as unknown as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('NativeCliSessionsPanel — Import to chats', () => {
    it('shows the button for a Copilot session, imports into the current workspace, and opens the chat', async () => {
        setup('copilot');
        render(<NativeCliSessionsPanel workspaceId={WS} />);

        const btn = await screen.findByTestId('native-session-import-to-chats-btn');
        expect(btn.textContent).toContain('Import to chats');
        fireEvent.click(btn);

        await waitFor(() => {
            expect(window.location.hash).toBe(`#repos/${WS}/chats/queue_new_1`);
        });
        const post = calls.find(c => c.url.includes('/import'));
        expect(post).toBeDefined();
        expect(post!.method).toBe('POST');
        expect(post!.url).toContain(`/workspaces/${WS}/native-copilot-sessions/${SESSION_ID}/import`);
    });

    it('opens the existing chat when the session was already imported', async () => {
        importResult = { status: 200, body: { processId: 'queue_existing_9', created: false } };
        setup('copilot');
        render(<NativeCliSessionsPanel workspaceId={WS} />);

        fireEvent.click(await screen.findByTestId('native-session-import-to-chats-btn'));
        await waitFor(() => {
            expect(window.location.hash).toBe(`#repos/${WS}/chats/queue_existing_9`);
        });
    });

    it('shows an error and stays on the detail view when the import fails', async () => {
        importResult = { status: 404, body: { error: 'Native Copilot session not found' } };
        setup('copilot');
        render(<NativeCliSessionsPanel workspaceId={WS} />);

        fireEvent.click(await screen.findByTestId('native-session-import-to-chats-btn'));
        expect(await screen.findByTestId('native-session-import-error')).toBeTruthy();
        expect(window.location.hash).not.toContain('/chats/');
    });

    it('covers at least Claude and Codex as non-Copilot providers', () => {
        expect(NON_COPILOT_PROVIDERS).toEqual(expect.arrayContaining(['claude', 'codex']));
    });

    it.each(NON_COPILOT_PROVIDERS)('hides the button for %s sessions', async (provider) => {
        setup(provider);
        render(<NativeCliSessionsPanel workspaceId={WS} />);

        await screen.findByTestId('native-session-detail');
        expect(screen.queryByTestId('native-session-import-to-chats-btn')).toBeNull();
    });

    it('hides the button when nativeCliSessions is disabled', async () => {
        setup('copilot', false);
        render(<NativeCliSessionsPanel workspaceId={WS} />);

        await screen.findByText('CLI Sessions is disabled');
        expect(screen.queryByTestId('native-session-import-to-chats-btn')).toBeNull();
        expect(calls.some(c => c.url.includes('/import'))).toBe(false);
    });
});
