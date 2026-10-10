import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createRepoGroup, readRepoGroup, resolveRepoGroupMembers, updateRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import { APIError } from '../../src/server/errors';
import { getRepoGroupAccess } from '../../src/server/workspaces/repo-group-exclusive-writer';
import { buildRepoGroupAccessPolicy } from '../../src/server/workspaces/repo-group-access-policy';

describe('repo-group exclusive writer admission', () => {
    let dataDir: string;
    let store: FileProcessStore;
    let root: string;
    const enabled = { exclusiveWriter: true };

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-writer-'));
        store = new FileProcessStore({ dataDir });
        root = path.join(dataDir, 'checkouts', 'repo');
        fs.mkdirSync(root, { recursive: true });
        await store.registerWorkspace({ id: 'repo', name: 'Repo', rootPath: root });
    });
    afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    const create = (name: string, readOnly?: Record<string, boolean>, members = ['repo']) =>
        createRepoGroup(dataDir, store, { name, members, readOnly }, enabled);
    const update = (id: string, readOnly: Record<string, boolean>) =>
        updateRepoGroup(dataDir, store, id, { readOnly }, enabled);
    const register = async (id: string, rootPath: string) => {
        fs.mkdirSync(rootPath, { recursive: true });
        await store.registerWorkspace({ id, name: id, rootPath });
    };

    it.each([['repo', 'c'], ['c', 'repo']])(
        'closes new defaults for parent/nested siblings in order %j', async (...members) => {
            await register('a', path.join(root, 'a'));
            await register('c', path.join(root, 'c'));
            const owner = await create('Owner', undefined, ['a']);
            const group = await create('New', undefined, members);
            expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(members);
            const policy = buildRepoGroupAccessPolicy(await resolveRepoGroupMembers(dataDir, store, group.id));
            expect(policy.writableDirectories).toEqual([]);
            expect(policy.readOnlyDirectories).toHaveLength(2);
            expect(readRepoGroup(dataDir, owner.id)?.readOnlyMembers).toBeUndefined();
        },
    );

    it('propagates omitted defaults transitively without protecting distinct prefix siblings', async () => {
        await register('a', path.join(root, 'a'));
        await register('c', path.join(root, 'c'));
        await register('clone', root + '-clone');
        const group = await create('New', { a: true }, ['c', 'repo', 'a', 'clone']);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['c', 'repo', 'a']);
        const policy = buildRepoGroupAccessPolicy(await resolveRepoGroupMembers(dataDir, store, group.id));
        expect(policy.writableDirectories).toEqual([fs.realpathSync.native(root + '-clone')]);
    });

    it.each([{ repo: true, c: false }, { repo: false, c: true }])(
        'rejects explicit mixed overlapping creation %j without saving', async readOnly => {
            await register('c', path.join(root, 'c'));
            await expect(create('Mixed', readOnly, ['repo', 'c'])).rejects.toMatchObject({
                statusCode: 409, code: 'REPO_GROUP_ACCESS_POLICY_CONFLICT',
            });
            expect(fs.existsSync(path.join(dataDir, 'repos', 'group-mixed'))).toBe(false);
            expect((await store.getWorkspaces()).filter(ws => ws.virtual)).toEqual([]);
        },
    );

    it('rejects the UI explicit parent-default/nested-writer payload even without a direct nested writer match', async () => {
        await register('a', path.join(root, 'a'));
        await register('c', path.join(root, 'c'));
        await create('Owner', undefined, ['a']);
        await expect(create('Mixed', { repo: true, c: false }, ['repo', 'c'])).rejects.toMatchObject({
            statusCode: 409, code: 'REPO_GROUP_ACCESS_POLICY_CONFLICT',
            details: { writableWorkspaceId: 'c', readOnlyWorkspaceId: 'repo' },
        });
    });

    it.each(['same-root', 'symlink'] as const)('rejects mixed %s aliases after canonicalization', async kind => {
        const aliasRoot = kind === 'same-root' ? root : path.join(dataDir, 'alias');
        if (kind === 'symlink') fs.symlinkSync(root, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
        await store.registerWorkspace({ id: 'alias', name: 'Alias', rootPath: aliasRoot });
        await expect(create('Mixed', { repo: true, alias: false }, ['repo', 'alias']))
            .rejects.toMatchObject({ code: 'REPO_GROUP_ACCESS_POLICY_CONFLICT' });
        const group = await create('Safe', { repo: true }, ['repo', 'alias']);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo', 'alias']);
        expect(buildRepoGroupAccessPolicy(await resolveRepoGroupMembers(dataDir, store, group.id)).writableDirectories).toEqual([]);
    });

    it.each(['new-writer', 'new-read-only', 'automatic-read-only'] as const)(
        'rejects incompatible %s additions and preserves file and registry', async kind => {
            await register('c', path.join(root, 'c'));
            const group = await create('Saved', { repo: kind === 'new-writer' });
            if (kind === 'automatic-read-only') await create('Shared', { c: true }, ['c']);
            const before = fs.readFileSync(path.join(group.rootPath, 'group.json'), 'utf8');
            await expect(updateRepoGroup(dataDir, store, group.id, {
                members: ['repo', 'c'], name: 'Rejected', descriptions: { repo: 'Draft' },
                readOnly: kind === 'automatic-read-only' ? {} : { c: kind === 'new-read-only' },
            }, enabled)).rejects.toMatchObject({ code: 'REPO_GROUP_ACCESS_POLICY_CONFLICT' });
            expect(fs.readFileSync(path.join(group.rootPath, 'group.json'), 'utf8')).toBe(before);
            expect((await store.getWorkspaces()).find(ws => ws.id === group.id)?.name).toBe('Saved');
        },
    );

    it('defaults additions consistently against saved protected roots without changing saved writers', async () => {
        await register('a', path.join(root, 'a'));
        await register('c', path.join(root, 'c'));
        const group = await create('Saved', { repo: true });
        await updateRepoGroup(dataDir, store, group.id, { members: ['repo', 'a', 'c'] }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo', 'a', 'c']);
        expect(buildRepoGroupAccessPolicy(await resolveRepoGroupMembers(dataDir, store, group.id)).writableDirectories).toEqual([]);
    });

    it('rejects a mixed grant to an existing protected member but allows a compatible simultaneous grant', async () => {
        await register('c', path.join(root, 'c'));
        const group = await create('Saved', { repo: true, c: true }, ['repo', 'c']);
        const before = readRepoGroup(dataDir, group.id);
        await expect(update(group.id, { c: false })).rejects.toMatchObject({ code: 'REPO_GROUP_ACCESS_POLICY_CONFLICT' });
        expect(readRepoGroup(dataDir, group.id)).toEqual(before);
        await update(group.id, { repo: false, c: false });
        expect(buildRepoGroupAccessPolicy(await resolveRepoGroupMembers(dataDir, store, group.id)).writableDirectories).toHaveLength(2);
    });

    it.each(['repo', 'c'])('always allows revoking saved overlapping writer %s, then the other', async id => {
        await register('c', path.join(root, 'c'));
        const group = await create('Saved', { repo: false, c: false }, ['repo', 'c']);
        await update(group.id, { [id]: true });
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual([id]);
        await updateRepoGroup(dataDir, store, group.id, { name: 'Renamed', readOnly: { [id]: true } }, enabled);
        await update(group.id, { repo: true, c: true });
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo', 'c']);
    });

    it('preserves saved mixed conflicts, unrelated additions and reductions without reassigning writers', async () => {
        await register('c', path.join(root, 'c'));
        await register('clone', root + '-clone');
        const group = await createRepoGroup(dataDir, store, { name: 'Saved', members: ['repo', 'c'], readOnly: { repo: true } });
        await updateRepoGroup(dataDir, store, group.id, {
            name: 'Renamed', descriptions: { c: 'Note' }, members: ['repo', 'c', 'clone'],
            readOnly: { repo: true, c: false, clone: false },
        }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo']);
        await update(group.id, { c: true });
        await updateRepoGroup(dataDir, store, group.id, { members: ['c', 'clone'] }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['c']);
    });

    it('preserves mixed policies created by root re-registration and allows stale revocation', async () => {
        await register('clone', root + '-clone');
        const group = await create('Saved', { repo: true, clone: false }, ['repo', 'clone']);
        await store.updateWorkspace('clone', { rootPath: root });
        await updateRepoGroup(dataDir, store, group.id, { descriptions: { clone: 'Note' } }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo']);
        fs.rmSync(root, { recursive: true });
        await update(group.id, { clone: true });
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo', 'clone']);
    });

    it('diagnoses every saved writer, including unchanged conflicts and canonical aliases, without mutation', async () => {
        const first = await create('First');
        const second = await createRepoGroup(dataDir, store, { name: 'Second', members: ['repo'] });
        const nested = path.join(root, 'nested');
        fs.mkdirSync(nested);
        await store.registerWorkspace({ id: 'nested', name: 'Nested', rootPath: nested });
        const clone = path.join(dataDir, 'clone');
        fs.mkdirSync(clone);
        await store.registerWorkspace({ id: 'clone', name: 'Clone', rootPath: clone });
        const before = readRepoGroup(dataDir, second.id);
        const access = await getRepoGroupAccess(dataDir, store, true, second.id);
        const member = access.members.find(member => member.workspaceId === 'repo')!;
        expect(member.shared).toBe(true);
        expect(member.unresolved).toBe(false);
        expect(member.writers.map(writer => writer.writerGroupId)).toEqual([first.id, second.id]);
        expect(access.members.find(member => member.workspaceId === 'nested')?.writers).toHaveLength(2);
        expect(access.members.find(member => member.workspaceId === 'clone')).toMatchObject({ shared: false, writers: [] });
        expect(readRepoGroup(dataDir, second.id)).toEqual(before);
        await update(first.id, { repo: true });
        expect((await getRepoGroupAccess(dataDir, store, true, second.id)).members[0].writers).toHaveLength(1);
        expect(await getRepoGroupAccess(dataDir, store, false)).toEqual({ enabled: false, members: [] });
    });

    it('reports shared all-read-only identities and stale possible writers explicitly', async () => {
        const first = await create('First', { repo: true });
        expect((await getRepoGroupAccess(dataDir, store, true)).members[0]).toMatchObject({ shared: true, writers: [] });
        expect((await getRepoGroupAccess(dataDir, store, true, first.id)).members[0].shared).toBe(false);
        await update(first.id, { repo: false });
        await store.removeWorkspace('repo');
        const diagnostic = await getRepoGroupAccess(dataDir, store, true, first.id);
        expect(diagnostic.members[0]).toMatchObject({
            workspaceId: 'repo', unresolved: true,
            writers: [{ writerGroupId: first.id, reason: 'unresolved-membership' }],
        });
    });

    it('defaults only new shared memberships read-only, even if the other group is read-only', async () => {
        const first = await create('First');
        expect(readRepoGroup(dataDir, first.id)?.readOnlyMembers).toBeUndefined();
        await update(first.id, { repo: true });
        const second = await create('Second');
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toEqual(['repo']);
        await update(second.id, { repo: false });
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toBeUndefined();
    });

    it('rejects a second explicit writer before creating any directory or registry entry', async () => {
        const first = await create('First');
        await expect(create('Second', { repo: false })).rejects.toMatchObject({
            statusCode: 409,
            code: 'REPO_GROUP_WRITER_CONFLICT',
            details: { conflicts: [{
                workspaceId: 'repo', writerWorkspaceId: 'repo', writerGroupId: first.id,
                writerGroupName: 'First', writerGroupLink: `#repos/${first.id}/settings`, reason: 'writer-exists',
            }] },
        });
        expect(fs.existsSync(path.join(dataDir, 'repos', 'group-second'))).toBe(false);
        expect((await store.getWorkspaces()).filter(ws => ws.virtual)).toHaveLength(1);
    });

    it('preserves all saved state on rejection and permits a two-step handoff', async () => {
        const first = await create('First');
        const second = await create('Second');
        const before = readRepoGroup(dataDir, second.id);
        await expect(updateRepoGroup(dataDir, store, second.id, {
            name: 'Changed', descriptions: { repo: 'Changed' }, readOnly: { repo: false },
        }, enabled)).rejects.toBeInstanceOf(APIError);
        expect(readRepoGroup(dataDir, second.id)).toEqual(before);
        expect((await store.getWorkspaces()).find(ws => ws.id === second.id)?.name).toBe('Second');
        await update(first.id, { repo: true });
        await update(second.id, { repo: false });
        expect(readRepoGroup(dataDir, first.id)?.readOnlyMembers).toEqual(['repo']);
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toBeUndefined();
    });

    it('serializes concurrent explicit creates and releases the gate after rejection', async () => {
        const results = await Promise.allSettled([create('One', { repo: false }), create('Two', { repo: false })]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        const third = await create('Three');
        expect(readRepoGroup(dataDir, third.id)?.readOnlyMembers).toEqual(['repo']);
    });

    it('serializes concurrent updates granting the first writer', async () => {
        const first = await create('One', { repo: true });
        const second = await create('Two', { repo: true });
        const results = await Promise.allSettled([update(first.id, { repo: false }), update(second.id, { repo: false })]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    });

    it('serializes a create against an update granting the same writer', async () => {
        const group = await create('Existing', { repo: true });
        const results = await Promise.allSettled([
            update(group.id, { repo: false }), create('New', { repo: false }),
        ]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    });

    it('handles simultaneous omitted defaults and unique group names', async () => {
        const groups = await Promise.all([create('Same'), create('Same')]);
        expect(new Set(groups.map(group => group.id)).size).toBe(2);
        expect(groups.filter(group => !readRepoGroup(dataDir, group.id)?.readOnlyMembers)).toHaveLength(1);
    });

    it.each(['same-root', 'nested-root', 'parent-root', 'symlink'] as const)(
        'recognizes %s identity after realpath',
        async kind => {
            await create('First');
            let aliasRoot = root;
            if (kind === 'nested-root') aliasRoot = path.join(root, 'nested');
            if (kind === 'parent-root') aliasRoot = path.dirname(root);
            if (kind === 'symlink') {
                aliasRoot = path.join(dataDir, 'alias');
                fs.symlinkSync(root, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
            } else {
                fs.mkdirSync(aliasRoot, { recursive: true });
            }
            await store.registerWorkspace({ id: 'alias', name: 'Alias', rootPath: aliasRoot });
            const second = await create('Second', undefined, ['alias']);
            expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toEqual(['alias']);
            await expect(update(second.id, { alias: false })).rejects.toMatchObject({ statusCode: 409 });
        },
    );

    it('does not merge distinct clones, prefix siblings, or registries on other servers', async () => {
        await create('First');
        const sibling = root + '-clone';
        fs.mkdirSync(sibling, { recursive: true });
        await store.registerWorkspace({ id: 'clone', name: 'Clone', rootPath: sibling });
        const clone = await create('Clone group', undefined, ['clone']);
        expect(readRepoGroup(dataDir, clone.id)?.readOnlyMembers).toBeUndefined();
        const otherDir = path.join(dataDir, 'other-server');
        const otherStore = new FileProcessStore({ dataDir: otherDir });
        await otherStore.registerWorkspace({ id: 'repo', name: 'Repo', rootPath: root });
        const other = await createRepoGroup(otherDir, otherStore, { name: 'Other', members: ['repo'] }, enabled);
        expect(readRepoGroup(otherDir, other.id)?.readOnlyMembers).toBeUndefined();
    });

    it('preserves old conflicts and allows unrelated saves and conflict reduction, but not expansion', async () => {
        const first = await createRepoGroup(dataDir, store, { name: 'First', members: ['repo'] });
        const second = await createRepoGroup(dataDir, store, { name: 'Second', members: ['repo'] });
        await updateRepoGroup(dataDir, store, second.id, {
            name: 'Renamed', descriptions: { repo: 'Note' }, members: ['repo'], readOnly: { repo: false },
        }, enabled);
        expect(readRepoGroup(dataDir, first.id)?.readOnlyMembers).toBeUndefined();
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toBeUndefined();
        await store.registerWorkspace({ id: 'alias', name: 'Alias', rootPath: root });
        await expect(updateRepoGroup(dataDir, store, second.id, {
            members: ['repo', 'alias'], readOnly: { alias: false },
        }, enabled)).rejects.toMatchObject({ statusCode: 409 });
        await update(first.id, { repo: true });
        await update(second.id, { repo: true });
        await update(first.id, { repo: false });
    });

    it('defaults newly added members without changing existing non-shared edit policies', async () => {
        await create('Writer');
        const group = await create('Empty', undefined, []);
        await updateRepoGroup(dataDir, store, group.id, { members: ['repo'], readOnly: {} }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo']);
        await updateRepoGroup(dataDir, store, group.id, { descriptions: { repo: 'Note' } }, enabled);
        expect(readRepoGroup(dataDir, group.id)?.readOnlyMembers).toEqual(['repo']);
    });

    it('keeps missing paths reserved by workspace ID and permits revocation', async () => {
        const first = await create('First');
        fs.rmSync(root, { recursive: true });
        const second = await create('Second');
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toEqual(['repo']);
        await expect(update(second.id, { repo: false })).rejects.toMatchObject({
            code: 'REPO_GROUP_WRITER_CONFLICT',
        });
        await update(first.id, { repo: true });
        await expect(update(second.id, { repo: false })).rejects.toMatchObject({
            code: 'REPO_GROUP_MEMBER_UNRESOLVED',
        });
    });

    it('does not silently discard an unregistered writer whose physical identity is unknown', async () => {
        const first = await create('First');
        await store.removeWorkspace('repo');
        await store.registerWorkspace({ id: 'replacement', name: 'Replacement', rootPath: root });
        const second = await create('Second', undefined, ['replacement']);
        await expect(update(second.id, { replacement: false })).rejects.toMatchObject({
            code: 'REPO_GROUP_WRITER_CONFLICT',
            details: { conflicts: [expect.objectContaining({ writerGroupId: first.id, reason: 'unresolved-membership' })] },
        });
        await updateRepoGroup(dataDir, store, first.id, { members: ['repo'], readOnly: { repo: true } }, enabled);
        await update(second.id, { replacement: false });
    });

    it.each(['invalid', JSON.stringify({ name: 'First', members: [123] })])(
        'fails closed on unreadable membership %s but allows explicit read-only creation', async contents => {
            const first = await create('First');
            fs.writeFileSync(path.join(first.rootPath, 'group.json'), contents);
            const second = await create('Second');
            expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toEqual(['repo']);
            expect((await getRepoGroupAccess(dataDir, store, true, second.id)).members[0])
                .toMatchObject({ shared: true, unresolved: true, writers: [{ writerGroupId: first.id, reason: 'unresolved-membership' }] });
            await expect(create('Third', { repo: false })).rejects.toMatchObject({ statusCode: 409 });
            await create('Safe', { repo: true });
        },
    );

    it('treats root re-registration conflicts as saved conflicts without picking a writer', async () => {
        const cloneRoot = path.join(dataDir, 'clone');
        fs.mkdirSync(cloneRoot);
        await store.registerWorkspace({ id: 'clone', name: 'Clone', rootPath: cloneRoot });
        const first = await create('First');
        const second = await create('Second', undefined, ['clone']);
        await store.updateWorkspace('clone', { rootPath: root });
        await updateRepoGroup(dataDir, store, second.id, { name: 'Renamed' }, enabled);
        expect(readRepoGroup(dataDir, first.id)?.readOnlyMembers).toBeUndefined();
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toBeUndefined();
        const access = await getRepoGroupAccess(dataDir, store, true, second.id);
        expect(access.members.find(member => member.workspaceId === 'clone')?.writers.map(writer => writer.writerGroupId))
            .toEqual([first.id, second.id]);
        await expect(create('Third', { repo: false })).rejects.toMatchObject({ statusCode: 409 });
    });

    it('keeps the flag-off default and explicit writers unchanged', async () => {
        await create('First');
        const second = await createRepoGroup(dataDir, store, { name: 'Second', members: ['repo'] });
        expect(readRepoGroup(dataDir, second.id)?.readOnlyMembers).toBeUndefined();
        await updateRepoGroup(dataDir, store, second.id, { readOnly: { repo: false } });
        await register('c', path.join(root, 'c'));
        const mixed = await createRepoGroup(dataDir, store, { name: 'Mixed', members: ['repo', 'c'], readOnly: { repo: true, c: false } });
        expect(readRepoGroup(dataDir, mixed.id)?.readOnlyMembers).toEqual(['repo']);
    });
});
