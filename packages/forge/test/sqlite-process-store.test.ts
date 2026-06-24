/**
 * SqliteProcessStore Tests — Main Suite
 *
 * Validates process CRUD, filtering, summaries, workspace/wiki management,
 * event bus, and storage stats through the ProcessStore interface.
 * All tests use a temp directory with an isolated SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    AIProcess,
    AIProcessStatus,
    ConversationTurn,
    ProcessOutputEvent,
    WorkspaceInfo,
    WikiInfo,
} from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
        ...overrides,
    };
}

function makeTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: 'user',
        content: `message-${index}`,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// Process CRUD
// ============================================================================

describe('SqliteProcessStore — Process CRUD', () => {
    it('addProcess + getProcess round-trip preserves all fields', async () => {
        const now = new Date();
        const endTime = new Date(now.getTime() + 5000);
        const p = makeProcess('p1', {
            type: 'code-review',
            promptPreview: 'review this',
            fullPrompt: 'review this code thoroughly',
            status: 'completed',
            startTime: now,
            endTime,
            error: 'some error',
            result: 'looks good',
            resultFilePath: '/tmp/result.md',
            rawStdoutFilePath: '/tmp/stdout.txt',
            structuredResult: '{"score": 100}',
            parentProcessId: 'parent-1',
            sdkSessionId: 'session-abc',
            backend: 'copilot',
            workingDirectory: '/workspace',
            title: 'My Review',
            tokenLimit: 8000,
            currentTokens: 3500,
            systemTokens: 1200,
            toolDefinitionsTokens: 1800,
            conversationTokens: 500,
            cumulativeTokenUsage: {
                inputTokens: 100, outputTokens: 50,
                cacheReadTokens: 10, cacheWriteTokens: 5,
                totalTokens: 150, turnCount: 2,
            },
            stale: true,
            metadata: { type: 'code-review', workspaceId: 'ws-a' },
        });
        await store.addProcess(p);

        const result = await store.getProcess('p1');
        expect(result).toBeDefined();
        expect(result!.id).toBe('p1');
        expect(result!.type).toBe('code-review');
        expect(result!.promptPreview).toBe('review this');
        expect(result!.fullPrompt).toBe('review this code thoroughly');
        expect(result!.status).toBe('completed');
        expect(result!.startTime.getTime()).toBe(now.getTime());
        expect(result!.endTime!.getTime()).toBe(endTime.getTime());
        expect(result!.error).toBe('some error');
        expect(result!.result).toBe('looks good');
        expect(result!.resultFilePath).toBe('/tmp/result.md');
        expect(result!.rawStdoutFilePath).toBe('/tmp/stdout.txt');
        expect(result!.structuredResult).toBe('{"score": 100}');
        expect(result!.parentProcessId).toBe('parent-1');
        expect(result!.sdkSessionId).toBe('session-abc');
        expect(result!.backend).toBe('copilot');
        expect(result!.workingDirectory).toBe('/workspace');
        expect(result!.title).toBe('My Review');
        expect(result!.tokenLimit).toBe(8000);
        expect(result!.currentTokens).toBe(3500);
        expect(result!.systemTokens).toBe(1200);
        expect(result!.toolDefinitionsTokens).toBe(1800);
        expect(result!.conversationTokens).toBe(500);
        expect(result!.cumulativeTokenUsage?.inputTokens).toBe(100);
        expect(result!.cumulativeTokenUsage?.outputTokens).toBe(50);
        expect(result!.stale).toBe(true);
        expect(result!.metadata?.workspaceId).toBe('ws-a');
    });

    it('addProcess stores and retrieves conversationTurns', async () => {
        const p = makeProcess('p-turns', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'hello' }),
                makeTurn(1, { role: 'assistant', content: 'hi there' }),
            ],
        });
        await store.addProcess(p);

        const result = await store.getProcess('p-turns');
        expect(result!.conversationTurns).toHaveLength(2);
        expect(result!.conversationTurns![0].role).toBe('user');
        expect(result!.conversationTurns![0].content).toBe('hello');
        expect(result!.conversationTurns![1].role).toBe('assistant');
        expect(result!.conversationTurns![1].content).toBe('hi there');
    });

    it('addProcess with duplicate ID throws (UNIQUE constraint)', async () => {
        await store.addProcess(makeProcess('dup'));
        await expect(store.addProcess(makeProcess('dup'))).rejects.toThrow();
    });

    it('updateProcess modifies status, title, result, metadata', async () => {
        await store.addProcess(makeProcess('p-upd'));

        await store.updateProcess('p-upd', {
            status: 'completed',
            title: 'Updated Title',
            result: 'done',
            systemTokens: 200,
            toolDefinitionsTokens: 300,
            conversationTokens: 400,
            metadata: { type: 'ai', workspaceId: 'ws-test', custom: 'value' } as AIProcess['metadata'],
        });

        const result = await store.getProcess('p-upd');
        expect(result!.status).toBe('completed');
        expect(result!.title).toBe('Updated Title');
        expect(result!.result).toBe('done');
        expect(result!.systemTokens).toBe(200);
        expect(result!.toolDefinitionsTokens).toBe(300);
        expect(result!.conversationTokens).toBe(400);
        expect((result!.metadata as Record<string, unknown>)?.custom).toBe('value');
    });

    it('appendConversationTurn additionalUpdates persists context breakdown fields', async () => {
        await store.addProcess(makeProcess('p-breakdown-upd'));

        await store.appendConversationTurn(
            'p-breakdown-upd',
            (idx) => makeTurn(idx, { role: 'assistant', content: 'done' }),
            {
                additionalUpdates: {
                    systemTokens: 111,
                    toolDefinitionsTokens: 222,
                    conversationTokens: 333,
                },
            },
        );

        const result = await store.getProcess('p-breakdown-upd');
        expect(result!.systemTokens).toBe(111);
        expect(result!.toolDefinitionsTokens).toBe(222);
        expect(result!.conversationTokens).toBe(333);
    });

    it('updateProcess rejects conversationTurns in update payload', async () => {
        await store.addProcess(makeProcess('p-reject'));
        await expect(
            store.updateProcess('p-reject', { conversationTurns: [] } as Partial<AIProcess>)
        ).rejects.toThrow(/conversationTurns/i);
    });

    it('getProcess with unknown ID returns undefined', async () => {
        const result = await store.getProcess('nonexistent');
        expect(result).toBeUndefined();
    });

    it('getProcess with workspaceId hint returns correct process', async () => {
        await store.addProcess(makeProcess('p-hint', { metadata: { type: 'ai', workspaceId: 'ws-x' } }));
        const result = await store.getProcess('p-hint', 'ws-x');
        expect(result).toBeDefined();
        expect(result!.id).toBe('p-hint');
    });

    it('removeProcess deletes the process and its conversation turns', async () => {
        await store.addProcess(makeProcess('p-rm', {
            conversationTurns: [makeTurn(0)],
        }));

        await store.removeProcess('p-rm');
        const result = await store.getProcess('p-rm');
        expect(result).toBeUndefined();
    });

    it('removeProcess with unknown ID is a no-op', async () => {
        await expect(store.removeProcess('ghost')).resolves.not.toThrow();
    });
});

// ============================================================================
// Filtering — getAllProcesses
// ============================================================================

describe('SqliteProcessStore — getAllProcesses filtering', () => {
    it('no filter returns all processes', async () => {
        await store.addProcess(makeProcess('a'));
        await store.addProcess(makeProcess('b'));
        const all = await store.getAllProcesses();
        expect(all).toHaveLength(2);
    });

    it('filters by workspaceId', async () => {
        await store.addProcess(makeProcess('a', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const filtered = await store.getAllProcesses({ workspaceId: 'ws-a' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('a');
    });

    it('filters by status (single value)', async () => {
        await store.addProcess(makeProcess('r', { status: 'running' }));
        await store.addProcess(makeProcess('c', { status: 'completed' }));

        const running = await store.getAllProcesses({ status: 'running' });
        expect(running).toHaveLength(1);
        expect(running[0].id).toBe('r');
    });

    it('filters by status (array)', async () => {
        await store.addProcess(makeProcess('r', { status: 'running' }));
        await store.addProcess(makeProcess('c', { status: 'completed' }));
        await store.addProcess(makeProcess('f', { status: 'failed' }));

        const filtered = await store.getAllProcesses({ status: ['running', 'completed'] });
        expect(filtered).toHaveLength(2);
        const ids = filtered.map(p => p.id).sort();
        expect(ids).toEqual(['c', 'r']);
    });

    it('filters by type', async () => {
        await store.addProcess(makeProcess('a', { type: 'code-review' }));
        await store.addProcess(makeProcess('b', { type: 'discovery' }));

        const filtered = await store.getAllProcesses({ type: 'code-review' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('a');
    });

    it('filters by since date', async () => {
        const old = new Date('2024-01-01T00:00:00Z');
        const recent = new Date('2025-06-01T00:00:00Z');

        await store.addProcess(makeProcess('old', { startTime: old }));
        await store.addProcess(makeProcess('recent', { startTime: recent }));

        const filtered = await store.getAllProcesses({ since: new Date('2025-01-01T00:00:00Z') });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('recent');
    });

    it('filters by parentProcessId', async () => {
        await store.addProcess(makeProcess('child', { parentProcessId: 'parent-1' }));
        await store.addProcess(makeProcess('orphan'));

        const filtered = await store.getAllProcesses({ parentProcessId: 'parent-1' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('child');
    });

    it('supports combined filters (workspaceId + status)', async () => {
        await store.addProcess(makeProcess('a-run', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('a-done', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b-run', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const filtered = await store.getAllProcesses({ workspaceId: 'ws-a', status: 'completed' });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('a-done');
    });

    it('exclude: ["conversation"] strips conversationTurns from results', async () => {
        await store.addProcess(makeProcess('p-ex', {
            conversationTurns: [makeTurn(0)],
        }));

        const results = await store.getAllProcesses({ exclude: ['conversation'] });
        expect(results).toHaveLength(1);
        expect(results[0].conversationTurns).toBeUndefined();
    });

    it('exclude: ["toolCalls"] strips tool calls from within conversation turns', async () => {
        const turnWithTools = makeTurn(0, {
            toolCalls: [{
                id: 'tc1', name: 'bash', status: 'completed',
                startTime: new Date(), args: { command: 'ls' }, result: 'output',
            }],
        });
        await store.addProcess(makeProcess('p-tc', {
            conversationTurns: [turnWithTools],
        }));

        const results = await store.getAllProcesses({ exclude: ['toolCalls'] });
        expect(results).toHaveLength(1);
        expect(results[0].conversationTurns![0].toolCalls).toBeUndefined();
    });

    it('empty database returns []', async () => {
        const results = await store.getAllProcesses();
        expect(results).toEqual([]);
    });
});

// ============================================================================
// Summaries — getProcessSummaries
// ============================================================================

describe('SqliteProcessStore — getProcessSummaries', () => {
    it('returns { entries, total } with correct total count', async () => {
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`s${i}`));
        }

        const { entries, total } = await store.getProcessSummaries!();
        expect(total).toBe(5);
        expect(entries).toHaveLength(5);
    });

    it('entries contain index-like fields without full conversation', async () => {
        const now = new Date();
        await store.addProcess(makeProcess('s1', {
            startTime: now,
            type: 'discovery',
            status: 'completed',
            title: 'My Process',
            metadata: { type: 'discovery', workspaceId: 'ws-s' },
            conversationTurns: [makeTurn(0)],
        }));

        const { entries } = await store.getProcessSummaries!();
        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.id).toBe('s1');
        expect(entry.status).toBe('completed');
        expect(entry.type).toBe('discovery');
        expect(entry.promptPreview).toBe('test prompt');
        expect(entry.workspaceId).toBe('ws-s');
        expect(entry.title).toBe('My Process');
        // Should NOT have conversation data
        expect((entry as Record<string, unknown>).conversationTurns).toBeUndefined();
    });

    it('pagination with limit and offset', async () => {
        for (let i = 0; i < 10; i++) {
            await store.addProcess(makeProcess(`pg${i}`, {
                startTime: new Date(2025, 0, i + 1),
            }));
        }

        const { entries, total } = await store.getProcessSummaries!({ limit: 3, offset: 2 });
        expect(total).toBe(10);
        expect(entries).toHaveLength(3);
    });

    it('filter applies before pagination (total reflects filtered count)', async () => {
        for (let i = 0; i < 5; i++) {
            await store.addProcess(makeProcess(`fc${i}`, { status: i < 3 ? 'running' : 'completed' }));
        }

        const { entries, total } = await store.getProcessSummaries!({ status: 'running', limit: 2 });
        expect(total).toBe(3);
        expect(entries).toHaveLength(2);
    });

    it('time filters use activity time for metadata summaries', async () => {
        await store.addProcess(makeProcess('old', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-28T12:00:00.000Z'),
        }));
        await store.addProcess(makeProcess('active', {
            startTime: new Date('2026-04-28T12:00:00.000Z'),
            lastEventAt: new Date('2026-04-29T12:00:00.000Z'),
        }));

        const { entries, total } = await store.getProcessSummaries!({
            since: new Date('2026-04-29T00:00:00.000Z'),
            until: new Date('2026-04-30T00:00:00.000Z'),
        });

        expect(total).toBe(1);
        expect(entries.map(e => e.id)).toEqual(['active']);
        expect(entries[0].activityAt).toBe('2026-04-29T12:00:00.000Z');
    });

    it('surfaces pendingAskUserCount in entries when the process is awaiting input', async () => {
        const questions = [
            {
                batchId: 'batch-1',
                questionId: 'q1',
                question: 'Pick one',
                type: 'select',
                options: [{ value: 'a', label: 'Option A' }],
                defaultValue: 'a',
                turnIndex: 1,
                index: 0,
                batchSize: 2,
            },
            {
                batchId: 'batch-1',
                questionId: 'q2',
                question: 'Pick another',
                type: 'select',
                options: [{ value: 'a', label: 'Option A' }],
                defaultValue: 'a',
                turnIndex: 1,
                index: 1,
                batchSize: 2,
            },
        ];

        await store.addProcess(makeProcess('waiting', {
            status: 'running',
            pendingAskUser: questions as AIProcess['pendingAskUser'],
        }));
        await store.addProcess(makeProcess('thinking', { status: 'running' }));

        const { entries } = await store.getProcessSummaries!();
        const byId = Object.fromEntries(entries.map(e => [e.id, e]));
        expect(byId['waiting'].pendingAskUserCount).toBe(2);
        expect(byId['thinking'].pendingAskUserCount).toBeUndefined();

        // Clearing pendingAskUser should drop the count from subsequent summaries.
        await store.updateProcess('waiting', { pendingAskUser: undefined });
        const { entries: cleared } = await store.getProcessSummaries!();
        expect(cleared.find(e => e.id === 'waiting')!.pendingAskUserCount).toBeUndefined();
    });
});

// ============================================================================
// Bulk operations — clearProcesses
// ============================================================================

describe('SqliteProcessStore — clearProcesses', () => {
    it('clears all processes when no filter', async () => {
        await store.addProcess(makeProcess('c1'));
        await store.addProcess(makeProcess('c2'));

        const count = await store.clearProcesses();
        expect(count).toBe(2);

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(0);
    });

    it('clears only matching processes when filter provided', async () => {
        await store.addProcess(makeProcess('done1', { status: 'completed' }));
        await store.addProcess(makeProcess('done2', { status: 'completed' }));
        await store.addProcess(makeProcess('run1', { status: 'running' }));

        const count = await store.clearProcesses({ status: 'completed' });
        expect(count).toBe(2);

        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('run1');
    });

    it('returns count of removed processes', async () => {
        await store.addProcess(makeProcess('x1'));
        const count = await store.clearProcesses();
        expect(count).toBe(1);
    });

    it('non-matching processes survive', async () => {
        await store.addProcess(makeProcess('a', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('b', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        await store.clearProcesses({ workspaceId: 'ws-a' });
        const remaining = await store.getAllProcesses();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('b');
    });
});

// ============================================================================
// Workspace CRUD
// ============================================================================

describe('SqliteProcessStore — Workspace CRUD', () => {
    const makeWorkspace = (id: string, overrides?: Partial<WorkspaceInfo>): WorkspaceInfo => ({
        id,
        name: `Workspace ${id}`,
        rootPath: `/path/to/${id}`,
        ...overrides,
    });

    it('registerWorkspace + getWorkspaces round-trip', async () => {
        await store.registerWorkspace(makeWorkspace('ws-1', {
            color: '#ff0000',
            remoteUrl: 'https://github.com/test/repo',
            description: 'Test workspace',
        }));

        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].id).toBe('ws-1');
        expect(workspaces[0].name).toBe('Workspace ws-1');
        expect(workspaces[0].rootPath).toBe('/path/to/ws-1');
        expect(workspaces[0].color).toBe('#ff0000');
        expect(workspaces[0].remoteUrl).toBe('https://github.com/test/repo');
        expect(workspaces[0].description).toBe('Test workspace');
    });

    it('registerWorkspace with duplicate ID updates existing', async () => {
        await store.registerWorkspace(makeWorkspace('ws-dup', { name: 'Original' }));
        await store.registerWorkspace(makeWorkspace('ws-dup', { name: 'Updated' }));

        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].name).toBe('Updated');
    });

    it('updateWorkspace modifies fields, returns updated workspace', async () => {
        await store.registerWorkspace(makeWorkspace('ws-mod'));

        const updated = await store.updateWorkspace('ws-mod', {
            name: 'New Name',
            color: '#00ff00',
        });

        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New Name');
        expect(updated!.color).toBe('#00ff00');
        expect(updated!.rootPath).toBe('/path/to/ws-mod');
    });

    it('updateWorkspace with unknown ID returns undefined', async () => {
        const result = await store.updateWorkspace('ghost', { name: 'nope' });
        expect(result).toBeUndefined();
    });

    it('removeWorkspace returns true on success, false on unknown', async () => {
        await store.registerWorkspace(makeWorkspace('ws-rm'));

        expect(await store.removeWorkspace('ws-rm')).toBe(true);
        expect(await store.removeWorkspace('ws-rm')).toBe(false);
        expect(await store.getWorkspaces()).toHaveLength(0);
    });

    it('clearAllWorkspaces returns count, empties list', async () => {
        await store.registerWorkspace(makeWorkspace('ws-a'));
        await store.registerWorkspace(makeWorkspace('ws-b'));

        const count = await store.clearAllWorkspaces();
        expect(count).toBe(2);
        expect(await store.getWorkspaces()).toHaveLength(0);
    });

    it('preserves enabledMcpServers, disabledSkills, extraSkillFolders, virtual', async () => {
        await store.registerWorkspace(makeWorkspace('ws-extra', {
            enabledMcpServers: ['server-a', 'server-b'],
            disabledSkills: ['skill-x'],
            extraSkillFolders: ['/extra/skills'],
            virtual: true,
        }));

        const workspaces = await store.getWorkspaces();
        expect(workspaces[0].enabledMcpServers).toEqual(['server-a', 'server-b']);
        expect(workspaces[0].disabledSkills).toEqual(['skill-x']);
        expect(workspaces[0].extraSkillFolders).toEqual(['/extra/skills']);
        expect(workspaces[0].virtual).toBe(true);
    });
});

// ============================================================================
// Wiki CRUD
// ============================================================================

describe('SqliteProcessStore — Wiki CRUD', () => {
    const makeWiki = (id: string, overrides?: Partial<WikiInfo>): WikiInfo => ({
        id,
        name: `Wiki ${id}`,
        wikiDir: `/wikis/${id}`,
        aiEnabled: true,
        registeredAt: new Date().toISOString(),
        ...overrides,
    });

    it('registerWiki + getWikis round-trip', async () => {
        await store.registerWiki(makeWiki('w-1', {
            repoPath: '/repo',
            color: '#0000ff',
        }));

        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].id).toBe('w-1');
        expect(wikis[0].name).toBe('Wiki w-1');
        expect(wikis[0].wikiDir).toBe('/wikis/w-1');
        expect(wikis[0].repoPath).toBe('/repo');
        expect(wikis[0].color).toBe('#0000ff');
        expect(wikis[0].aiEnabled).toBe(true);
    });

    it('registerWiki with duplicate ID updates existing', async () => {
        await store.registerWiki(makeWiki('w-dup', { name: 'Original' }));
        await store.registerWiki(makeWiki('w-dup', { name: 'Updated' }));

        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].name).toBe('Updated');
    });

    it('updateWiki modifies fields, returns updated wiki', async () => {
        await store.registerWiki(makeWiki('w-mod'));

        const updated = await store.updateWiki('w-mod', {
            name: 'New Wiki Name',
            aiEnabled: false,
        });

        expect(updated).toBeDefined();
        expect(updated!.name).toBe('New Wiki Name');
        expect(updated!.aiEnabled).toBe(false);
        expect(updated!.wikiDir).toBe('/wikis/w-mod');
    });

    it('updateWiki with unknown ID returns undefined', async () => {
        const result = await store.updateWiki('ghost', { name: 'nope' });
        expect(result).toBeUndefined();
    });

    it('removeWiki returns true on success, false on unknown', async () => {
        await store.registerWiki(makeWiki('w-rm'));

        expect(await store.removeWiki('w-rm')).toBe(true);
        expect(await store.removeWiki('w-rm')).toBe(false);
        expect(await store.getWikis()).toHaveLength(0);
    });

    it('clearAllWikis returns count, empties list', async () => {
        await store.registerWiki(makeWiki('w-a'));
        await store.registerWiki(makeWiki('w-b'));

        const count = await store.clearAllWikis();
        expect(count).toBe(2);
        expect(await store.getWikis()).toHaveLength(0);
    });
});

// ============================================================================
// EventEmitter Bus
// ============================================================================

describe('SqliteProcessStore — EventEmitter bus', () => {
    it('onProcessOutput subscribes and receives ProcessOutputEvent on emitProcessOutput', async () => {
        const events: ProcessOutputEvent[] = [];
        store.onProcessOutput('ev-1', (event) => events.push(event));

        store.emitProcessOutput('ev-1', 'hello world');

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('chunk');
        expect(events[0].content).toBe('hello world');
    });

    it('onProcessOutput returns unsubscribe function that stops delivery', async () => {
        const events: ProcessOutputEvent[] = [];
        const unsub = store.onProcessOutput('ev-2', (event) => events.push(event));

        store.emitProcessOutput('ev-2', 'before');
        unsub();
        store.emitProcessOutput('ev-2', 'after');

        expect(events).toHaveLength(1);
        expect(events[0].content).toBe('before');
    });

    it('emitProcessComplete fires completion event with status and duration, then cleans up', async () => {
        const events: ProcessOutputEvent[] = [];
        store.onProcessOutput('ev-3', (event) => events.push(event));

        store.emitProcessComplete('ev-3', 'completed', '5s');

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('complete');
        expect(events[0].status).toBe('completed');
        expect(events[0].duration).toBe('5s');

        // After complete, emitter is cleaned up — further emits should not reach old listener
        const eventsAfter: ProcessOutputEvent[] = [];
        store.onProcessOutput('ev-3', (event) => eventsAfter.push(event));
        store.emitProcessOutput('ev-3', 'new chunk');
        // The old listener should NOT receive the new chunk
        expect(events).toHaveLength(1);
    });

    it('emitProcessEvent delivers arbitrary ProcessOutputEvent', async () => {
        const events: ProcessOutputEvent[] = [];
        store.onProcessOutput('ev-4', (event) => events.push(event));

        store.emitProcessEvent('ev-4', {
            type: 'tool-start',
            toolName: 'bash',
            toolCallId: 'tc-1',
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('tool-start');
        expect(events[0].toolName).toBe('bash');
    });

    it('onProcessChange callback fires on addProcess, updateProcess, removeProcess, clearProcesses', async () => {
        const changes: Array<{ type: string }> = [];
        store.onProcessChange = (event) => changes.push(event);

        await store.addProcess(makeProcess('ch-1'));
        await store.updateProcess('ch-1', { status: 'completed' });
        await store.removeProcess('ch-1');

        await store.addProcess(makeProcess('ch-2'));
        await store.clearProcesses();

        expect(changes.map(c => c.type)).toEqual([
            'process-added',
            'process-updated',
            'process-removed',
            'process-added',
            'processes-cleared',
        ]);
    });
});

// ============================================================================
// Flush Handlers
// ============================================================================

describe('SqliteProcessStore — Flush handlers', () => {
    it('calls registered flush handler on requestFlush', async () => {
        const handler = vi.fn(async () => {});
        store.registerFlushHandler!('fl-1', handler);
        await store.requestFlush!('fl-1');

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not call handler after unregisterFlushHandler', async () => {
        const handler = vi.fn(async () => {});
        store.registerFlushHandler!('fl-2', handler);
        store.unregisterFlushHandler!('fl-2');
        await store.requestFlush!('fl-2');

        expect(handler).not.toHaveBeenCalled();
    });

    it('requestFlush on unregistered ID is a no-op', async () => {
        await expect(store.requestFlush!('no-such')).resolves.not.toThrow();
    });
});

// ============================================================================
// Storage Stats
// ============================================================================

describe('SqliteProcessStore — Storage stats', () => {
    it('returns correct counts after add/remove operations', async () => {
        const stats0 = await store.getStorageStats();
        expect(stats0.totalProcesses).toBe(0);
        expect(stats0.totalWorkspaces).toBe(0);
        expect(stats0.totalWikis).toBe(0);

        await store.addProcess(makeProcess('st-1'));
        await store.addProcess(makeProcess('st-2'));
        await store.registerWorkspace({ id: 'ws-1', name: 'WS', rootPath: '/p' });
        await store.registerWiki({ id: 'w-1', name: 'W', wikiDir: '/w', aiEnabled: true, registeredAt: new Date().toISOString() });

        const stats1 = await store.getStorageStats();
        expect(stats1.totalProcesses).toBe(2);
        expect(stats1.totalWorkspaces).toBe(1);
        expect(stats1.totalWikis).toBe(1);
        expect(stats1.storageSize).toBeGreaterThan(0);

        await store.removeProcess('st-1');
        const stats2 = await store.getStorageStats();
        expect(stats2.totalProcesses).toBe(1);
    });
});

// ============================================================================
// Date serialization round-trip
// ============================================================================

describe('SqliteProcessStore — Date serialization', () => {
    it('startTime, endTime survive ISO round-trip', async () => {
        const start = new Date('2025-03-15T10:30:00.123Z');
        const end = new Date('2025-03-15T10:35:00.456Z');

        await store.addProcess(makeProcess('dt-1', { startTime: start, endTime: end }));
        const result = await store.getProcess('dt-1');

        expect(result!.startTime).toBeInstanceOf(Date);
        expect(result!.endTime).toBeInstanceOf(Date);
        expect(result!.startTime.toISOString()).toBe(start.toISOString());
        expect(result!.endTime!.toISOString()).toBe(end.toISOString());
    });

    it('conversation turn timestamp survives round-trip', async () => {
        const ts = new Date('2025-06-01T12:00:00.789Z');
        await store.addProcess(makeProcess('dt-2', {
            conversationTurns: [makeTurn(0, { timestamp: ts })],
        }));

        const result = await store.getProcess('dt-2');
        expect(result!.conversationTurns![0].timestamp).toBeInstanceOf(Date);
        expect(result!.conversationTurns![0].timestamp.toISOString()).toBe(ts.toISOString());
    });

    it('timeline item timestamps survive round-trip', async () => {
        const ts = new Date('2025-07-01T08:00:00.000Z');
        await store.addProcess(makeProcess('dt-3', {
            conversationTurns: [makeTurn(0, {
                timeline: [{ type: 'content', timestamp: ts, content: 'chunk' }],
            })],
        }));

        const result = await store.getProcess('dt-3');
        const timeline = result!.conversationTurns![0].timeline;
        expect(timeline).toHaveLength(1);
        expect(timeline[0].timestamp).toBeInstanceOf(Date);
        expect(timeline[0].timestamp.toISOString()).toBe(ts.toISOString());
    });

    it('tool call dates survive round-trip', async () => {
        const startTs = new Date('2025-07-01T08:00:00.000Z');
        const endTs = new Date('2025-07-01T08:00:01.000Z');
        await store.addProcess(makeProcess('dt-4', {
            conversationTurns: [makeTurn(0, {
                toolCalls: [{
                    id: 'tc1', name: 'bash', status: 'completed',
                    startTime: startTs, endTime: endTs,
                    args: { command: 'echo hi' },
                }],
            })],
        }));

        const result = await store.getProcess('dt-4');
        const tc = result!.conversationTurns![0].toolCalls![0];
        expect(tc.startTime).toBeInstanceOf(Date);
        expect(tc.startTime.toISOString()).toBe(startTs.toISOString());
        expect(tc.endTime).toBeInstanceOf(Date);
        expect(tc.endTime!.toISOString()).toBe(endTs.toISOString());
    });
});

// ============================================================================
// Metadata envelope — legacy field round-trip
// ============================================================================

describe('SqliteProcessStore — Metadata envelope', () => {
    it('folds and unfolds codeReviewMetadata', async () => {
        await store.addProcess(makeProcess('meta-cr', {
            codeReviewMetadata: { ruleFiles: ['rule1.md'], commitRange: 'abc..def' } as AIProcess['codeReviewMetadata'],
        }));

        const result = await store.getProcess('meta-cr');
        expect(result!.codeReviewMetadata).toBeDefined();
        expect((result!.codeReviewMetadata as Record<string, unknown>).ruleFiles).toEqual(['rule1.md']);
    });

    it('folds and unfolds pendingMessages', async () => {
        await store.addProcess(makeProcess('meta-pm', {
            pendingMessages: [{ role: 'user', content: 'follow-up' }] as AIProcess['pendingMessages'],
        }));

        const result = await store.getProcess('meta-pm');
        expect(result!.pendingMessages).toHaveLength(1);
    });

    it('folds, unfolds, and clears pendingAskUser', async () => {
        await store.addProcess(makeProcess('meta-ask-user', {
            pendingAskUser: [{
                batchId: 'batch-1',
                questionId: 'q1',
                question: 'Pick one',
                type: 'select',
                options: [{ value: 'a', label: 'Option A' }],
                defaultValue: 'a',
                turnIndex: 1,
                index: 0,
                batchSize: 1,
            }],
        }));

        const stored = await store.getProcess('meta-ask-user');
        expect(stored!.pendingAskUser).toEqual([{
            batchId: 'batch-1',
            questionId: 'q1',
            question: 'Pick one',
            type: 'select',
            options: [{ value: 'a', label: 'Option A' }],
            defaultValue: 'a',
            turnIndex: 1,
            index: 0,
            batchSize: 1,
        }]);

        await store.updateProcess('meta-ask-user', { pendingAskUser: undefined });

        const cleared = await store.getProcess('meta-ask-user');
        expect(cleared!.pendingAskUser).toBeUndefined();
    });

    it('folds, unfolds, and clears pendingAskUserAnswer', async () => {
        const answer = {
            batchId: 'batch-9',
            answers: [
                { questionId: 'q1', question: 'Pick one', answer: 'a', skipped: false, deferred: false },
                { questionId: 'q2', question: 'Free text', answer: null, skipped: true, deferred: false },
                { questionId: 'q3', question: 'Need ctx', answer: null, skipped: false, deferred: true, reason: 'needs-context' as const, note: 'why?' },
            ],
            submittedAt: '2026-06-24T00:00:00.000Z',
        };
        await store.addProcess(makeProcess('meta-ask-user-answer', {
            pendingAskUserAnswer: answer as AIProcess['pendingAskUserAnswer'],
        }));

        const stored = await store.getProcess('meta-ask-user-answer');
        expect(stored!.pendingAskUserAnswer).toEqual(answer);

        // Setting pendingAskUserAnswer alongside other metadata updates must not drop it.
        await store.updateProcess('meta-ask-user-answer', { metadata: { type: 'chat', mode: 'ask' } });
        const afterMeta = await store.getProcess('meta-ask-user-answer');
        expect(afterMeta!.pendingAskUserAnswer).toEqual(answer);

        await store.updateProcess('meta-ask-user-answer', { pendingAskUserAnswer: undefined });
        const cleared = await store.getProcess('meta-ask-user-answer');
        expect(cleared!.pendingAskUserAnswer).toBeUndefined();
    });
});

// ============================================================================
// Concurrent addProcess
// ============================================================================

describe('SqliteProcessStore — Concurrent operations', () => {
    it('10 rapid concurrent addProcess calls to the same workspace all succeed', async () => {
        const n = 10;
        await Promise.all(
            Array.from({ length: n }, (_, i) =>
                store.addProcess(makeProcess(`conc-${i}`, { metadata: { type: 'ai', workspaceId: 'ws-conc' } }))
            )
        );

        const all = await store.getAllProcesses({ workspaceId: 'ws-conc' });
        expect(all).toHaveLength(n);
        const ids = all.map(p => p.id).sort();
        expect(ids).toEqual(Array.from({ length: n }, (_, i) => `conc-${i}`).sort());
    });
});

describe('SqliteProcessStore — lastEventAt', () => {
    it('addProcess sets lastEventAt to startTime when not explicitly provided', async () => {
        const startTime = new Date('2026-01-15T10:00:00Z');
        await store.addProcess(makeProcess('p-lea-1', { startTime }));

        const result = await store.getProcess('p-lea-1');
        expect(result).toBeDefined();
        expect(result!.lastEventAt).toBeInstanceOf(Date);
        expect(result!.lastEventAt!.toISOString()).toBe(startTime.toISOString());
    });

    it('addProcess preserves explicit lastEventAt if provided', async () => {
        const startTime = new Date('2026-01-15T10:00:00Z');
        const lastEventAt = new Date('2026-01-15T12:00:00Z');
        await store.addProcess(makeProcess('p-lea-2', { startTime, lastEventAt }));

        const result = await store.getProcess('p-lea-2');
        expect(result!.lastEventAt!.toISOString()).toBe(lastEventAt.toISOString());
    });

    it('appendConversationTurn updates lastEventAt to a time after the original startTime', async () => {
        const startTime = new Date('2026-01-15T10:00:00Z');
        await store.addProcess(makeProcess('p-lea-3', { startTime }));

        await store.appendConversationTurn('p-lea-3', (idx) => makeTurn(idx, {
            role: 'assistant',
            content: 'Hello!',
        }));

        const result = await store.getProcess('p-lea-3');
        expect(result).toBeDefined();
        expect(result!.lastEventAt).toBeInstanceOf(Date);
        // lastEventAt should be updated to a time >= startTime (in practice it will be "now")
        expect(result!.lastEventAt!.getTime()).toBeGreaterThan(startTime.getTime());
    });

    it('getProcessSummaries includes lastEventAt in the entries', async () => {
        const startTime = new Date('2026-01-15T10:00:00Z');
        await store.addProcess(makeProcess('p-lea-4', { startTime }));

        const { entries } = await store.getProcessSummaries({ workspaceId: 'ws-test' });
        const entry = entries.find(e => e.id === 'p-lea-4');
        expect(entry).toBeDefined();
        expect(entry!.lastEventAt).toBeDefined();
        expect(entry!.lastEventAt).toBe(startTime.toISOString());
    });

    it('getAllProcesses returns lastEventAt on each process', async () => {
        await store.addProcess(makeProcess('p-lea-5', {
            startTime: new Date('2026-01-15T10:00:00Z'),
        }));

        const all = await store.getAllProcesses({ workspaceId: 'ws-test' });
        const proc = all.find(p => p.id === 'p-lea-5');
        expect(proc).toBeDefined();
        expect(proc!.lastEventAt).toBeInstanceOf(Date);
    });

    it('processes with follow-up (appendConversationTurn) sort before older processes', async () => {
        // Create two processes: older one gets a follow-up
        await store.addProcess(makeProcess('p-old', {
            startTime: new Date('2026-01-15T08:00:00Z'),
        }));
        await store.addProcess(makeProcess('p-new', {
            startTime: new Date('2026-01-15T09:00:00Z'),
        }));

        // Append a turn to p-old (updating its lastEventAt to "now")
        await store.appendConversationTurn('p-old', (idx) => makeTurn(idx, {
            role: 'assistant',
            content: 'Follow-up response',
        }));

        // Query all — p-old should now come first (ORDER BY last_event_at DESC)
        const all = await store.getAllProcesses({ workspaceId: 'ws-test' });
        expect(all[0].id).toBe('p-old');
        expect(all[1].id).toBe('p-new');
    });

    it('lastEventAt round-trips through addProcess + getProcess', async () => {
        const ts = new Date('2026-03-01T15:30:00.000Z');
        await store.addProcess(makeProcess('p-lea-rt', {
            startTime: ts,
            lastEventAt: ts,
        }));

        const result = await store.getProcess('p-lea-rt');
        expect(result!.lastEventAt!.toISOString()).toBe(ts.toISOString());
    });
});

// ============================================================================
// searchConversations (FTS5)
// ============================================================================

describe('SqliteProcessStore — searchConversations', () => {
    async function seedProcess(
        id: string,
        turns: Array<{ role: string; content: string }>,
        overrides?: Partial<AIProcess>
    ) {
        await store.addProcess(makeProcess(id, overrides));
        for (let i = 0; i < turns.length; i++) {
            await store.appendConversationTurn(id, (idx) => makeTurn(idx, {
                role: turns[i].role,
                content: turns[i].content,
            }));
        }
        if (overrides?.lastEventAt) {
            store.getDatabase()
                .prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
                .run(overrides.lastEventAt.toISOString(), id);
        }
    }

    it('returns matching turns with correct processId, snippet, and rank', async () => {
        await seedProcess('p-search-1', [
            { role: 'user', content: 'How do I configure webpack?' },
            { role: 'assistant', content: 'You can create a webpack.config.js file.' },
        ]);

        const { results, total } = await store.searchConversations('webpack');
        expect(total).toBe(2);
        expect(results).toHaveLength(2);
        expect(results[0].processId).toBe('p-search-1');
        expect(results[0].snippet).toContain('<mark>');
        expect(typeof results[0].rank).toBe('number');
    });

    it('results include process-level metadata', async () => {
        await seedProcess('p-meta-1', [
            { role: 'user', content: 'alpha beta gamma' },
        ], { type: 'code-review', status: 'completed', startTime: new Date('2026-02-01T12:00:00Z') });

        const { results } = await store.searchConversations('alpha');
        expect(results).toHaveLength(1);
        const r = results[0];
        expect(r.processId).toBe('p-meta-1');
        expect(r.processStatus).toBe('completed');
        expect(r.processType).toBe('code-review');
        expect(r.workspaceId).toBe('ws-test');
        expect(r.promptPreview).toBe('test prompt');
        expect(r.startTime).toBe('2026-02-01T12:00:00.000Z');
    });

    it('workspace filter returns only results from the specified workspace', async () => {
        await seedProcess('p-ws-a', [
            { role: 'user', content: 'shared keyword pancake' },
        ], { metadata: { type: 'ai', workspaceId: 'ws-alpha' } });
        await seedProcess('p-ws-b', [
            { role: 'user', content: 'shared keyword pancake' },
        ], { metadata: { type: 'ai', workspaceId: 'ws-beta' } });

        const { results, total } = await store.searchConversations('pancake', { workspaceId: 'ws-alpha' });
        expect(total).toBe(1);
        expect(results).toHaveLength(1);
        expect(results[0].processId).toBe('p-ws-a');
    });

    it('status filter filters by process status', async () => {
        await seedProcess('p-stat-run', [
            { role: 'user', content: 'unique-status-term' },
        ], { status: 'running' });
        await seedProcess('p-stat-done', [
            { role: 'user', content: 'unique-status-term' },
        ], { status: 'completed' });
        await seedProcess('p-stat-fail', [
            { role: 'user', content: 'unique-status-term' },
        ], { status: 'failed' });

        const { results, total } = await store.searchConversations('unique-status-term', {
            status: ['completed', 'failed'],
        });
        expect(total).toBe(2);
        const ids = results.map(r => r.processId).sort();
        expect(ids).toEqual(['p-stat-done', 'p-stat-fail']);
    });

    it('combined filters work correctly', async () => {
        await seedProcess('p-combo-1', [
            { role: 'user', content: 'combo-term zeta' },
        ], { status: 'completed', type: 'code-review', metadata: { type: 'code-review', workspaceId: 'ws-combo' } });
        await seedProcess('p-combo-2', [
            { role: 'user', content: 'combo-term zeta' },
        ], { status: 'running', type: 'code-review', metadata: { type: 'code-review', workspaceId: 'ws-combo' } });
        await seedProcess('p-combo-3', [
            { role: 'user', content: 'combo-term zeta' },
        ], { status: 'completed', type: 'ai', metadata: { type: 'ai', workspaceId: 'ws-other' } });

        const { results, total } = await store.searchConversations('combo-term', {
            workspaceId: 'ws-combo',
            status: 'completed',
            type: 'code-review',
        });
        expect(total).toBe(1);
        expect(results[0].processId).toBe('p-combo-1');
    });

    it('pagination: limit/offset respected, total count is pre-pagination', async () => {
        await seedProcess('p-page', [
            { role: 'user', content: 'paginateword alpha' },
            { role: 'assistant', content: 'paginateword bravo' },
            { role: 'user', content: 'paginateword charlie' },
        ]);

        const page1 = await store.searchConversations('paginateword', { limit: 2, offset: 0 });
        expect(page1.total).toBe(3);
        expect(page1.results).toHaveLength(2);

        const page2 = await store.searchConversations('paginateword', { limit: 2, offset: 2 });
        expect(page2.total).toBe(3);
        expect(page2.results).toHaveLength(1);
    });

    it('empty query returns empty results without error', async () => {
        await seedProcess('p-empty-q', [
            { role: 'user', content: 'some content here' },
        ]);

        const { results, total } = await store.searchConversations('');
        expect(total).toBe(0);
        expect(results).toEqual([]);
    });

    it('whitespace-only query returns empty results', async () => {
        const { results, total } = await store.searchConversations('   ');
        expect(total).toBe(0);
        expect(results).toEqual([]);
    });

    it('malformed FTS5 query does not throw (graceful degradation)', async () => {
        await seedProcess('p-malformed', [
            { role: 'user', content: 'test content' },
        ]);

        // These should not throw; sanitizer strips special chars
        const r1 = await store.searchConversations('test*^:');
        // After sanitization this becomes just "test"
        expect(r1.total).toBeGreaterThanOrEqual(1);

        const r2 = await store.searchConversations('"unclosed phrase');
        expect(r2.total).toBeGreaterThanOrEqual(0);
    });

    it('BM25 ranking: more relevant results appear first', async () => {
        // p-rank-a mentions "typescript" once
        await seedProcess('p-rank-a', [
            { role: 'user', content: 'I like typescript' },
        ]);
        // p-rank-b mentions "typescript" many times — should be more relevant
        await seedProcess('p-rank-b', [
            { role: 'user', content: 'typescript typescript typescript compiler typescript config typescript tips' },
        ]);

        const { results } = await store.searchConversations('typescript');
        expect(results.length).toBeGreaterThanOrEqual(2);
        // The turn with more occurrences should have a better (lower) rank
        const rankA = results.find(r => r.processId === 'p-rank-a')!.rank;
        const rankB = results.find(r => r.processId === 'p-rank-b')!.rank;
        expect(rankB).toBeLessThan(rankA);
    });

    it('matches across multiple turns in the same process return multiple results', async () => {
        await seedProcess('p-multi-turn', [
            { role: 'user', content: 'pineapple question' },
            { role: 'assistant', content: 'pineapple answer' },
            { role: 'user', content: 'no match here' },
        ]);

        const { results, total } = await store.searchConversations('pineapple');
        expect(total).toBe(2);
        expect(results).toHaveLength(2);
        const turnIndices = results.map(r => r.turnIndex).sort();
        expect(turnIndices).toEqual([0, 1]);
    });

    it('no results for non-matching queries', async () => {
        await seedProcess('p-no-match', [
            { role: 'user', content: 'the quick brown fox' },
        ]);

        const { results, total } = await store.searchConversations('xylophone');
        expect(total).toBe(0);
        expect(results).toEqual([]);
    });

    it('since filter restricts to processes active after the given date', async () => {
        await seedProcess('p-old', [
            { role: 'user', content: 'temporal-keyword' },
        ], {
            startTime: new Date('2025-01-01T00:00:00Z'),
            lastEventAt: new Date('2025-01-01T00:00:00Z'),
        });
        await seedProcess('p-recent', [
            { role: 'user', content: 'temporal-keyword' },
        ], {
            startTime: new Date('2026-06-01T00:00:00Z'),
            lastEventAt: new Date('2026-06-01T00:00:00Z'),
        });

        const { results, total } = await store.searchConversations('temporal-keyword', {
            since: new Date('2026-01-01T00:00:00Z'),
        });
        expect(total).toBe(1);
        expect(results[0].processId).toBe('p-recent');
    });

    it('since filter includes older processes with recent activity', async () => {
        await seedProcess('p-active-old', [
            { role: 'user', content: 'activity-window-keyword' },
        ], {
            startTime: new Date('2025-01-01T00:00:00Z'),
            lastEventAt: new Date('2026-06-01T00:00:00Z'),
        });

        const { results, total } = await store.searchConversations('activity-window-keyword', {
            since: new Date('2026-01-01T00:00:00Z'),
        });

        expect(total).toBe(1);
        expect(results[0].processId).toBe('p-active-old');
    });

    it('until filter is an exclusive activity upper bound', async () => {
        await seedProcess('p-before', [
            { role: 'user', content: 'until-window-keyword' },
        ], {
            startTime: new Date('2026-04-29T12:00:00Z'),
            lastEventAt: new Date('2026-04-29T23:59:59Z'),
        });
        await seedProcess('p-at-boundary', [
            { role: 'user', content: 'until-window-keyword' },
        ], {
            startTime: new Date('2026-04-29T12:00:00Z'),
            lastEventAt: new Date('2026-04-30T00:00:00Z'),
        });

        const { results, total } = await store.searchConversations('until-window-keyword', {
            until: new Date('2026-04-30T00:00:00Z'),
        });

        expect(total).toBe(1);
        expect(results[0].processId).toBe('p-before');
    });

    it('does not return results from archived processes', async () => {
        await store.addProcess(makeProcess('p-archived', {
            status: 'completed',
        }));
        await store.appendConversationTurn('p-archived', (idx) => makeTurn(idx, {
            role: 'user', content: 'archived-unique-term',
        }));
        // Archive the process directly via DB (archived is an internal column, not on AIProcess)
        store.getDatabase().prepare('UPDATE processes SET archived = 1 WHERE id = ?').run('p-archived');

        const { results, total } = await store.searchConversations('archived-unique-term');
        expect(total).toBe(0);
        expect(results).toEqual([]);
    });

    it('processTitle is included when the process has a title', async () => {
        await seedProcess('p-titled', [
            { role: 'user', content: 'titled-search-term' },
        ], { title: 'My Custom Title' });

        const { results } = await store.searchConversations('titled-search-term');
        expect(results).toHaveLength(1);
        expect(results[0].processTitle).toBe('My Custom Title');
    });
});

// ============================================================================
// Pin & Archive Operations
// ============================================================================

describe('SqliteProcessStore — Pin & Archive', () => {
    it('pinProcess sets pinned_at and unpinProcess clears it', async () => {
        await store.addProcess(makeProcess('p-pin', { status: 'completed' }));

        const ts = '2026-04-01T12:00:00.000Z';
        store.pinProcess('p-pin', ts);

        const proc = await store.getProcess('p-pin');
        expect(proc!.pinnedAt).toBe(ts);

        store.unpinProcess('p-pin');
        const proc2 = await store.getProcess('p-pin');
        expect(proc2!.pinnedAt).toBeUndefined();
    });

    it('archiveProcess / unarchiveProcess toggle archived flag', async () => {
        await store.addProcess(makeProcess('p-arc', { status: 'completed' }));

        store.archiveProcess('p-arc');
        const proc = await store.getProcess('p-arc');
        expect(proc!.archived).toBe(true);

        store.unarchiveProcess('p-arc');
        const proc2 = await store.getProcess('p-arc');
        // intToBool(0) returns undefined (convention: false ↔ undefined)
        expect(proc2!.archived).toBeUndefined();
    });

    it('archiveProcesses handles batch archive', async () => {
        await store.addProcess(makeProcess('b1', { status: 'completed' }));
        await store.addProcess(makeProcess('b2', { status: 'completed' }));
        await store.addProcess(makeProcess('b3', { status: 'completed' }));

        store.archiveProcesses(['b1', 'b2']);

        const p1 = await store.getProcess('b1');
        const p2 = await store.getProcess('b2');
        const p3 = await store.getProcess('b3');
        expect(p1!.archived).toBe(true);
        expect(p2!.archived).toBe(true);
        expect(p3!.archived).toBeUndefined();
    });

    it('unarchiveProcesses handles batch unarchive', async () => {
        await store.addProcess(makeProcess('u1', { status: 'completed' }));
        await store.addProcess(makeProcess('u2', { status: 'completed' }));
        store.archiveProcesses(['u1', 'u2']);

        store.unarchiveProcesses(['u1', 'u2']);

        const p1 = await store.getProcess('u1');
        const p2 = await store.getProcess('u2');
        expect(p1!.archived).toBeUndefined();
        expect(p2!.archived).toBeUndefined();
    });

    it('getPinnedProcesses returns only pinned processes for workspace', async () => {
        await store.addProcess(makeProcess('pp1', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws1' } }));
        await store.addProcess(makeProcess('pp2', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws1' } }));
        await store.addProcess(makeProcess('pp3', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws2' } }));

        store.pinProcess('pp1', '2026-04-01T12:00:00.000Z');
        store.pinProcess('pp2', '2026-04-02T12:00:00.000Z');
        store.pinProcess('pp3', '2026-04-03T12:00:00.000Z');

        const pinned = store.getPinnedProcesses('ws1');
        expect(pinned).toHaveLength(2);
        // Should be ordered newest-first
        expect(pinned[0].id).toBe('pp2');
        expect(pinned[1].id).toBe('pp1');
        expect(pinned[0].pinnedAt).toBe('2026-04-02T12:00:00.000Z');
    });

    it('getProcessSummaries includes pinnedAt and archived', async () => {
        await store.addProcess(makeProcess('sum1', { status: 'completed' }));
        store.pinProcess('sum1', '2026-04-01T12:00:00.000Z');
        store.archiveProcess('sum1');

        const { entries } = await store.getProcessSummaries({ workspaceId: 'ws-test' });
        const entry = entries.find(e => e.id === 'sum1');
        expect(entry).toBeDefined();
        expect(entry!.pinnedAt).toBe('2026-04-01T12:00:00.000Z');
        expect(entry!.archived).toBe(true);
    });

    it('pinnedAt round-trips through processToRow/rowToProcess', async () => {
        const p = makeProcess('rt1', { status: 'completed', pinnedAt: '2026-04-01T00:00:00.000Z' });
        await store.addProcess(p);

        const result = await store.getProcess('rt1');
        expect(result!.pinnedAt).toBe('2026-04-01T00:00:00.000Z');
    });

    it('archiveProcesses with empty array is a no-op', () => {
        // Should not throw
        store.archiveProcesses([]);
    });
});

// ============================================================================
// getProcessCount
// ============================================================================

describe('SqliteProcessStore — getProcessCount', () => {
    it('returns 0 for empty database', async () => {
        expect(await store.getProcessCount()).toBe(0);
    });

    it('returns total count without filter', async () => {
        await store.addProcess(makeProcess('c1'));
        await store.addProcess(makeProcess('c2'));
        await store.addProcess(makeProcess('c3'));
        expect(await store.getProcessCount()).toBe(3);
    });

    it('filters by workspaceId', async () => {
        await store.addProcess(makeProcess('c1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c2', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c3', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        expect(await store.getProcessCount({ workspaceId: 'ws-a' })).toBe(2);
        expect(await store.getProcessCount({ workspaceId: 'ws-b' })).toBe(1);
        expect(await store.getProcessCount({ workspaceId: 'ws-none' })).toBe(0);
    });

    it('filters by status', async () => {
        await store.addProcess(makeProcess('c1', { status: 'running' }));
        await store.addProcess(makeProcess('c2', { status: 'completed' }));
        await store.addProcess(makeProcess('c3', { status: 'failed' }));

        expect(await store.getProcessCount({ status: 'running' })).toBe(1);
        expect(await store.getProcessCount({ status: ['running', 'failed'] })).toBe(2);
    });

    it('supports combined filters', async () => {
        await store.addProcess(makeProcess('c1', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c2', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c3', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        expect(await store.getProcessCount({ workspaceId: 'ws-a', status: 'running' })).toBe(1);
    });

    it('agrees with getAllProcesses().length', async () => {
        await store.addProcess(makeProcess('c1', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c2', { status: 'completed', metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('c3', { status: 'running', metadata: { type: 'ai', workspaceId: 'ws-b' } }));

        const filter = { workspaceId: 'ws-a' };
        const count = await store.getProcessCount(filter);
        const all = await store.getAllProcesses(filter);
        expect(count).toBe(all.length);
    });
});

// ============================================================================
// getProcessIds
// ============================================================================

describe('SqliteProcessStore — getProcessIds', () => {
    it('returns empty array for empty database', async () => {
        const ids = await store.getProcessIds();
        expect(ids).toEqual([]);
    });

    it('returns all process IDs without filter', async () => {
        await store.addProcess(makeProcess('p1'));
        await store.addProcess(makeProcess('p2'));
        await store.addProcess(makeProcess('p3'));

        const ids = await store.getProcessIds();
        expect(ids).toHaveLength(3);
        expect(new Set(ids)).toEqual(new Set(['p1', 'p2', 'p3']));
    });

    it('filters by workspaceId', async () => {
        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        await store.addProcess(makeProcess('p2', { metadata: { type: 'ai', workspaceId: 'ws-b' } }));
        await store.addProcess(makeProcess('p3', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));

        const ids = await store.getProcessIds({ workspaceId: 'ws-a' });
        expect(ids).toHaveLength(2);
        expect(new Set(ids)).toEqual(new Set(['p1', 'p3']));
    });

    it('filters by status', async () => {
        await store.addProcess(makeProcess('p1', { status: 'running' }));
        await store.addProcess(makeProcess('p2', { status: 'completed' }));
        await store.addProcess(makeProcess('p3', { status: 'failed' }));

        const ids = await store.getProcessIds({ status: 'completed' });
        expect(ids).toEqual(['p2']);
    });

    it('filters by status array', async () => {
        await store.addProcess(makeProcess('p1', { status: 'running' }));
        await store.addProcess(makeProcess('p2', { status: 'completed' }));
        await store.addProcess(makeProcess('p3', { status: 'failed' }));

        const ids = await store.getProcessIds({ status: ['running', 'failed'] });
        expect(ids).toHaveLength(2);
        expect(new Set(ids)).toEqual(new Set(['p1', 'p3']));
    });

    it('returns only IDs — no heavy deserialization', async () => {
        await store.addProcess(makeProcess('p1'));
        const ids = await store.getProcessIds();
        expect(ids).toEqual(['p1']);
        expect(typeof ids[0]).toBe('string');
    });

    it('agrees with getProcessSummaries on IDs', async () => {
        await store.addProcess(makeProcess('p1', { status: 'running' }));
        await store.addProcess(makeProcess('p2', { status: 'completed' }));

        const ids = await store.getProcessIds();
        const { entries } = await store.getProcessSummaries();
        const summaryIds = entries.map(e => e.id);
        expect(new Set(ids)).toEqual(new Set(summaryIds));
    });
});

// ============================================================================
// getProcessBySdkSessionId
// ============================================================================

describe('SqliteProcessStore — getProcessBySdkSessionId', () => {
    it('returns undefined when no process matches', () => {
        const result = store.getProcessBySdkSessionId('nonexistent-session');
        expect(result).toBeUndefined();
    });

    it('returns the matching process with conversation turns', async () => {
        const p = makeProcess('sdk1', { sdkSessionId: 'session-abc' });
        await store.addProcess(p);
        await store.appendConversationTurn('sdk1', (idx) => makeTurn(idx, { content: 'hello' }));

        const result = store.getProcessBySdkSessionId('session-abc');
        expect(result).toBeDefined();
        expect(result!.id).toBe('sdk1');
        expect(result!.sdkSessionId).toBe('session-abc');
        expect(result!.conversationTurns).toHaveLength(1);
        expect(result!.conversationTurns![0].content).toBe('hello');
    });

    it('returns the first match when multiple processes exist', async () => {
        await store.addProcess(makeProcess('sdk1', { sdkSessionId: 'session-xyz' }));
        await store.addProcess(makeProcess('sdk2', { sdkSessionId: 'session-other' }));

        const result = store.getProcessBySdkSessionId('session-xyz');
        expect(result).toBeDefined();
        expect(result!.id).toBe('sdk1');
    });

    it('does not match by process id', async () => {
        await store.addProcess(makeProcess('sdk1', { sdkSessionId: 'real-session' }));

        const result = store.getProcessBySdkSessionId('sdk1');
        expect(result).toBeUndefined();
    });
});
