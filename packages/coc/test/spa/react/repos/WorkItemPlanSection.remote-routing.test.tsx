/**
 * @vitest-environment jsdom
 *
 * Regression: resolving a single work-item plan comment with AI must enqueue the
 * task on the workspace's OWN server.
 *
 * Bug: `handleResolveSingleComment` posted
 * `/comments/:wsId/:taskPath/batch-resolve` through the local-origin `fetchApi`.
 * The server route only validates the workspace id SHAPE (`isValidWorkspaceId`) —
 * it never resolves the workspace — so for a REMOTE clone the local server
 * answered 200 after enqueuing the AI resolve task against its own dataDir and
 * queue, under the remote workspace's id. Cross-host execution, silently.
 *
 * Fix: route through `requestForWorkspace(workspaceId, …)`. A LOCAL (unregistered)
 * id misses the clone registry and falls back to the page-origin client, so local
 * behavior stays byte-for-byte unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_WS = 'ws-47v03z';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local';
const WORK_ITEM_ID = 'wi-1';

const OPEN_COMMENT = {
    id: 'c-1',
    taskId: `__wi-plan__/${WORK_ITEM_ID}`,
    selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 },
    selectedText: 'one',
    comment: 'tighten this step',
    status: 'open' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({ html: `<pre>${content}</pre>` }),
}));

vi.mock('../../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [OPEN_COMMENT],
        loading: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
    }),
}));

import { WorkItemPlanSection } from '../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection';

const PLAN = {
    version: 1,
    content: 'one\ntwo\nthree',
    updatedAt: '2026-01-01T00:00:01.000Z',
    resolvedBy: 'user',
};

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function renderSection(workspaceId: string) {
    render(
        <WorkItemPlanSection
            workspaceId={workspaceId}
            originId="origin-1"
            workItemId={WORK_ITEM_ID}
            plan={PLAN}
            canEdit={true}
            draftContent={PLAN.content}
            onDraftChange={vi.fn()}
            onUpdated={vi.fn()}
            onError={vi.fn()}
            viewMode="preview"
            onViewModeChange={vi.fn()}
            hasUnsavedChanges={false}
        />,
    );
}

/** Click the per-comment ✅ Resolve action in the plan comment sidebar. */
async function clickResolveComment() {
    const resolveBtn = await screen.findByLabelText('Resolve');
    fireEvent.click(resolveBtn);
}

describe('WorkItemPlanSection — single-comment AI resolve routing', () => {
    let urls: string[];

    beforeEach(() => {
        resetCloneRegistryForTests();
        urls = [];
        vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
            const url = String(input);
            urls.push(url);
            // Plan version history: the component expects an array.
            if (url.includes('/versions')) return Promise.resolve(jsonResponse([]));
            return Promise.resolve(jsonResponse({}));
        }));
    });

    afterEach(() => {
        cleanup();
        resetCloneRegistryForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('regression: enqueues the AI resolve on the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        renderSection(REMOTE_WS);
        await clickResolveComment();

        await waitFor(() => {
            expect(urls.some(u => u.includes('/batch-resolve'))).toBe(true);
        });

        const url = urls.find(u => u.includes('/batch-resolve'))!;
        expect(url.startsWith(REMOTE_BASE)).toBe(true);
        expect(url).toContain(`/comments/${REMOTE_WS}/`);
        expect(url).toContain(encodeURIComponent(`__wi-plan__/${WORK_ITEM_ID}`));
    });

    it('posts the document content and the single comment id', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
        const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

        renderSection(REMOTE_WS);
        await clickResolveComment();

        await waitFor(() => {
            expect(urls.some(u => u.includes('/batch-resolve'))).toBe(true);
        });

        const call = fetchSpy.mock.calls.find(c => String(c[0]).includes('/batch-resolve'))!;
        const init = call[1] as RequestInit;
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({
            documentContent: PLAN.content,
            singleCommentId: OPEN_COMMENT.id,
        });
    });

    it('a local (unregistered) workspace keeps posting to the local origin', async () => {
        renderSection(LOCAL_WS);
        await clickResolveComment();

        await waitFor(() => {
            expect(urls.some(u => u.includes('/batch-resolve'))).toBe(true);
        });

        const url = urls.find(u => u.includes('/batch-resolve'))!;
        expect(url.startsWith(REMOTE_BASE)).toBe(false);
        expect(url.startsWith('http://127.0.0.1')).toBe(false);
        expect(url).toContain(`/comments/${LOCAL_WS}/`);
    });
});
