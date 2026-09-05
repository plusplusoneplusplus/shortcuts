/**
 * AC-03 — dispatch-time chat context for repo-group workspaces.
 *
 * The resolver builds the appended prompt block (member name + absolute path
 * only) and the matching `additionalDirectories` list from LIVE members only;
 * stale members (workspace removed / path missing) are silently skipped.
 *
 * `shouldInjectRepoGroupContext` then decides whether the block rides THIS
 * turn's prompt: the model keeps it across a live session, so it is re-sent
 * only on a first turn / history rebuild, when it was never sent, when the
 * membership listing changed, or after a compaction may have summarized it
 * away.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createRepoGroup, updateRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import {
    REPO_GROUP_CONTEXT_TAG,
    resolveRepoGroupChatContext,
    appendRepoGroupContext,
    shouldInjectRepoGroupContext,
} from '../../src/server/workspaces/repo-group-chat-context';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';

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

    it('lists name and absolute path only — no origin/branch metadata', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);
        const body = ctx!.promptBlock;
        expect(body).not.toMatch(/origin|branch/i);
        expect(body).toContain(`- Repo A: ${repoA}`);
    });

    it('appends the membership description to the member line', async () => {
        const ws = await createRepoGroup(tmpDir, store, {
            name: 'My Team',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            descriptions: { 'ws-v2-aaa': 'the API server', 'ws-v2-bbb': 'the web client' },
        });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "My Team" members:\n' +
            `- Repo A: ${repoA} — the API server\n` +
            `- Repo B: ${repoB} — the web client\n` +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
    });

    it('keeps the bare form for a member with no description', async () => {
        const ws = await createRepoGroup(tmpDir, store, {
            name: 'Mixed',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            descriptions: { 'ws-v2-bbb': 'the web client' },
        });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.promptBlock).toContain(`- Repo A: ${repoA}\n`);
        expect(ctx!.promptBlock).not.toContain(`- Repo A: ${repoA} —`);
        expect(ctx!.promptBlock).toContain(`- Repo B: ${repoB} — the web client`);
    });

    it('produces a byte-identical block to the no-descriptions form when every description is blank', async () => {
        const plain = await createRepoGroup(tmpDir, store, { name: 'Same', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        const blank = await createRepoGroup(tmpDir, store, {
            name: 'Same',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            descriptions: { 'ws-v2-aaa': '', 'ws-v2-bbb': '   ' },
        });

        const plainCtx = await resolveRepoGroupChatContext(store, tmpDir, plain.id);
        const blankCtx = await resolveRepoGroupChatContext(store, tmpDir, blank.id);

        expect(blankCtx!.promptBlock).toBe(plainCtx!.promptBlock);
        expect(plainCtx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "Same" members:\n' +
            `- Repo A: ${repoA}\n` +
            `- Repo B: ${repoB}\n` +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
    });

    it('a description change drifts the block so it is re-injected', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        const before = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        await updateRepoGroup(tmpDir, store, ws.id, { descriptions: { 'ws-v2-aaa': 'the API server' } });
        const after = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(after!.promptBlock).not.toBe(before!.promptBlock);
        expect(
            shouldInjectRepoGroupContext({
                context: after,
                turns: [{ role: 'user', content: 'hi', timestamp: new Date(), repoGroupContext: before!.promptBlock }] as unknown as ConversationTurn[],
                compaction: undefined,
                canResumeSession: true,
            }),
        ).toBe(true);
    });

    it('marks a read-only member and appends the instruction line', async () => {
        const ws = await createRepoGroup(tmpDir, store, {
            name: 'My Team',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            descriptions: { 'ws-v2-aaa': 'the API server' },
            readOnly: { 'ws-v2-aaa': true },
        });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "My Team" members:\n' +
            `- Repo A: ${repoA} [read-only] — the API server\n` +
            `- Repo B: ${repoB}\n` +
            'Repos marked [read-only] must not be modified: do not edit, create, delete, or commit files under those paths. Read and search them freely.\n' +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
        // The flag is a prompt hint only — a read-only repo stays readable.
        expect(ctx!.additionalDirectories).toEqual([repoA, repoB]);
    });

    it('marks a read-only member that has no description', async () => {
        const ws = await createRepoGroup(tmpDir, store, {
            name: 'My Team',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            readOnly: { 'ws-v2-bbb': true },
        });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "My Team" members:\n' +
            `- Repo A: ${repoA}\n` +
            `- Repo B: ${repoB} [read-only]\n` +
            'Repos marked [read-only] must not be modified: do not edit, create, delete, or commit files under those paths. Read and search them freely.\n' +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
        expect(ctx!.additionalDirectories).toEqual([repoA, repoB]);
    });

    it('marks every member when the whole group is read-only', async () => {
        const ws = await createRepoGroup(tmpDir, store, {
            name: 'Vendored',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            readOnly: { 'ws-v2-aaa': true, 'ws-v2-bbb': true },
        });

        const ctx = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(ctx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "Vendored" members:\n' +
            `- Repo A: ${repoA} [read-only]\n` +
            `- Repo B: ${repoB} [read-only]\n` +
            'Repos marked [read-only] must not be modified: do not edit, create, delete, or commit files under those paths. Read and search them freely.\n' +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
        expect(ctx!.additionalDirectories).toEqual([repoA, repoB]);
    });

    it('renders no marker and no instruction line when no member is read-only', async () => {
        const plain = await createRepoGroup(tmpDir, store, { name: 'Same', members: ['ws-v2-aaa', 'ws-v2-bbb'] });
        const cleared = await createRepoGroup(tmpDir, store, {
            name: 'Same',
            members: ['ws-v2-aaa', 'ws-v2-bbb'],
            readOnly: { 'ws-v2-aaa': false, 'ws-v2-bbb': false },
        });

        const plainCtx = await resolveRepoGroupChatContext(store, tmpDir, plain.id);
        const clearedCtx = await resolveRepoGroupChatContext(store, tmpDir, cleared.id);

        // Byte-identical to the pre-flag rendering, so existing live sessions
        // never see drift and never spuriously re-inject.
        expect(plainCtx!.promptBlock).toBe(
            `<${REPO_GROUP_CONTEXT_TAG}>\n` +
            'Repo group "Same" members:\n' +
            `- Repo A: ${repoA}\n` +
            `- Repo B: ${repoB}\n` +
            `</${REPO_GROUP_CONTEXT_TAG}>`,
        );
        expect(clearedCtx!.promptBlock).toBe(plainCtx!.promptBlock);
        expect(plainCtx!.promptBlock).not.toContain('read-only');
    });

    it('a read-only flag change drifts the block so it is re-injected', async () => {
        const ws = await createRepoGroup(tmpDir, store, { name: 'G', members: ['ws-v2-aaa'] });
        const before = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        await updateRepoGroup(tmpDir, store, ws.id, { readOnly: { 'ws-v2-aaa': true } });
        const after = await resolveRepoGroupChatContext(store, tmpDir, ws.id);

        expect(after!.promptBlock).not.toBe(before!.promptBlock);
        expect(
            shouldInjectRepoGroupContext({
                context: after,
                turns: [{ role: 'user', content: 'hi', timestamp: new Date(), repoGroupContext: before!.promptBlock }] as unknown as ConversationTurn[],
                compaction: undefined,
                canResumeSession: true,
            }),
        ).toBe(true);
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


describe('shouldInjectRepoGroupContext', () => {
    const CONTEXT = {
        promptBlock: '<repo_group_context>\nRepo group "G" members:\n- A: /a\n</repo_group_context>',
        additionalDirectories: ['/a'],
    };
    const DRIFTED = {
        promptBlock: '<repo_group_context>\nRepo group "G" members:\n- A: /a\n- B: /b\n</repo_group_context>',
        additionalDirectories: ['/a', '/b'],
    };

    /** A turn at `turnIndex`, one minute apart so timestamp ordering is stable. */
    function turn(turnIndex: number, overrides: Partial<ConversationTurn>): ConversationTurn {
        return {
            role: 'user',
            content: 'msg',
            timestamp: new Date(Date.UTC(2026, 0, 1, 0, turnIndex)),
            turnIndex,
            timeline: [],
            ...overrides,
        } as ConversationTurn;
    }

    /** A session that already carries the block, injected on turn 0. */
    function injectedHistory(): ConversationTurn[] {
        return [
            turn(0, { repoGroupContext: CONTEXT.promptBlock }),
            turn(1, { role: 'assistant', content: 'ok' }),
            turn(2, {}),
        ];
    }

    function check(overrides: Partial<Parameters<typeof shouldInjectRepoGroupContext>[0]> = {}) {
        return shouldInjectRepoGroupContext({
            context: CONTEXT,
            turns: injectedHistory(),
            compaction: undefined,
            canResumeSession: true,
            ...overrides,
        });
    }

    it('never injects without a context (non-group chats)', () => {
        expect(check({ context: undefined, canResumeSession: false })).toBe(false);
        expect(check({ context: undefined, turns: [] })).toBe(false);
    });

    it('injects when there is no resumable session (first turn / history rebuild)', () => {
        expect(check({ canResumeSession: false, turns: undefined })).toBe(true);
        // Even though the block was injected earlier, a rebuilt history drops it.
        expect(check({ canResumeSession: false })).toBe(true);
    });

    it('injects when no earlier turn ever carried the block', () => {
        expect(check({ turns: [] })).toBe(true);
        expect(check({ turns: [turn(0, {}), turn(1, { role: 'assistant', content: 'ok' })] })).toBe(true);
    });

    it('skips injection on a live session that already carries the same block', () => {
        expect(check()).toBe(false);
    });

    it('re-injects when the resolved membership listing drifted', () => {
        expect(check({ context: DRIFTED })).toBe(true);
    });

    it('re-injects after a compaction result turn was appended', () => {
        const turns = injectedHistory();
        turns.push(turn(3, { role: 'assistant', content: 'Context compacted', displayOnly: true }));
        expect(check({ turns })).toBe(true);
    });

    it('re-injects after a completed compaction recorded in process metadata', () => {
        expect(check({
            compaction: { state: 'completed', completedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString() },
        })).toBe(true);
    });

    it('ignores a compaction that settled before the last injection', () => {
        expect(check({
            compaction: { state: 'completed', completedAt: new Date(Date.UTC(2025, 0, 1)).toISOString() },
        })).toBe(false);
    });

    it('ignores a running or failed compaction', () => {
        const startedAt = new Date(Date.UTC(2026, 0, 1, 1)).toISOString();
        expect(check({ compaction: { state: 'running', startedAt } })).toBe(false);
        expect(check({ compaction: { state: 'failed', startedAt, completedAt: startedAt } })).toBe(false);
    });

    it('reads ISO-string timestamps from a serialized transcript', () => {
        const turns = injectedHistory().map(t => ({ ...t, timestamp: t.timestamp.toISOString() })) as unknown as ConversationTurn[];
        expect(check({ turns })).toBe(false);
        expect(check({
            turns,
            compaction: { state: 'completed', completedAt: new Date(Date.UTC(2026, 0, 1, 1)).toISOString() },
        })).toBe(true);
    });

    it('compares against the MOST RECENT injection, not the first', () => {
        const turns = injectedHistory();
        // A later turn re-injected the drifted listing; the current resolve
        // matches that one, so nothing more is needed.
        turns.push(turn(3, { repoGroupContext: DRIFTED.promptBlock }));
        expect(check({ turns, context: DRIFTED })).toBe(false);
        expect(check({ turns, context: CONTEXT })).toBe(true);
    });
});
