/**
 * @vitest-environment jsdom
 *
 * Regression tests: the native CLI sessions panel must read sessions from the
 * server that OWNS the workspace, not the local origin.
 *
 * Bug: the panel called `getSpaCocClient().nativeCliSessions.list/get`, which
 * always targets the LOCAL server. `/workspaces/:id/native-cli-sessions*` is
 * workspace-guarded and scopes the provider to `workspace.rootPath`, so for a
 * REMOTE clone both calls 404'd ("Workspace not found") — and the session logs
 * physically live only on the machine hosting the clone anyway.
 *
 * Fix: `useCocClient(workspaceId)`. These tests register a remote baseUrl via
 * `registerCloneBaseUrls`, spy `fetch`, and assert the list + detail URLs carry
 * that base; a local (unregistered) workspace keeps using the relative local
 * origin — byte-for-byte unchanged.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// Stub the heavy chat sub-components — this suite only asserts request routing.
vi.mock('../../../src/server/spa/client/react/features/chat/ChatHeader', () => ({
    ChatHeader: () => <div data-testid="chat-header" />,
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
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-remote-2';
const REMOTE_BASE = 'http://127.0.0.1:4012';
const LOCAL_WS = 'ws-local-2';
const SESSION_ID = 'session-aaaa-bbbb';

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

const LIST_RESPONSE = {
    enabled: true,
    available: true,
    items: [],
    total: 0,
    searchIndexAvailable: true,
    limit: 50,
    offset: 0,
};

const DETAIL_RESPONSE = {
    enabled: true,
    available: true,
    session: {
        id: SESSION_ID,
        repository: 'owner/repo',
        cwd: '/workspace/path',
        hostType: 'github',
        branch: 'main',
        summary: 'summary',
        createdAt: '2026-06-11T17:56:21.130Z',
        updatedAt: '2026-06-11T17:56:22.081Z',
        turns: [],
        provider: 'copilot',
        storePath: '/home/me/.copilot/session-store.db',
    },
};

let urls: string[];

function setFlag(): void {
    (window as unknown as { __DASHBOARD_CONFIG__: unknown }).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        features: { nativeCliSessionsEnabled: true },
    };
}

beforeEach(() => {
    resetCloneRegistryForTests();
    setFlag();
    window.location.hash = '';
    urls = [];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        return Promise.resolve(jsonResponse(
            url.includes(`/native-cli-sessions/${SESSION_ID}`) ? DETAIL_RESPONSE : LIST_RESPONSE,
        ));
    }));
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    window.location.hash = '';
    delete (window as unknown as { __DASHBOARD_CONFIG__?: unknown }).__DASHBOARD_CONFIG__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('NativeCliSessionsPanel — remote-clone request routing', () => {
    it('regression: lists sessions from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<NativeCliSessionsPanel workspaceId={REMOTE_WS} />);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${REMOTE_WS}/native-cli-sessions`))).toBe(true);
        });
        const listUrl = urls.find(u => u.includes(`/workspaces/${REMOTE_WS}/native-cli-sessions`));
        expect(listUrl!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('lists sessions for a local (unregistered) workspace from the local origin', async () => {
        render(<NativeCliSessionsPanel workspaceId={LOCAL_WS} />);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${LOCAL_WS}/native-cli-sessions`))).toBe(true);
        });
        const listUrl = urls.find(u => u.includes(`/workspaces/${LOCAL_WS}/native-cli-sessions`));
        expect(listUrl!.startsWith(REMOTE_BASE)).toBe(false);
        expect(listUrl!.startsWith('http')).toBe(false); // relative to the page origin
    });

    it('regression: loads the selected session detail from the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
        window.location.hash = buildNativeCliSessionHash(REMOTE_WS, 'copilot', SESSION_ID);

        render(<NativeCliSessionsPanel workspaceId={REMOTE_WS} />);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/native-cli-sessions/${SESSION_ID}`))).toBe(true);
        });
        const detailUrl = urls.find(u => u.includes(`/native-cli-sessions/${SESSION_ID}`));
        expect(detailUrl!.startsWith(REMOTE_BASE)).toBe(true);

        // No workspace-scoped call leaked to the local server.
        for (const u of urls.filter(u => u.includes(`/workspaces/${REMOTE_WS}/`))) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('loads the selected session detail for a local workspace from the local origin', async () => {
        window.location.hash = buildNativeCliSessionHash(LOCAL_WS, 'copilot', SESSION_ID);

        render(<NativeCliSessionsPanel workspaceId={LOCAL_WS} />);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/native-cli-sessions/${SESSION_ID}`))).toBe(true);
        });
        const detailUrl = urls.find(u => u.includes(`/native-cli-sessions/${SESSION_ID}`));
        expect(detailUrl!.startsWith('http')).toBe(false);
    });
});
