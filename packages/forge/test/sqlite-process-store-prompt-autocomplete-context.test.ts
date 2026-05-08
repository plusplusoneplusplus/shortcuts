/**
 * SqliteProcessStore - getPromptAutocompleteContext tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { SqliteProcessStore, AIProcess, AIProcessStatus, ConversationTurn } from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, fullPrompt: string, workspaceId: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: fullPrompt.slice(0, 60),
        fullPrompt,
        status: 'completed' as AIProcessStatus,
        startTime: new Date('2024-06-01T12:00:00Z'),
        metadata: { type: 'ai', workspaceId },
        ...overrides,
    };
}

function makeTurn(turnIndex: number, role: 'user' | 'assistant', content: string, timestamp?: string): ConversationTurn {
    return {
        turnIndex,
        role,
        content,
        timestamp: new Date(timestamp ?? '2024-06-01T12:00:00Z'),
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-autocomplete-context-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getPromptAutocompleteContext', () => {
    it('returns workspace-scoped initial prompts and user follow-up turns', async () => {
        await store.addProcess(makeProcess('p1', 'fix the queue autocomplete test', 'ws-a'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'user', 'fix the queue route'));
        await store.addProcess(makeProcess('p2', 'fix the unrelated repo task', 'ws-b'));

        const context = store.getPromptAutocompleteContext('fix the ', {
            workspaceId: 'ws-a',
            processId: 'p1',
            limit: 10,
        });

        expect(context.exactPrefixMatches.map(item => item.text)).toEqual([
            'fix the queue autocomplete test',
            'fix the queue route',
        ]);
        expect(context.recentWorkspacePrompts.map(item => item.text)).toEqual([
            'fix the queue autocomplete test',
        ]);
        expect(context.recentProcessTurns.map(item => item.text)).toEqual([
            'fix the queue route',
        ]);
        expect(context.historyFingerprint).toMatch(/^4:2024-06-01T12:00:00\.000Z:4$/);
    });

    it('excludes assistant turns, deleted turns, archived turns, and archived processes', async () => {
        await store.addProcess(makeProcess('p1', 'fix the visible prompt', 'ws-a'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'assistant', 'fix the assistant response'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'user', 'fix the deleted turn'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'user', 'fix the archived turn'));
        const db = store.getDatabase();
        db.prepare("UPDATE conversation_turns SET deleted_at = ? WHERE content = 'fix the deleted turn'")
            .run(new Date().toISOString());
        db.prepare("UPDATE conversation_turns SET archived = 1 WHERE content = 'fix the archived turn'").run();

        await store.addProcess(makeProcess('p2', 'fix the archived process', 'ws-a'));
        db.prepare('UPDATE processes SET archived = 1 WHERE id = ?').run('p2');

        const context = store.getPromptAutocompleteContext('fix the ', {
            workspaceId: 'ws-a',
            processId: 'p1',
            limit: 10,
        });

        const texts = [
            ...context.exactPrefixMatches,
            ...context.recentWorkspacePrompts,
            ...context.recentProcessTurns,
        ].map(item => item.text);
        expect(texts).toEqual(['fix the visible prompt', 'fix the visible prompt']);
    });

    it('includes global history only when explicitly requested', async () => {
        await store.addProcess(makeProcess('p1', 'deploy the backend', 'ws-a'));
        await store.addProcess(makeProcess('p2', 'deploy the frontend', 'ws-b'));

        const scoped = store.getPromptAutocompleteContext('deploy the ', {
            workspaceId: 'ws-a',
            limit: 10,
        });
        const global = store.getPromptAutocompleteContext('deploy the ', {
            workspaceId: 'ws-a',
            includeGlobalHistory: true,
            limit: 10,
        });

        expect(scoped.exactPrefixMatches.map(item => item.text)).toEqual(['deploy the backend']);
        expect(global.exactPrefixMatches.map(item => item.text)).toEqual([
            'deploy the backend',
            'deploy the frontend',
        ]);
    });

    it('scopes recent process turns to the requested workspace', async () => {
        await store.addProcess(makeProcess('p1', 'fix the queue task', 'ws-a'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'user', 'fix the queue follow-up'));

        const context = store.getPromptAutocompleteContext('fix the ', {
            workspaceId: 'ws-b',
            processId: 'p1',
            limit: 10,
        });

        expect(context.exactPrefixMatches).toEqual([]);
        expect(context.recentWorkspacePrompts).toEqual([]);
        expect(context.recentProcessTurns).toEqual([]);
    });

    it('includes recent process turns across workspaces only when global history is requested', async () => {
        await store.addProcess(makeProcess('p1', 'fix the queue task', 'ws-a'));
        await store.appendConversationTurn('p1', idx => makeTurn(idx, 'user', 'fix the queue follow-up'));

        const context = store.getPromptAutocompleteContext('fix the ', {
            workspaceId: 'ws-b',
            processId: 'p1',
            includeGlobalHistory: true,
            limit: 10,
        });

        expect(context.recentProcessTurns.map(item => item.text)).toEqual(['fix the queue follow-up']);
    });

    it('returns no context without workspace unless global history is requested', async () => {
        await store.addProcess(makeProcess('p1', 'fix the queue task', 'ws-a'));

        const context = store.getPromptAutocompleteContext('fix the ');

        expect(context.exactPrefixMatches).toEqual([]);
        expect(context.recentWorkspacePrompts).toEqual([]);
        expect(context.recentProcessTurns).toEqual([]);
        expect(context.historyFingerprint).toBe('0::0');
    });

    it('escapes SQL LIKE wildcards in the prefix', async () => {
        await store.addProcess(makeProcess('p1', 'fix 100% of tests', 'ws-a'));
        await store.addProcess(makeProcess('p2', 'fix 1abc of tests', 'ws-a'));

        const context = store.getPromptAutocompleteContext('fix 100% ', {
            workspaceId: 'ws-a',
            limit: 10,
        });

        expect(context.exactPrefixMatches.map(item => item.text)).toEqual(['fix 100% of tests']);
    });
});
