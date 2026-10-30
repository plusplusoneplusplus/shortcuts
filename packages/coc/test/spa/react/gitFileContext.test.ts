// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createGitFileContextPayload, createWorkingTreeFileContextPayload, gitFileContextKey } from '../../../src/server/spa/client/react/features/chat/gitFileContext';
import { readSessionContextDropPayload, validateSessionContextAttachmentsForSend, validateSessionContextDrop } from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { POINTER_CONTEXT_DRAG_MIME } from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { formatAttachedContext, parseAttachedSessionContextBlocks } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';

const raw = { kind: 'coc.git-file-context', version: 1, sourceWorkspaceId: 'member', sourceRoutingRef: null,
    filePath: 'src/a "quoted" & spaced.ts', revision: 'a'.repeat(40), side: 'head' };
const decode = (data: unknown) => readSessionContextDropPayload({ getData: mime => mime === POINTER_CONTEXT_DRAG_MIME ? JSON.stringify(data) : '' });
const payload = () => createGitFileContextPayload(raw)!;
const item = () => ({ ...payload(), id: 'file', kind: 'git-file' as const, preview: 'File' });
const options = { activeWorkspaceId: 'group-team', activeRoutingRef: null, featureEnabled: true, canRetrieveConversations: false };
afterEach(resetCloneRegistryForTests);

describe('whole reviewed file context admission', () => {
    it('preserves exact paths, revision and ownership through the wire and persisted pointer', () => {
        expect(decode(raw)).toEqual(payload());
        const text = formatAttachedContext([item()]);
        expect(text).toContain('path="src/a &quot;quoted&quot; &amp; spaced.ts"');
        expect(parseAttachedSessionContextBlocks(text).pointerContexts[0]).toMatchObject({
            kind: 'git-file', sourceWorkspaceId: 'member', sourceRoutingRef: null,
            filePath: raw.filePath, revision: raw.revision, side: 'head',
        });
        expect(text).toContain('git show revision:path');
        expect(text).not.toContain('unknown-workspace');
    });

    it.each([
        { version: 2 }, { sourceWorkspaceId: '' }, { sourceRoutingRef: undefined },
        { revision: 'HEAD' }, { revision: 'main' }, { revision: 'abcdef1' }, { revision: '' },
        { filePath: '../a.ts' }, { filePath: '/repo/a.ts' }, { filePath: 'C:/repo/a.ts' },
        { filePath: 'src\\a.ts' }, { filePath: 'a\0.ts' }, { side: 'disk' },
    ])('rejects malformed or mutable external context %j', change => {
        expect(decode({ ...raw, ...change })).toBeNull();
    });

    it('shares feature gating and send limits with other context kinds', () => {
        expect(validateSessionContextDrop({ ...options, payload: payload(), existingItems: [] }).ok).toBe(true);
        expect(validateSessionContextDrop({ ...options, featureEnabled: false, payload: payload(), existingItems: [] }).ok).toBe(false);
        expect(validateSessionContextAttachmentsForSend({ ...options, featureEnabled: false, items: [item()] })).toContain('disabled');
        expect(validateSessionContextAttachmentsForSend({ ...options, items: [item(), item()] })).toContain('already attached');
    });

    it('deduplicates exact server/repository/revision/path identity', () => {
        const file = payload();
        const keys = [file, { ...file, revision: 'b'.repeat(40) }, { ...file, filePath: 'other.ts' },
            { ...file, sourceWorkspaceId: 'sibling' },
            { ...file, sourceRoutingRef: buildRemoteCloneKey('remote', 'member') }].map(gitFileContextKey);
        expect(new Set(keys).size).toBe(5);
        expect(validateSessionContextDrop({ ...options, payload: file, existingItems: [item()] })).toMatchObject({ ok: false, error: expect.stringContaining('already attached') });
    });

    it('rejects a source clone for the wrong repository, and an unknown remote, on drop and send', () => {
        registerCloneBaseUrls([{ workspaceId: 'other', serverId: 'one', baseUrl: 'https://one.example' }]);
        for (const sourceRoutingRef of [buildRemoteCloneKey('one', 'other'), buildRemoteCloneKey('missing', 'member')]) {
            const source = { ...payload(), sourceRoutingRef };
            expect(validateSessionContextDrop({ ...options, payload: source, existingItems: [] }).ok).toBe(false);
            expect(validateSessionContextAttachmentsForSend({ ...options, items: [{ ...item(), sourceRoutingRef }] })).toBeTruthy();
        }
    });
});

describe('open source-tab file context (working tree)', () => {
    const tab = (overrides: Partial<{ ownerWorkspaceId: string; ownerRoutingRef: string | null; resourceId: string }> = {}) => ({
        ownerWorkspaceId: 'member', resourceId: 'packages/forge/resources/bundled-skills/delegate/SKILL.md', ...overrides,
    });
    const wtItem = (source = createWorkingTreeFileContextPayload(tab())!) => ({ ...source, id: 'tab', kind: 'git-file' as const, preview: source.label });

    it('builds a revision-less working-tree pointer that survives the wire and the persisted block', () => {
        const source = createWorkingTreeFileContextPayload(tab())!;
        expect(source).toEqual({
            kind: 'coc.git-file-context', version: 1, sourceWorkspaceId: 'member', sourceRoutingRef: null,
            filePath: tab().resourceId, side: 'working-tree', label: tab().resourceId,
        });
        expect(decode(source)).toEqual(source);
        const text = formatAttachedContext([wtItem(source)]);
        expect(text).toContain('side="working-tree"');
        expect(text).not.toContain('revision=');
        expect(text).toContain('working tree');
        expect(text).not.toContain('git show');
        expect(parseAttachedSessionContextBlocks(text).pointerContexts[0]).toMatchObject({
            kind: 'git-file', sourceWorkspaceId: 'member', filePath: tab().resourceId, side: 'working-tree',
        });
    });

    it('keeps the remote owner and rejects unknown owners or non-repo-relative paths', () => {
        const remoteRef = buildRemoteCloneKey('server-a', 'member');
        expect(createWorkingTreeFileContextPayload(tab({ ownerRoutingRef: remoteRef }))?.sourceRoutingRef).toBe(remoteRef);
        registerCloneBaseUrls([{ workspaceId: 'cloned', serverId: 'server-a', baseUrl: 'https://a.example' }]);
        expect(createWorkingTreeFileContextPayload(tab({ ownerWorkspaceId: 'cloned' }))).toBeNull();
        for (const resourceId of ['/abs/SKILL.md', '../SKILL.md', 'C:/x.md', '']) {
            expect(createWorkingTreeFileContextPayload(tab({ resourceId }))).toBeNull();
        }
        expect(decode({ ...createWorkingTreeFileContextPayload(tab()), revision: 'a'.repeat(40) })).toBeNull();
        expect(decode({ ...raw, revision: undefined })).toBeNull();
    });

    it('isolates same paths across group members, servers and revisions, and dedups the same tab', () => {
        const local = createWorkingTreeFileContextPayload(tab())!;
        const keys = [local,
            createWorkingTreeFileContextPayload(tab({ ownerWorkspaceId: 'sibling' }))!,
            createWorkingTreeFileContextPayload(tab({ ownerRoutingRef: buildRemoteCloneKey('server-a', 'member') }))!,
            { ...payload(), filePath: local.filePath }].map(gitFileContextKey);
        expect(new Set(keys).size).toBe(4);
        expect(validateSessionContextDrop({ ...options, payload: local, existingItems: [] }).ok).toBe(true);
        expect(validateSessionContextDrop({ ...options, payload: local, existingItems: [wtItem()] }))
            .toEqual({ ok: false, error: 'This file is already attached to the message.' });
        expect(validateSessionContextAttachmentsForSend({ ...options, items: [wtItem(), wtItem()] })).toBe('This file is already attached to the message.');
    });

    it('rejects a remote tab dropped on a local chat on drop and send', () => {
        registerCloneBaseUrls([{ workspaceId: 'member', serverId: 'server-a', baseUrl: 'https://a.example' }]);
        const remote = createWorkingTreeFileContextPayload(tab({ ownerRoutingRef: buildRemoteCloneKey('server-a', 'member') }))!;
        expect(validateSessionContextDrop({ ...options, payload: remote, existingItems: [] }))
            .toEqual({ ok: false, error: 'Attach this file only to a chat on its owning server.' });
        expect(validateSessionContextAttachmentsForSend({ ...options, items: [wtItem(remote)] })).toBe('Attach this file only to a chat on its owning server.');
    });
});
