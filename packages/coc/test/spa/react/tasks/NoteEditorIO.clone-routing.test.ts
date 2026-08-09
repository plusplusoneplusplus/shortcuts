/**
 * Clone routing for the two NoteEditorIO adapters.
 *
 * Both adapters receive a `workspaceId` per call and must route through the
 * clone registry, so editing a markdown/note file that lives in a REMOTE
 * workspace talks to that workspace's own server instead of the local origin
 * (the bug: a remote note opened in the source canvas 404'd against the local
 * server). Local ids must keep resolving to the default client, unchanged.
 */
/* @vitest-environment node */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const makeClient = (kind: string) => ({
        kind,
        tasks: {
            getContent: vi.fn().mockResolvedValue({ content: '', path: 'p.md', mtime: 1 }),
            previewWorkspaceFile: vi.fn().mockResolvedValue({ content: '', mtime: 1 }),
            writeContent: vi.fn().mockResolvedValue({ path: 'p.md', updated: true, mtime: 2 }),
        },
        notes: { uploadImage: vi.fn().mockResolvedValue({ path: '.attachments/i.png' }) },
    });
    return {
        local: makeClient('local'),
        remote: makeClient('remote'),
        byBaseUrl: new Map<string, ReturnType<typeof makeClient>>(),
        makeClient,
    };
});

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mocks.local,
    getCocClientFor: (baseUrl: string) => {
        if (!mocks.byBaseUrl.has(baseUrl)) mocks.byBaseUrl.set(baseUrl, mocks.remote);
        return mocks.byBaseUrl.get(baseUrl);
    },
    toSpaCocRequestOptions: (o: unknown) => o,
    translateSpaCocClientError: (err: unknown) => { throw err; },
}));

import { createTasksNoteEditorIO } from '../../../../src/server/spa/client/react/tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../../../../src/server/spa/client/react/tasks/WorkspaceFileNoteEditorIO';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const REMOTE_BASE = 'http://127.0.0.1:4000';
const REMOTE_WS = 'ws-v2-8777024115df4e9eb71f789e';

beforeEach(() => {
    vi.clearAllMocks();
    resetCloneRegistryForTests();
    registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
});

describe('WorkspaceFileNoteEditorIO clone routing', () => {
    it('loads and saves a remote workspace file through the remote clone client', async () => {
        const io = createWorkspaceFileNoteEditorIO();

        await io.loadContent(REMOTE_WS, '/home/u/.coc/repos/ws/notes/plan.md');
        await io.saveContent(REMOTE_WS, '/home/u/.coc/repos/ws/notes/plan.md', '# x', 1);
        await io.uploadImage(REMOTE_WS, 'i.png', 'data:image/png;base64,AA');

        expect(mocks.remote.tasks.previewWorkspaceFile).toHaveBeenCalledTimes(1);
        expect(mocks.remote.tasks.writeContent).toHaveBeenCalledTimes(1);
        expect(mocks.remote.notes.uploadImage).toHaveBeenCalledTimes(1);
        expect(mocks.local.tasks.previewWorkspaceFile).not.toHaveBeenCalled();
        expect(mocks.local.tasks.writeContent).not.toHaveBeenCalled();
        expect(mocks.local.notes.uploadImage).not.toHaveBeenCalled();
    });

    it('keeps a local workspace id on the default client', async () => {
        const io = createWorkspaceFileNoteEditorIO();

        await io.loadContent('local-ws', 'docs/readme.md');
        await io.saveContent('local-ws', 'docs/readme.md', '# x', 1);

        expect(mocks.local.tasks.previewWorkspaceFile).toHaveBeenCalledTimes(1);
        expect(mocks.local.tasks.writeContent).toHaveBeenCalledTimes(1);
        expect(mocks.remote.tasks.previewWorkspaceFile).not.toHaveBeenCalled();
    });

    it('prefixes image URLs with the clone base for a remote workspace only', () => {
        const io = createWorkspaceFileNoteEditorIO();

        expect(io.imageApiUrl(REMOTE_WS, '.attachments/a.png')).toBe(
            `${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/image?path=.attachments%2Fa.png`,
        );
        expect(io.localImageApiUrl(REMOTE_WS, '/abs/a.png')).toBe(
            `${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/local-image?path=%2Fabs%2Fa.png`,
        );
        expect(io.imageApiUrl('local-ws', '.attachments/a.png')).toBe(
            '/api/workspaces/local-ws/notes/image?path=.attachments%2Fa.png',
        );
        expect(io.localImageApiUrl('local-ws', '/abs/a.png')).toBe(
            '/api/workspaces/local-ws/notes/local-image?path=%2Fabs%2Fa.png',
        );
    });
});

describe('TasksNoteEditorIO clone routing', () => {
    it('reads and writes a remote task file through the remote clone client', async () => {
        const io = createTasksNoteEditorIO();

        await io.loadContent(REMOTE_WS, 'plan.md');
        await io.saveContent(REMOTE_WS, 'plan.md', '# x', 1);
        await io.uploadImage(REMOTE_WS, 'i.png', 'data:image/png;base64,AA');

        expect(mocks.remote.tasks.getContent).toHaveBeenCalledTimes(1);
        expect(mocks.remote.tasks.writeContent).toHaveBeenCalledTimes(1);
        expect(mocks.remote.notes.uploadImage).toHaveBeenCalledTimes(1);
        expect(mocks.local.tasks.getContent).not.toHaveBeenCalled();
    });

    it('keeps a local workspace id on the default client', async () => {
        const io = createTasksNoteEditorIO();

        await io.loadContent('local-ws', 'plan.md');

        expect(mocks.local.tasks.getContent).toHaveBeenCalledTimes(1);
        expect(mocks.remote.tasks.getContent).not.toHaveBeenCalled();
    });

    it('prefixes image URLs with the clone base for a remote workspace only', () => {
        const io = createTasksNoteEditorIO();

        expect(io.imageApiUrl(REMOTE_WS, '.attachments/a.png')).toBe(
            `${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/image?path=.attachments%2Fa.png`,
        );
        expect(io.imageApiUrl('local-ws', '.attachments/a.png')).toBe(
            '/api/workspaces/local-ws/notes/image?path=.attachments%2Fa.png',
        );
    });
});
