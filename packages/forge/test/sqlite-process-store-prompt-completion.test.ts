/**
 * SqliteProcessStore — getBestPromptCompletion tests.
 *
 * Validates the inline-completion query used by the Queue Task autocomplete
 * feature: prefix matching against past initial prompts and user follow-up
 * turns, ranked by frequency, recency, then completion length.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { SqliteProcessStore, AIProcess, AIProcessStatus, ConversationTurn } from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, fullPrompt: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: fullPrompt.slice(0, 60),
        fullPrompt,
        status: 'completed' as AIProcessStatus,
        startTime: new Date('2024-06-01T12:00:00Z'),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
        ...overrides,
    };
}

function makeUserTurn(turnIndex: number, content: string, timestamp?: string): ConversationTurn {
    return {
        turnIndex,
        role: 'user',
        content,
        timestamp: new Date(timestamp ?? '2024-06-01T12:00:00Z'),
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-completion-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getBestPromptCompletion', () => {
    it('returns null when no historic prompts match', async () => {
        await store.addProcess(makeProcess('p1', 'unrelated prompt content here'));
        expect(store.getBestPromptCompletion('hello world')).toBeNull();
    });

    it('returns null when prefix is shorter than minPrefixLen (default 3)', async () => {
        await store.addProcess(makeProcess('p1', 'hello world from initial'));
        expect(store.getBestPromptCompletion('he')).toBeNull();
        expect(store.getBestPromptCompletion('hel')).not.toBeNull();
    });

    it('returns null when prefix is longer than 500 chars', async () => {
        await store.addProcess(makeProcess('p1', 'x'.repeat(800)));
        expect(store.getBestPromptCompletion('x'.repeat(501))).toBeNull();
    });

    it('returns suffix (not full text) for an initial prompt match', async () => {
        await store.addProcess(makeProcess('p1', 'fix the bug now'));
        const result = store.getBestPromptCompletion('fix the ');
        expect(result).toEqual({ completion: 'bug now', source: 'initial' });
    });

    it('returns suffix for a user follow-up turn match', async () => {
        await store.addProcess(makeProcess('p1', 'unrelated initial'));
        await store.appendConversationTurn(
            'p1',
            (idx) => makeUserTurn(idx, 'fix the build script please'),
        );
        const result = store.getBestPromptCompletion('fix the ');
        expect(result?.completion).toBe('build script please');
    });

    it('ignores assistant turns', async () => {
        await store.addProcess(makeProcess('p1', 'unrelated initial'));
        await store.appendConversationTurn('p1', (idx) => ({
            turnIndex: idx,
            role: 'assistant',
            content: 'fix the issue and commit',
            timestamp: new Date('2024-06-01T12:00:00Z'),
        }));
        expect(store.getBestPromptCompletion('fix the ')).toBeNull();
    });

    it('picks the most frequent matching prompt over a more recent rare one', async () => {
        // "fix the bug" appears twice (older)
        await store.addProcess(makeProcess('p1', 'fix the bug', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'fix the bug', {
            startTime: new Date('2024-06-01T11:00:00Z'),
        }));
        // "fix the lint" appears once but more recently
        await store.addProcess(makeProcess('p3', 'fix the lint', {
            startTime: new Date('2024-06-01T13:00:00Z'),
        }));

        const result = store.getBestPromptCompletion('fix the ');
        expect(result?.completion).toBe('bug');
    });

    it('picks the most recent when frequencies tie', async () => {
        await store.addProcess(makeProcess('p1', 'fix the bug', {
            startTime: new Date('2024-06-01T10:00:00Z'),
        }));
        await store.addProcess(makeProcess('p2', 'fix the lint', {
            startTime: new Date('2024-06-01T13:00:00Z'),
        }));
        const result = store.getBestPromptCompletion('fix the ');
        expect(result?.completion).toBe('lint');
    });

    it('picks the shortest completion when frequency and recency tie', async () => {
        const ts = '2024-06-01T13:00:00Z';
        await store.addProcess(makeProcess('p1', 'fix the bug', { startTime: new Date(ts) }));
        await store.addProcess(makeProcess('p2', 'fix the broken thing', {
            startTime: new Date(ts),
        }));
        const result = store.getBestPromptCompletion('fix the ');
        expect(result?.completion).toBe('bug');
    });

    it('matches case-insensitively', async () => {
        await store.addProcess(makeProcess('p1', 'Fix the bug now'));
        const result = store.getBestPromptCompletion('fix ');
        expect(result?.completion).toBe('the bug now');
    });

    it('ignores leading whitespace in the typed prefix', async () => {
        await store.addProcess(makeProcess('p1', 'fix the bug now'));
        const result = store.getBestPromptCompletion('   fix the ');
        expect(result?.completion).toBe('bug now');
    });

    it('returns null when the historic text equals the prefix (no suffix)', async () => {
        await store.addProcess(makeProcess('p1', 'fix the bug'));
        const result = store.getBestPromptCompletion('fix the bug');
        expect(result).toBeNull();
    });

    it('is global: matches across different workspaces', async () => {
        await store.addProcess(makeProcess('p1', 'deploy the backend now', {
            metadata: { type: 'ai', workspaceId: 'ws-A' },
        }));
        await store.addProcess(makeProcess('p2', 'deploy the frontend now', {
            metadata: { type: 'ai', workspaceId: 'ws-B' },
            startTime: new Date('2024-06-01T13:00:00Z'),
        }));
        const result = store.getBestPromptCompletion('deploy the ');
        expect(result?.completion).toBe('frontend now');
    });

    it('excludes archived processes', async () => {
        const db = store.getDatabase();
        await store.addProcess(makeProcess('p1', 'fix the bug'));
        db.prepare('UPDATE processes SET archived = 1 WHERE id = ?').run('p1');
        expect(store.getBestPromptCompletion('fix the ')).toBeNull();
    });

    it('excludes deleted turns', async () => {
        await store.addProcess(makeProcess('p1', 'unrelated initial'));
        await store.appendConversationTurn('p1', (idx) =>
            makeUserTurn(idx, 'restart the server now'),
        );
        const db = store.getDatabase();
        db.prepare(
            "UPDATE conversation_turns SET deleted_at = ? WHERE process_id = ? AND role = 'user'",
        ).run(new Date().toISOString(), 'p1');
        expect(store.getBestPromptCompletion('restart the ')).toBeNull();
    });

    it('escapes SQL LIKE wildcards in user prefix', async () => {
        await store.addProcess(makeProcess('p1', 'fix 100% of the bugs'));
        // prefix with literal % should not act as a wildcard
        const wrong = store.getBestPromptCompletion('fix 1%%');
        expect(wrong).toBeNull();
        const right = store.getBestPromptCompletion('fix 100% of ');
        expect(right?.completion).toBe('the bugs');
    });
});
