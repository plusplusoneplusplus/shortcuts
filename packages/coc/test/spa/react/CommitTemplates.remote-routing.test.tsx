/**
 * @vitest-environment jsdom
 *
 * Regression tests: the commit-templates surface must route its workspace-scoped
 * REST calls through the clone's OWN server, not the local origin.
 *
 * Bug: useCommitTemplatesController and the shared commit-template components used
 * the bare getSpaCocClient() / local-origin fetchApi. Every /workspaces/:id/templates
 * route calls resolveWorkspaceOrFail, so for a REMOTE clone they all hard-404'd
 * ("Workspace not found") — and the list 404 is swallowed into `setTemplates([])`,
 * so the Templates tab silently showed "No templates yet". The commit-hash blur
 * check likewise always reported "Commit not found or not reachable".
 *
 * Fix: getCocClientForWorkspace / requestForWorkspace. A LOCAL (unregistered)
 * workspace misses the registry and keeps the relative local origin — unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { RepoTemplatesTab } from '../../../src/server/spa/client/react/features/templates/RepoTemplatesTab';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

const REMOTE_WS = 'ws-remote-tpl';
const REMOTE_BASE = 'http://127.0.0.1:4002';
const LOCAL_WS = 'ws-local-tpl';

const SAMPLE_TEMPLATES = [
    { name: 'add-config-field', kind: 'commit' as const, commitHash: 'abc123def456', createdAt: '2025-01-01T00:00:00Z' },
];

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
        if (url.includes('/git/commits/')) {
            return Promise.resolve(jsonResponse({ subject: 'a real commit' }));
        }
        if (url.includes('/templates')) {
            return Promise.resolve(jsonResponse({ templates: SAMPLE_TEMPLATES }));
        }
        return Promise.resolve(jsonResponse({}));
    });
}

describe('commit templates — remote-clone request routing', () => {
    let urls: string[];

    beforeEach(() => {
        urls = [];
        resetCloneRegistryForTests();
        vi.stubGlobal('fetch', makeFetchSpy(urls));
    });

    afterEach(() => {
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('regression: the template list loads from the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<Wrap><RepoTemplatesTab workspaceId={REMOTE_WS} /></Wrap>);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${REMOTE_WS}/templates`))).toBe(true);
        });

        const listUrl = urls.find(u => u.includes(`/workspaces/${REMOTE_WS}/templates`));
        expect(listUrl!.startsWith(REMOTE_BASE)).toBe(true);

        // No workspace-scoped templates call falls through to the local origin.
        for (const u of urls.filter(x => x.includes(`/workspaces/${REMOTE_WS}/`))) {
            expect(u.startsWith(REMOTE_BASE)).toBe(true);
        }
    });

    it('the template list for a local (unregistered) workspace keeps using the local origin', async () => {
        render(<Wrap><RepoTemplatesTab workspaceId={LOCAL_WS} /></Wrap>);

        await waitFor(() => {
            expect(urls.some(u => u.includes(`/workspaces/${LOCAL_WS}/templates`))).toBe(true);
        });

        const listUrl = urls.find(u => u.includes(`/workspaces/${LOCAL_WS}/templates`));
        expect(listUrl!.startsWith(REMOTE_BASE)).toBe(false);
    });

    it('regression: commit-hash validation on blur hits the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        render(<Wrap><RepoTemplatesTab workspaceId={REMOTE_WS} /></Wrap>);

        await waitFor(() => expect(screen.getByTestId('templates-new-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('templates-new-btn'));

        await waitFor(() => expect(screen.getByTestId('template-commit-input')).toBeTruthy());
        const input = screen.getByTestId('template-commit-input');
        fireEvent.change(input, { target: { value: 'abc123f' } });
        fireEvent.blur(input);

        await waitFor(() => {
            expect(urls.some(u => u.includes('/git/commits/abc123f'))).toBe(true);
        });

        const commitUrl = urls.find(u => u.includes('/git/commits/abc123f'));
        expect(commitUrl!.startsWith(REMOTE_BASE)).toBe(true);
        // The remote lookup succeeded, so the form reports a valid commit.
        await waitFor(() => expect(screen.getByText(/a real commit/)).toBeTruthy());
    });

    it('commit-hash validation for a local workspace uses the local origin', async () => {
        render(<Wrap><RepoTemplatesTab workspaceId={LOCAL_WS} /></Wrap>);

        await waitFor(() => expect(screen.getByTestId('templates-new-btn')).toBeTruthy());
        fireEvent.click(screen.getByTestId('templates-new-btn'));

        await waitFor(() => expect(screen.getByTestId('template-commit-input')).toBeTruthy());
        const input = screen.getByTestId('template-commit-input');
        fireEvent.change(input, { target: { value: 'def456a' } });
        fireEvent.blur(input);

        await waitFor(() => {
            expect(urls.some(u => u.includes('/git/commits/def456a'))).toBe(true);
        });

        const commitUrl = urls.find(u => u.includes('/git/commits/def456a'));
        expect(commitUrl!.startsWith(REMOTE_BASE)).toBe(false);
    });
});
