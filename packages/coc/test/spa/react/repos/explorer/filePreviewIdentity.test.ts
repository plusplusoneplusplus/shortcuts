/**
 * Pure identity policy behind PreviewPane: kind and path, owner/content keys,
 * transport selection, write locking, and the definition-owner map.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));
const mockPreview = vi.hoisted(() => ({
    readWorkspacePreview: vi.fn(),
    workspacePreviewClient: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));
vi.mock('../../../../../src/server/spa/client/react/shared/file-viewer/workspacePreview', () => ({
    WORKSPACE_PREVIEW_PREFIX: '__workspace_preview__:',
    ...mockPreview,
}));

import {
    buildDefinitionOwnerMap,
    createFilePreviewTransport,
    editingModelScope,
    resolveFilePreviewIdentity,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/filePreviewIdentity';
import { getExplorerDeleteBlockers } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';

const signal = new AbortController().signal;

beforeEach(() => {
    vi.clearAllMocks();
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'x', encoding: 'utf-8' });
    mockExplorerApi.readTrustedBlob.mockResolvedValue({ content: 'x', encoding: 'utf-8' });
    mockPreview.readWorkspacePreview.mockResolvedValue({ content: 'x', encoding: 'utf-8' });
});

describe('resolveFilePreviewIdentity', () => {
    it('treats a plain path as an editable repo file owned by the workspace', () => {
        const identity = resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: 'src/a.ts' });
        expect(identity).toMatchObject({
            kind: 'repo', path: 'src/a.ts', ownerKey: 'ws-1', contentKey: 'ws-1:src/a.ts', readOnly: false,
        });
    });

    it('keys a remote clone by its concrete route, not the bare workspace id', () => {
        const identity = resolveFilePreviewIdentity({
            workspaceId: 'ws-1', routingRef: 'remote:server-a:ws-1', filePath: 'src/a.ts',
        });
        expect(identity.ownerKey).toBe('remote:server-a:ws-1');
        expect(identity.contentKey).toBe('remote:server-a:ws-1:src/a.ts');
    });

    it('strips the trusted and workspace-preview prefixes and makes both read-only', () => {
        const trusted = resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: '__trusted__:/home/u/plan.md' });
        expect(trusted).toMatchObject({ kind: 'trusted', path: '/home/u/plan.md', readOnly: true });
        const preview = resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: '__workspace_preview__:docs/a.pdf' });
        expect(preview).toMatchObject({ kind: 'workspace-preview', path: 'docs/a.pdf', readOnly: true });
        // The buffer key keeps the prefix, so the same path in two kinds never shares a buffer.
        expect(preview.contentKey).toBe('ws-1:__workspace_preview__:docs/a.pdf');
    });
});

describe('createFilePreviewTransport', () => {
    it('reads a repo file without a route argument when none was supplied', async () => {
        const { read } = createFilePreviewTransport(resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: 'a.ts' }));
        await read(signal);
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith('ws-1', 'a.ts', { signal });
    });

    it('reads and writes a routed repo file through its concrete route', async () => {
        const transport = createFilePreviewTransport(resolveFilePreviewIdentity({
            workspaceId: 'ws-1', routingRef: null, filePath: 'a.ts',
        }));
        await transport.read(signal);
        await transport.write!('new');
        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith('ws-1', 'a.ts', { signal }, null);
        expect(mockExplorerApi.writeBlob).toHaveBeenCalledWith('ws-1', 'a.ts', 'new', null);
    });

    it('uses the trusted and workspace-preview readers and offers no write', async () => {
        const trusted = createFilePreviewTransport(resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: '__trusted__:/x' }));
        await trusted.read(signal);
        expect(mockExplorerApi.readTrustedBlob).toHaveBeenCalledWith('/x', { signal });
        expect(trusted.write).toBeUndefined();

        const preview = createFilePreviewTransport(resolveFilePreviewIdentity({
            workspaceId: 'ws-1', routingRef: 'remote:s:ws-1', filePath: '__workspace_preview__:d.pdf',
        }));
        await preview.read(signal);
        expect(mockPreview.readWorkspacePreview).toHaveBeenCalledWith('ws-1', 'd.pdf', 'remote:s:ws-1', signal);
        expect(preview.write).toBeUndefined();
    });

    it('resolves a remote clone client before any repo read or write', async () => {
        const transport = createFilePreviewTransport(resolveFilePreviewIdentity({
            workspaceId: 'ws-1', routingRef: 'remote:server-a:ws-1', filePath: 'a.ts',
        }));
        await transport.read(signal);
        await transport.write!('new');
        expect(mockPreview.workspacePreviewClient).toHaveBeenCalledTimes(2);
        expect(mockPreview.workspacePreviewClient).toHaveBeenCalledWith('ws-1', 'remote:server-a:ws-1');
    });

    it('holds the save lock for the owner path only while the write runs, even when it fails', async () => {
        const { write } = createFilePreviewTransport(resolveFilePreviewIdentity({ workspaceId: 'ws-1', filePath: 'a.ts' }));
        let finish!: (error?: Error) => void;
        mockExplorerApi.writeBlob.mockReturnValue(new Promise<void>((resolve, reject) => {
            finish = error => (error ? reject(error) : resolve());
        }));
        const pending = write!('new');
        expect(getExplorerDeleteBlockers('ws-1', 'a.ts')).toEqual(['a.ts']);
        finish(new Error('disk full'));
        await expect(pending).rejects.toThrow('disk full');
        expect(getExplorerDeleteBlockers('ws-1', 'a.ts')).toEqual([]);
    });
});

describe('buildDefinitionOwnerMap', () => {
    const self = { workspaceId: 'member-1', routingRef: 'remote:a:member-1' };

    it('always maps the pane workspace to its own route', () => {
        const map = buildDefinitionOwnerMap(self, undefined);
        expect([...map]).toEqual([['member-1', self]]);
    });

    it('maps each unique live member and drops ambiguous ones', () => {
        const map = buildDefinitionOwnerMap(self, [
            { workspaceId: 'member-1', routingRef: 'remote:b:member-1' },
            { workspaceId: 'member-2', routingRef: 'remote:a:member-2' },
            { workspaceId: 'member-3', routingRef: 'remote:a:member-3' },
            { workspaceId: 'member-3', routingRef: 'remote:b:member-3' },
            { workspaceId: 'member-3', routingRef: 'remote:c:member-3' },
        ]);
        expect(map.get('member-1')).toEqual(self);
        expect(map.get('member-2')).toEqual({ workspaceId: 'member-2', routingRef: 'remote:a:member-2' });
        expect(map.has('member-3')).toBe(false);
    });
});

describe('editingModelScope', () => {
    it('separates owners, routes and editing scopes', () => {
        expect(editingModelScope('ws-1', undefined, undefined)).toBe('["ws-1","ws-1",""]');
        expect(editingModelScope('ws-1', null, 'chat-1')).toBe('["ws-1",null,"chat-1"]');
        expect(editingModelScope('ws-1', 'remote:a:ws-1', undefined))
            .not.toBe(editingModelScope('ws-1', 'remote:b:ws-1', undefined));
    });
});
