/**
 * AC-03 — dispatch-time chat context for repo-group workspaces.
 *
 * The resolver builds the appended prompt block (member name + absolute path
 * only) and the matching `additionalDirectories` list from LIVE members only;
 * stale members (workspace removed / path missing) are silently skipped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import {
    REPO_GROUP_CONTEXT_TAG,
    resolveRepoGroupChatContext,
    appendRepoGroupContext,
} from '../../src/server/workspaces/repo-group-chat-context';

describe('repo-group-chat-context', () => {
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
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-repo-group-ctx-'));
        store = new FileProcessStore(tmpDir);
        repoA = await registerRepo('ws-v2-aaa', 'Repo A');
        repoB = await registerRepo('ws-v2-bbb', 'Repo B');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('builds the tagged member listing and matching additionalDirectories', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'My Team', members: ['ws-v2-aaa', 'ws-v2-bbb'] });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx).toBeDefined();
        expect(ctx!.additionalDirectories).toEqual([repoA, repoB]);
        expect(ctx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "My Team" members:\n' +
            `- Repo A: ${repoA}\n` +
            `- Repo B: ${repoB}\n` +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
    });

    it('lists name and absolute path only — no origin/branch/description', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);
        const body = ctx!.promptBlock;
        expect(body).not.toMatch(/origin|branch|description/i);
        expect(body).toContain(`- Repo A: ${repoA}`);
    });

    it('skips a member whose workspace was removed', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        await store.removeWorkspace('ws-v2-bbb');

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.additionalDirectories).toEqual([repoA]);
        expect(ctx!.promptBlock).not.toContain('Repo B');
    });

    it('skips a member whose root path no longer exists on disk', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        fs.rmSync(repoB, { recursive: true, force: true });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.additionalDirectories).toEqual([repoA]);
        expect(ctx!.promptBlock).not.toContain('Repo B');
    });

    it('returns undefined when every member is stale', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        await store.removeWorkspace('ws-v2-aaa');

        expect(await resolveRepoGroupChatContext(store, tmpDir, ws.id)).toBeUndefined();
    });

    it('returns undefined for non-group, unknown-group, and missing workspace IDs', async () => {
        expect(await resolveRepoGroupChatContext(store, tmpDir, 'ws-v2-aaa')).toBeUndefined();
        expect(await resolveRepoGroupChatContext(store, tmpDir, 'group-nope')).toBeUndefined();
        expect(await resolveRepoGroupChatContext(store, tmpDir, undefined)).toBeUndefined();
    });

    it('appendRepoGroupContext appends the block after a blank line, and is identity without context', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(appendRepoGroupContext('hello', ctx)).toBe(`hello\n\n${ctx!.promptBlock}`);
        expect(appendRepoGroupContext('hello', undefined)).toBe('hello');
    });
});
