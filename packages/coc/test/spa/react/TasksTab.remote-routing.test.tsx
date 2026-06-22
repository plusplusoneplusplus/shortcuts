/**
 * @vitest-environment jsdom
 *
 * Regression tests: the Tasks tab must route its workspace-scoped REST calls
 * through the clone's OWN server, not the local origin.
 *
 * Bug: useTaskTree and TasksPanel fetched the task tree (GET /workspaces/:id/summary)
 * and the task settings (GET /workspaces/:id/tasks/settings) via the bare
 * getSpaCocClient(), which always targets the LOCAL server. For a REMOTE clone
 * those ids only resolve on their owning server, so both 404'd and the Tasks tab
 * loaded nothing for a remote repo.
 *
 * Fix: route both through useCocClient(wsId). These tests register a remote
 * baseUrl via registerCloneBaseUrls and assert the summary + tasks/settings
 * fetches carry that base (no local fallthrough); a local (unregistered)
 * workspace keeps using the relative local origin — byte-for-byte unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { registerCloneBaseUrls } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { useTaskTree } from '../../../src/server/spa/client/react/tasks/hooks/useTaskTree';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

const REMOTE_WS = 'ws-47v03z';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local';

const EMPTY_TREE = { name: 'tasks', relativePath: '', children: [], documentGroups: [], singleDocuments: [] };

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function makeFetchSpy(urls: string[]) {
    return vi.fn((input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('comment-counts')) {
            return Promise.resolve(jsonResponse({ counts: {} }));
        }
        if (url.includes('/tasks/settings')) {
            return Promise.resolve(jsonResponse({ folderPath: '.vscode/tasks', folderPaths: [] }));
        }
        // task tree (/summary) and any other workspace-scoped read
        return Promise.resolve(jsonResponse({ workflows: [], tasks: EMPTY_TREE }));
    });
}

describe('Tasks tab — remote-clone request routing', () => {
    let urls: string[];

    beforeEach(() => {
        urls = [];
        vi.stubGlobal('fetch', makeFetchSpy(urls));
    });

    afterEach(() => {
        registerCloneBaseUrls([]); // clear the module-level registry between tests
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('regression: useTaskTree loads the task tree from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(() => useTaskTree(REMOTE_WS));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const summaryUrl = urls.find(u => u.includes(`/workspaces/${REMOTE_WS}/summary`));
        expect(summaryUrl).toBeTruthy();
        expect(summaryUrl!.startsWith(REMOTE_BASE)).toBe(true);
        expect(summaryUrl).toContain('showArchived=true');

        // Every workspace-scoped Tasks call (tree + comment-counts) hits the
        // owning server — no local fallthrough.
        const wsScoped = urls.filter(u => u.includes(`/workspaces/${REMOTE_WS}/`));
        expect(wsScoped.length).toBeGreaterThan(1);
        for (const u of wsScoped) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('useTaskTree for a local (unregistered) workspace keeps using the local origin', async () => {
        const { result } = renderHook(() => useTaskTree(LOCAL_WS));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const summaryUrl = urls.find(u => u.includes(`/workspaces/${LOCAL_WS}/summary`));
        expect(summaryUrl).toBeTruthy();
        expect(summaryUrl!.startsWith(REMOTE_BASE)).toBe(false);
    });

    it('regression: TasksPanel loads task settings from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<Wrap><TasksPanel wsId={REMOTE_WS} /></Wrap>);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${REMOTE_WS}/tasks/settings`))).toBe(true);
        });

        const settingsUrl = urls.find(u => u.includes(`/workspaces/${REMOTE_WS}/tasks/settings`));
        expect(settingsUrl!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('TasksPanel task settings for a local workspace uses the local origin', async () => {
        render(<Wrap><TasksPanel wsId={LOCAL_WS} /></Wrap>);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${LOCAL_WS}/tasks/settings`))).toBe(true);
        });

        const settingsUrl = urls.find(u => u.includes(`/workspaces/${LOCAL_WS}/tasks/settings`));
        expect(settingsUrl!.startsWith(REMOTE_BASE)).toBe(false);
    });
});
