import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import {
    REPO_GROUP_ID_PREFIX,
    REPO_GROUP_FILE_NAME,
    isRepoGroupWorkspaceId,
    createRepoGroup,
    readRepoGroup,
    updateRepoGroup,
    resolveRepoGroupMembers,
    deleteRepoGroup,
    REPO_GROUP_DESCRIPTION_MAX_LENGTH,
} from '../../src/server/workspaces/repo-group-workspace';

describe('repo-group-workspace', () => {
    let tmpDir: string;
    let store: FileProcessStore;
    let repoA: string;
    let repoB: string;

    async function registerRepo(id: string, name: string): Promise<string> {
        const rootPath = path.join(tmpDir, 'checkouts', id);
        fs.mkdirSync(rootPath, { recursive: true });
        await store.registerWorkspace({ id, name, rootPath });
        return rootPath;
    }

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-repo-group-'));
        store = new FileProcessStore(tmpDir);
        repoA = await registerRepo('ws-v2-aaa', 'Repo A');
        repoB = await registerRepo('ws-v2-bbb', 'Repo B');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('isRepoGroupWorkspaceId', () => {
        it('accepts well-formed group IDs and rejects everything else', () => {
            expect(isRepoGroupWorkspaceId('group-my-team')).toBe(true);
            expect(isRepoGroupWorkspaceId('group-x2')).toBe(true);
            expect(isRepoGroupWorkspaceId('ws-v2-aaa')).toBe(false);
            expect(isRepoGroupWorkspaceId('group-')).toBe(false);
            expect(isRepoGroupWorkspaceId('group-../escape')).toBe(false);
            expect(isRepoGroupWorkspaceId('my_work')).toBe(false);
        });
    });

    describe('createRepoGroup', () => {
        it('registers a virtual workspace with a group- prefixed ID and persists group.json', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

            expect(ws.id).toBe('group-my-team');
            expect(ws.id.startsWith(REPO_GROUP_ID_PREFIX)).toBe(true);
            expect(ws.name).toBe('My Team');
            expect(ws.virtual).toBe(true);
            expect(ws.rootPath).toBe(path.join(tmpDir, 'repos', ws.id));

            const registered = (await store.getWorkspaces()).find(w => w.id === ws.id);
            expect(registered).toBeDefined();
            expect(registered!.virtual).toBe(true);

            const file = JSON.parse(fs.readFileSync(path.join(ws.rootPath, REPO_GROUP_FILE_NAME), 'utf-8'));
            expect(file).toEqual({ name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        });

        it('persists member workspace IDs only — no denormalized paths or names', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
            const raw = fs.readFileSync(path.join(ws.rootPath, REPO_GROUP_FILE_NAME), 'utf-8');
            expect(raw).not.toContain(repoA);
            expect(raw).not.toContain('Repo A');
        });

        it('rejects unregistered members (arbitrary paths are not accepted)', async () => {
            await expect(
                createRepoGroup(tmpDir, store, { name: 'G', members: ['/some/arbitrary/path'] }),
            ).rejects.toThrow(/not a registered workspace/);
            await expect(
                createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-unknown'] }),
            ).rejects.toThrow(/not a registered workspace/);
        });

        it('rejects virtual workspaces (including other groups) as members', async () => {
            await store.registerWorkspace({ id: 'my_work', name: 'My Work', rootPath: path.join(tmpDir, 'repos', 'my_work'), virtual: true });
            await expect(
                createRepoGroup(tmpDir, store, { name: 'G', members: ['my_work'] }),
            ).rejects.toThrow(/not a repo workspace/);

            const other = await createRepoGroup(tmpDir, store, { name: 'Other', members: ['ws-v2-aaa'] });
            await expect(
                createRepoGroup(tmpDir, store, { name: 'Nested', members: [other.id] }),
            ).rejects.toThrow(/not a repo workspace/);
        });

        it('rejects an empty name and trims whitespace', async () => {
            await expect(createRepoGroup(tmpDir, store, { name: '   ', members: [] })).rejects.toThrow(/name/);
            const ws = await createRepoGroup(tmpDir, store, { name: '  Padded  ', members: [] });
            expect(ws.name).toBe('Padded');
        });

        it('dedupes duplicate members preserving order', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-bbb', 'ws-v2-aaa', 'ws-v2-bbb'] });
            expect(readRepoGroup(tmpDir, ws.id)!.members).toEqual(['ws-v2-bbb', 'ws-v2-aaa']);
        });

        it('mints unique IDs when group names collide', async () => {
            const first = await createRepoGroup(tmpDir, store, { name: 'Team', members: [] });
            const second = await createRepoGroup(tmpDir, store, { name: 'Team', members: [] });
            expect(first.id).toBe('group-team');
            expect(second.id).toBe('group-team-2');
            expect(second.rootPath).not.toBe(first.rootPath);
        });

        it('slugifies non-alphanumeric names and falls back for symbol-only names', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Röbot & Friends!', members: [] });
            expect(isRepoGroupWorkspaceId(ws.id)).toBe(true);
            const symbolic = await createRepoGroup(tmpDir, store, { name: '!!!', members: [] });
            expect(symbolic.id).toBe('group-repo-group');
        });

        it('allows one repo to belong to several groups', async () => {
            const g1 = await createRepoGroup(tmpDir, store, { name: 'One', members: ['ws-v2-aaa'] });
            const g2 = await createRepoGroup(tmpDir, store, { name: 'Two', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
            expect(readRepoGroup(tmpDir, g1.id)!.members).toContain('ws-v2-aaa');
            expect(readRepoGroup(tmpDir, g2.id)!.members).toContain('ws-v2-aaa');
        });
    });

    describe('readRepoGroup', () => {
        it('returns undefined for malformed IDs, missing files, and corrupt JSON', async () => {
            expect(readRepoGroup(tmpDir, 'ws-v2-aaa')).toBeUndefined();
            expect(readRepoGroup(tmpDir, 'group-missing')).toBeUndefined();

            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: [] });
            fs.writeFileSync(path.join(ws.rootPath, REPO_GROUP_FILE_NAME), 'not json', 'utf-8');
            expect(readRepoGroup(tmpDir, ws.id)).toBeUndefined();
        });
    });

    describe('updateRepoGroup', () => {
        it('renames the group in both group.json and the workspace registry', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Old', members: ['ws-v2-aaa'] });
            const updated = await updateRepoGroup(tmpDir, store, ws.id, { name: 'New Name' });

            expect(updated).toEqual({ name: 'New Name', members: ['ws-v2-aaa'] });
            expect(readRepoGroup(tmpDir, ws.id)!.name).toBe('New Name');
            const registered = (await store.getWorkspaces()).find(w => w.id === ws.id);
            expect(registered!.name).toBe('New Name');
            expect(registered!.id).toBe(ws.id);
        });

        it('adds and removes members', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });

            await updateRepoGroup(tmpDir, store, ws.id, { members: ['ws-v2-aaa', 'ws-v2-bbb'] });
            expect(readRepoGroup(tmpDir, ws.id)!.members).toEqual(['ws-v2-aaa', 'ws-v2-bbb']);

            await updateRepoGroup(tmpDir, store, ws.id, { members: ['ws-v2-bbb'] });
            expect(readRepoGroup(tmpDir, ws.id)!.members).toEqual(['ws-v2-bbb']);
        });

        it('validates new members against the registry', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: [] });
            await expect(
                updateRepoGroup(tmpDir, store, ws.id, { members: ['ws-v2-unknown'] }),
            ).rejects.toThrow(/not a registered workspace/);
            expect(readRepoGroup(tmpDir, ws.id)!.members).toEqual([]);
        });

        it('returns undefined for a nonexistent group', async () => {
            expect(await updateRepoGroup(tmpDir, store, 'group-missing', { name: 'X' })).toBeUndefined();
        });
    });

    describe('resolveRepoGroupMembers', () => {
        it('resolves live members with registry name and rootPath', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
            const members = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(members).toEqual([
                { workspaceId: 'ws-v2-aaa', stale: false, name: 'Repo A', rootPath: repoA },
                { workspaceId: 'ws-v2-bbb', stale: false, name: 'Repo B', rootPath: repoB },
            ]);
        });

        it('marks a member stale when its workspace was removed from the registry', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
            await store.removeWorkspace('ws-v2-bbb');

            const members = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(members[0]).toMatchObject({ workspaceId: 'ws-v2-aaa', stale: false });
            expect(members[1]).toEqual({ workspaceId: 'ws-v2-bbb', stale: true, staleReason: 'workspace-removed' });
        });

        it('marks a member stale when its root path no longer exists on disk', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
            fs.rmSync(repoA, { recursive: true, force: true });

            const members = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(members[0]).toEqual({
                workspaceId: 'ws-v2-aaa',
                stale: true,
                staleReason: 'path-missing',
                name: 'Repo A',
                rootPath: repoA,
            });
        });

        it('returns an empty list for a nonexistent group', async () => {
            expect(await resolveRepoGroupMembers(tmpDir, store, 'group-missing')).toEqual([]);
        });
    });

    describe('member read-only flag', () => {
        function groupFile(groupId: string): string {
            return path.join(tmpDir, 'repos', groupId, REPO_GROUP_FILE_NAME);
        }

        it('round-trips a read-only flag through group.json', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Guarded',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                readOnly: { 'ws-v2-aaa': true },
            });

            expect(JSON.parse(fs.readFileSync(groupFile(ws.id), 'utf-8')).readOnly)
                .toEqual({ 'ws-v2-aaa': true });
            expect(readRepoGroup(tmpDir, ws.id)?.readOnly).toEqual({ 'ws-v2-aaa': true });
        });

        it('omits the key entirely for a group with no read-only members', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Plain RO',
                members: ['ws-v2-aaa'],
                readOnly: { 'ws-v2-aaa': false },
            });
            const raw = fs.readFileSync(groupFile(ws.id), 'utf-8');

            expect(raw).toBe(JSON.stringify({ name: 'Plain RO', members: ['ws-v2-aaa'] }, null, 2) + '\n');
            expect(raw).not.toContain('readOnly');
            expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Plain RO', members: ['ws-v2-aaa'] });
        });

        it('keeps descriptions and read-only side by side in the file', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Both',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-bbb': 'the UI' },
                readOnly: { 'ws-v2-aaa': true },
            });
            const raw = JSON.parse(fs.readFileSync(groupFile(ws.id), 'utf-8'));

            expect(raw.descriptions).toEqual({ 'ws-v2-bbb': 'the UI' });
            expect(raw.readOnly).toEqual({ 'ws-v2-aaa': true });
        });

        it('loads a pre-existing file without a readOnly key unchanged', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Legacy RO', members: ['ws-v2-aaa'] });
            fs.writeFileSync(groupFile(ws.id), JSON.stringify({ name: 'Legacy RO', members: ['ws-v2-aaa'] }), 'utf-8');

            expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Legacy RO', members: ['ws-v2-aaa'] });
        });

        it('treats a malformed readOnly map as empty', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Broken RO', members: ['ws-v2-aaa'] });
            for (const readOnly of ['nope', 42, null, [true], { 'ws-v2-aaa': 'yes' }, { 'ws-v2-aaa': false }]) {
                fs.writeFileSync(
                    groupFile(ws.id),
                    JSON.stringify({ name: 'Broken RO', members: ['ws-v2-aaa'], readOnly }),
                    'utf-8',
                );
                expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Broken RO', members: ['ws-v2-aaa'] });
            }
        });

        it('patches only the supplied keys and leaves other members untouched', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Patch RO',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                readOnly: { 'ws-v2-aaa': true },
            });

            const updated = await updateRepoGroup(tmpDir, store, ws.id, { readOnly: { 'ws-v2-bbb': true } });

            expect(updated?.readOnly).toEqual({ 'ws-v2-aaa': true, 'ws-v2-bbb': true });
        });

        it('clears a read-only flag when patched with false', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Clear RO',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                readOnly: { 'ws-v2-aaa': true, 'ws-v2-bbb': true },
            });

            const updated = await updateRepoGroup(tmpDir, store, ws.id, { readOnly: { 'ws-v2-aaa': false } });

            expect(updated?.readOnly).toEqual({ 'ws-v2-bbb': true });
            expect(readRepoGroup(tmpDir, ws.id)?.readOnly).toEqual({ 'ws-v2-bbb': true });
        });

        it('drops the read-only flag of a member removed by the same update', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Prune RO',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                readOnly: { 'ws-v2-aaa': true, 'ws-v2-bbb': true },
            });

            await updateRepoGroup(tmpDir, store, ws.id, { members: ['ws-v2-aaa'] });

            expect(readRepoGroup(tmpDir, ws.id)?.readOnly).toEqual({ 'ws-v2-aaa': true });
        });

        it('rejects a non-boolean read-only value', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Bad RO', members: ['ws-v2-aaa'] });
            await expect(
                updateRepoGroup(tmpDir, store, ws.id, {
                    readOnly: { 'ws-v2-aaa': 'yes' as unknown as boolean },
                }),
            ).rejects.toThrow(/must be a boolean/);
        });

        it('rejects a read-only key that is not a member', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Solo RO', members: ['ws-v2-aaa'] });
            await expect(
                updateRepoGroup(tmpDir, store, ws.id, { readOnly: { 'ws-v2-bbb': true } }),
            ).rejects.toThrow(/not a member of this repo group/);
            await expect(
                createRepoGroup(tmpDir, store, {
                    name: 'Solo RO 2', members: ['ws-v2-aaa'], readOnly: { 'ws-v2-bbb': true },
                }),
            ).rejects.toThrow(/not a member of this repo group/);
        });

        it('resolves the flag onto live and stale members only where set', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Resolve RO',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                readOnly: { 'ws-v2-aaa': true },
            });

            const before = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(before[0]).toMatchObject({ workspaceId: 'ws-v2-aaa', stale: false, readOnly: true });
            expect(before[1].readOnly).toBeUndefined();

            fs.rmSync(repoA, { recursive: true, force: true });
            const after = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(after[0]).toMatchObject({ stale: true, staleReason: 'path-missing', readOnly: true });
        });
    });

    describe('member descriptions', () => {
        function groupFile(groupId: string): string {
            return path.join(tmpDir, 'repos', groupId, REPO_GROUP_FILE_NAME);
        }

        it('round-trips descriptions through group.json', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Described',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-aaa': 'the API server' },
            });

            expect(JSON.parse(fs.readFileSync(groupFile(ws.id), 'utf-8')).descriptions)
                .toEqual({ 'ws-v2-aaa': 'the API server' });
            expect(readRepoGroup(tmpDir, ws.id)?.descriptions).toEqual({ 'ws-v2-aaa': 'the API server' });
        });

        it('omits the key entirely for a group with no descriptions', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Plain', members: ['ws-v2-aaa'] });
            const raw = fs.readFileSync(groupFile(ws.id), 'utf-8');

            expect(raw).toBe(JSON.stringify({ name: 'Plain', members: ['ws-v2-aaa'] }, null, 2) + '\n');
            expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Plain', members: ['ws-v2-aaa'] });
        });

        it('loads a pre-existing file without a descriptions key unchanged', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Legacy', members: ['ws-v2-aaa'] });
            fs.writeFileSync(groupFile(ws.id), JSON.stringify({ name: 'Legacy', members: ['ws-v2-aaa'] }), 'utf-8');

            expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Legacy', members: ['ws-v2-aaa'] });
        });

        it('treats a malformed descriptions map as empty', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Broken', members: ['ws-v2-aaa'] });
            for (const descriptions of ['nope', 42, null, ['a'], { 'ws-v2-aaa': 7 }]) {
                fs.writeFileSync(
                    groupFile(ws.id),
                    JSON.stringify({ name: 'Broken', members: ['ws-v2-aaa'], descriptions }),
                    'utf-8',
                );
                expect(readRepoGroup(tmpDir, ws.id)).toEqual({ name: 'Broken', members: ['ws-v2-aaa'] });
            }
        });

        it('patches only the supplied keys and leaves other members untouched', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Patch',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-aaa': 'A one', 'ws-v2-bbb': 'B one' },
            });

            const updated = await updateRepoGroup(tmpDir, store, ws.id, {
                descriptions: { 'ws-v2-bbb': 'B two' },
            });

            expect(updated?.descriptions).toEqual({ 'ws-v2-aaa': 'A one', 'ws-v2-bbb': 'B two' });
        });

        it('clears a description when patched with an empty string', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Clear',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-aaa': 'A one', 'ws-v2-bbb': 'B one' },
            });

            const updated = await updateRepoGroup(tmpDir, store, ws.id, { descriptions: { 'ws-v2-aaa': '   ' } });

            expect(updated?.descriptions).toEqual({ 'ws-v2-bbb': 'B one' });
            expect(readRepoGroup(tmpDir, ws.id)?.descriptions).toEqual({ 'ws-v2-bbb': 'B one' });
        });

        it('drops the description of a member removed by the same update', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Shrink',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-aaa': 'A one', 'ws-v2-bbb': 'B one' },
            });

            await updateRepoGroup(tmpDir, store, ws.id, { members: ['ws-v2-aaa'] });

            expect(readRepoGroup(tmpDir, ws.id)?.descriptions).toEqual({ 'ws-v2-aaa': 'A one' });
            expect(fs.readFileSync(groupFile(ws.id), 'utf-8')).not.toContain('B one');
        });

        it('rejects a description longer than the limit', async () => {
            const tooLong = 'x'.repeat(REPO_GROUP_DESCRIPTION_MAX_LENGTH + 1);
            await expect(
                createRepoGroup(tmpDir, store, { name: 'Long', members: ['ws-v2-aaa'], descriptions: { 'ws-v2-aaa': tooLong } }),
            ).rejects.toThrow(/exceeds 280 characters/);

            const ws = await createRepoGroup(tmpDir, store, { name: 'Long OK', members: ['ws-v2-aaa'] });
            const atLimit = 'x'.repeat(REPO_GROUP_DESCRIPTION_MAX_LENGTH);
            const updated = await updateRepoGroup(tmpDir, store, ws.id, { descriptions: { 'ws-v2-aaa': atLimit } });
            expect(updated?.descriptions).toEqual({ 'ws-v2-aaa': atLimit });
        });

        it('rejects a non-string value and a key that is not a member', async () => {
            await expect(
                createRepoGroup(tmpDir, store, {
                    name: 'Bad value',
                    members: ['ws-v2-aaa'],
                    descriptions: { 'ws-v2-aaa': 12 as unknown as string },
                }),
            ).rejects.toThrow(/must be a string/);

            await expect(
                createRepoGroup(tmpDir, store, {
                    name: 'Bad key',
                    members: ['ws-v2-aaa'],
                    descriptions: { 'ws-v2-bbb': 'not a member' },
                }),
            ).rejects.toThrow(/is not a member of this repo group/);
        });

        it('resolves descriptions onto live and stale members', async () => {
            const ws = await createRepoGroup(tmpDir, store, {
                name: 'Resolved',
                members: ['ws-v2-aaa', 'ws-v2-bbb'],
                descriptions: { 'ws-v2-aaa': 'the API server' },
            });

            const before = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(before[0]).toMatchObject({ workspaceId: 'ws-v2-aaa', stale: false, description: 'the API server' });
            expect(before[1].description).toBeUndefined();

            fs.rmSync(repoA, { recursive: true, force: true });
            const after = await resolveRepoGroupMembers(tmpDir, store, ws.id);
            expect(after[0]).toMatchObject({ stale: true, staleReason: 'path-missing', description: 'the API server' });
        });

        it('scopes a description to the membership, not the workspace', async () => {
            const one = await createRepoGroup(tmpDir, store, {
                name: 'One',
                members: ['ws-v2-aaa'],
                descriptions: { 'ws-v2-aaa': 'backend for One' },
            });
            const two = await createRepoGroup(tmpDir, store, {
                name: 'Two',
                members: ['ws-v2-aaa'],
                descriptions: { 'ws-v2-aaa': 'shared lib for Two' },
            });

            expect(readRepoGroup(tmpDir, one.id)?.descriptions).toEqual({ 'ws-v2-aaa': 'backend for One' });
            expect(readRepoGroup(tmpDir, two.id)?.descriptions).toEqual({ 'ws-v2-aaa': 'shared lib for Two' });
        });
    });

    describe('deleteRepoGroup', () => {
        it('deregisters the workspace but leaves the group directory on disk', async () => {
            const ws = await createRepoGroup(tmpDir, store, { name: 'Doomed', members: ['ws-v2-aaa'] });
            const notesDir = path.join(ws.rootPath, 'notes');
            fs.mkdirSync(notesDir, { recursive: true });
            fs.writeFileSync(path.join(notesDir, 'keep.md'), '# keep\n', 'utf-8');

            expect(await deleteRepoGroup(store, ws.id)).toBe(true);

            expect((await store.getWorkspaces()).find(w => w.id === ws.id)).toBeUndefined();
            expect(fs.existsSync(path.join(ws.rootPath, REPO_GROUP_FILE_NAME))).toBe(true);
            expect(fs.existsSync(path.join(notesDir, 'keep.md'))).toBe(true);
            expect(readRepoGroup(tmpDir, ws.id)).toBeDefined();
        });

        it('returns false for unknown or non-group IDs', async () => {
            expect(await deleteRepoGroup(store, 'group-missing')).toBe(false);
            expect(await deleteRepoGroup(store, 'ws-v2-aaa')).toBe(false);
            expect((await store.getWorkspaces()).find(w => w.id === 'ws-v2-aaa')).toBeDefined();
        });
    });
});
