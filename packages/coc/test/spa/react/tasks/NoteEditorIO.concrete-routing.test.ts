import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTasksNoteEditorIO } from '../../../../src/server/spa/client/react/tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../../../../src/server/spa/client/react/tasks/WorkspaceFileNoteEditorIO';
import {
    registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const mocks = vi.hoisted(() => {
    const client = () => ({
        tasks: {
            getContent: vi.fn().mockResolvedValue({ content: '# Task', path: 'plan.md', mtime: 1 }),
            previewWorkspaceFile: vi.fn().mockResolvedValue({ content: '# Workspace\n', mtime: 1 }),
            writeContent: vi.fn().mockResolvedValue({ path: 'plan.md', updated: true, mtime: 2 }),
        },
        notes: { uploadImage: vi.fn().mockResolvedValue({ path: '.attachments/image.png' }) },
    });
    return { local: client(), alpha: client(), beta: client() };
});
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mocks.local,
    getCocClientFor: (base?: string) => base === 'https://alpha.example'
        ? mocks.alpha : base === 'https://beta.example' ? mocks.beta : mocks.local,
    toSpaCocRequestOptions: (options: unknown) => options,
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));

const workspaceId = 'shared-workspace';
const alphaRoute = `remote:alpha:${workspaceId}`;
const betaRoute = `remote:beta:${workspaceId}`;
const entries = [
    { workspaceId, serverId: 'alpha', baseUrl: 'https://alpha.example' },
    { workspaceId, serverId: 'beta', baseUrl: 'https://beta.example' },
];

beforeEach(() => {
    vi.clearAllMocks();
    resetCloneRegistryForTests();
    registerCloneBaseUrls(entries);
});
afterEach(() => resetCloneRegistryForTests());

describe.each([
    ['task notes', createTasksNoteEditorIO, 'getContent'],
    ['workspace files', createWorkspaceFileNoteEditorIO, 'previewWorkspaceFile'],
] as const)('%s concrete NoteEditorIO owner', (_name, createIO, readMethod) => {
    it('keeps load/save/upload and image URLs on the concrete owner after selection changes', async () => {
        const io = createIO(alphaRoute);
        setActiveCloneForRouting(betaRoute);
        await io.loadContent(workspaceId, 'plan.md');
        await io.saveContent(workspaceId, 'plan.md', '# Updated', 1);
        await io.uploadImage(workspaceId, 'image.png', 'data:image/png;base64,AA==');
        expect(mocks.alpha.tasks[readMethod]).toHaveBeenCalledWith(
            workspaceId, 'plan.md', readMethod === 'getContent' ? undefined : { lines: 0 },
        );
        expect(mocks.alpha.tasks.writeContent).toHaveBeenCalledWith(
            workspaceId, { path: 'plan.md', content: '# Updated', expectedMtime: 1 },
        );
        expect(mocks.alpha.notes.uploadImage).toHaveBeenCalledWith(
            workspaceId, 'image.png', 'data:image/png;base64,AA==',
        );
        expect(io.imageApiUrl(workspaceId, '.attachments/image.png')).toBe(
            `https://alpha.example/api/workspaces/${workspaceId}/notes/image?path=.attachments%2Fimage.png`,
        );
        expect(io.localImageApiUrl(workspaceId, '/preview-root/image.png')).toBe(
            `https://alpha.example/api/workspaces/${workspaceId}/notes/local-image?path=%2Fpreview-root%2Fimage.png`,
        );
        expect(mocks.beta.tasks[readMethod]).not.toHaveBeenCalled();
        expect(mocks.beta.tasks.writeContent).not.toHaveBeenCalled();
        expect(mocks.beta.notes.uploadImage).not.toHaveBeenCalled();
        expect(mocks.local.tasks[readMethod]).not.toHaveBeenCalled();
    });

    it('keeps an explicit null owner local despite colliding remote registrations', async () => {
        const io = createIO(null);
        setActiveCloneForRouting(alphaRoute);
        await io.loadContent(workspaceId, 'plan.md');
        await io.saveContent(workspaceId, 'plan.md', '# Local', 1);
        await io.uploadImage(workspaceId, 'image.png', 'data:image/png;base64,AA==');
        expect(mocks.local.tasks[readMethod]).toHaveBeenCalledTimes(1);
        expect(mocks.local.tasks.writeContent).toHaveBeenCalledTimes(1);
        expect(mocks.local.notes.uploadImage).toHaveBeenCalledTimes(1);
        expect(io.imageApiUrl(workspaceId, '.attachments/image.png')).toMatch(/^\/api\/workspaces\//);
        expect(io.localImageApiUrl(workspaceId, '/preview-root/image.png')).toMatch(/^\/api\/workspaces\//);
        expect(mocks.alpha.tasks[readMethod]).not.toHaveBeenCalled();
    });

    it('rejects all operations for an unavailable concrete remote with no local fallthrough', async () => {
        const io = createIO(`remote:missing:${workspaceId}`);
        await expect(io.loadContent(workspaceId, 'plan.md')).rejects.toThrow(/owning remote server is unavailable/i);
        await expect(io.saveContent(workspaceId, 'plan.md', '# Updated', 1))
            .rejects.toThrow(/owning remote server is unavailable/i);
        await expect(io.uploadImage(workspaceId, 'image.png', 'data:image/png;base64,AA=='))
            .rejects.toThrow(/owning remote server is unavailable/i);
        expect(() => io.imageApiUrl(workspaceId, '.attachments/image.png'))
            .toThrow(/owning remote server is unavailable/i);
        expect(() => io.localImageApiUrl(workspaceId, '/preview-root/image.png'))
            .toThrow(/owning remote server is unavailable/i);
        expect(mocks.local.tasks[readMethod]).not.toHaveBeenCalled();
        expect(mocks.local.tasks.writeContent).not.toHaveBeenCalled();
        expect(mocks.local.notes.uploadImage).not.toHaveBeenCalled();
    });

    it('fails closed when its owner disappears from a later registry refresh', async () => {
        const io = createIO(alphaRoute);
        await io.loadContent(workspaceId, 'plan.md');
        registerCloneBaseUrls([entries[1]]);
        setActiveCloneForRouting(betaRoute);
        await expect(io.saveContent(workspaceId, 'plan.md', '# Updated', 1))
            .rejects.toThrow(/owning remote server is unavailable/i);
        expect(mocks.beta.tasks.writeContent).not.toHaveBeenCalled();
        expect(mocks.local.tasks.writeContent).not.toHaveBeenCalled();
    });
});
