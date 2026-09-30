/**
 * @vitest-environment jsdom
 *
 * ImportCopilotChatDialog — the chat-list picker for importing native Copilot
 * CLI sessions (AC-04/AC-05). Drives the real dialog through a stubbed `fetch`
 * and asserts the list/import requests and the `onImported` callback.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import {
    ImportCopilotChatDialog,
    isSameFolderPath,
} from '../../../src/server/spa/client/react/features/chat/ImportCopilotChatDialog';
import { resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

function jsonResponse(data: unknown, status = 200): Partial<Response> {
    return {
        ok: status < 400,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function item(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sess-new',
        repository: 'owner/other',
        cwd: '/elsewhere/other',
        hostType: 'github',
        branch: 'main',
        summaryPreview: 'Fix the flaky test',
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-02T00:00:00Z',
        turnCount: 3,
        matchSnippets: [],
        ...overrides,
    };
}

let requests: Array<{ url: string; method: string }>;
let listItems: ReturnType<typeof item>[];

beforeEach(() => {
    resetCloneRegistryForTests();
    requests = [];
    listItems = [item(), item({ id: 'sess-old', summaryPreview: 'Old one', importedProcessId: 'queue_existing' })];
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();
        requests.push({ url, method });
        if (url.includes('/repo-groups/group-demo')) {
            return Promise.resolve(jsonResponse({
                id: 'group-demo',
                members: [
                    { workspaceId: 'ws-gone', stale: true, staleReason: 'path-missing' },
                    { workspaceId: 'ws-a', stale: false, name: 'Repo A', rootPath: '/code/a' },
                    { workspaceId: 'ws-b', stale: false, name: 'Repo B', rootPath: '/code/b' },
                ],
            }));
        }
        if (method === 'POST' && url.includes('/import')) {
            return Promise.resolve(jsonResponse({ processId: 'queue_new', created: true }, 201));
        }
        if (url.includes('/native-copilot-sessions')) {
            return Promise.resolve(jsonResponse({
                enabled: true, available: true, items: listItems, total: listItems.length, limit: 20, offset: 0,
            }));
        }
        return Promise.resolve(jsonResponse({}));
    }));
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('ImportCopilotChatDialog', () => {
    it('lists all Copilot sessions (scope=all) for the current repo', async () => {
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="ws-1" onImported={vi.fn()} />);

        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));
        const listUrl = requests.find(r => r.url.includes('/workspaces/ws-1/native-copilot-sessions'))!.url;
        expect(listUrl).toContain('scope=all');
        expect(screen.getByText('Fix the flaky test')).toBeTruthy();
        expect(screen.getAllByTestId('import-copilot-chat-imported-badge')).toHaveLength(1);
        expect(screen.queryByTestId('import-copilot-chat-member-select')).toBeNull();
    });

    it('imports a session into the current repo and reports the new process id', async () => {
        const onImported = vi.fn();
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="ws-1" onImported={onImported} />);

        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));
        const buttons = screen.getAllByTestId('import-copilot-chat-import-btn');
        expect(buttons[0].textContent).toContain('Import');
        fireEvent.click(buttons[0]);

        await waitFor(() => expect(onImported).toHaveBeenCalledWith('ws-1', 'queue_new'));
        const post = requests.find(r => r.method === 'POST')!;
        expect(post.url).toContain('/workspaces/ws-1/native-copilot-sessions/sess-new/import');
    });

    it('opens the existing chat for an already-imported session without calling import', async () => {
        const onImported = vi.fn();
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="ws-1" onImported={onImported} />);

        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));
        const buttons = screen.getAllByTestId('import-copilot-chat-import-btn');
        expect(buttons[1].textContent).toContain('Open');
        fireEvent.click(buttons[1]);

        expect(onImported).toHaveBeenCalledWith('ws-1', 'queue_existing');
        expect(requests.some(r => r.method === 'POST')).toBe(false);
    });

    it('passes the search box text as the native q search', async () => {
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="ws-1" onImported={vi.fn()} />);
        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));

        fireEvent.change(screen.getByTestId('import-copilot-chat-search'), { target: { value: 'flaky' } });

        await waitFor(() => expect(requests.some(r => r.url.includes('q=flaky'))).toBe(true));
    });

    it('in a repo-group view shows a member dropdown (first live member) and imports into the chosen repo', async () => {
        const onImported = vi.fn();
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="group-demo" onImported={onImported} />);

        const select = await screen.findByTestId('import-copilot-chat-member-select') as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe('ws-a'));
        expect(Array.from(select.options).map(o => o.value)).toEqual(['ws-a', 'ws-b']);
        await waitFor(() => expect(requests.some(r => r.url.includes('/workspaces/ws-a/native-copilot-sessions'))).toBe(true));

        fireEvent.change(select, { target: { value: 'ws-b' } });
        await waitFor(() => expect(requests.some(r => r.url.includes('/workspaces/ws-b/native-copilot-sessions'))).toBe(true));
        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));

        fireEvent.click(screen.getAllByTestId('import-copilot-chat-import-btn')[0]);
        await waitFor(() => expect(onImported).toHaveBeenCalledWith('ws-b', 'queue_new'));
        expect(requests.find(r => r.method === 'POST')!.url).toContain('/workspaces/ws-b/native-copilot-sessions/sess-new/import');
        expect(requests.some(r => r.url.includes('/workspaces/group-demo/native-copilot-sessions'))).toBe(false);
    });

    it('notes sessions started in a different folder than the target repo', async () => {
        listItems = [item({ cwd: '/elsewhere/other' }), item({ id: 'sess-same', cwd: '/code/b/' })];
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="group-demo" onImported={vi.fn()} />);

        const select = await screen.findByTestId('import-copilot-chat-member-select') as HTMLSelectElement;
        await waitFor(() => expect(select.value).toBe('ws-a'));
        fireEvent.change(select, { target: { value: 'ws-b' } });
        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-row')).toHaveLength(2));
        await waitFor(() => expect(screen.getAllByTestId('import-copilot-chat-cwd-note')).toHaveLength(1));
    });

    it('shows the unavailable reason when the Copilot store is missing', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
            enabled: true, available: false, reason: 'db-missing', items: [], total: 0, limit: 20, offset: 0,
        }))));
        renderWithProviders(<ImportCopilotChatDialog open onClose={vi.fn()} workspaceId="ws-1" onImported={vi.fn()} />);

        const error = await screen.findByTestId('import-copilot-chat-error');
        expect(error.textContent).toContain('session-store.db');
    });
});

describe('isSameFolderPath', () => {
    it('ignores slash style, trailing slashes, and Windows drive case', () => {
        expect(isSameFolderPath('/code/a/', '/code/a')).toBe(true);
        expect(isSameFolderPath('C:\\Code\\A', 'c:/code/a/')).toBe(true);
        expect(isSameFolderPath('/code/a', '/code/b')).toBe(false);
        expect(isSameFolderPath(null, '/code/a')).toBe(false);
    });
});
