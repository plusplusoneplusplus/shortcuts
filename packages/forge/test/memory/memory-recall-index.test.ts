import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { ENTRY_DELIMITER } from '../../src/memory/bounded-memory-types';
import { MemoryRecallIndex } from '../../src/memory/memory-recall-index';

describe('MemoryRecallIndex', () => {
    let tmpDir: string;
    let dbPath: string;
    let index: MemoryRecallIndex;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-recall-'));
        dbPath = path.join(tmpDir, 'recall.db');
        index = new MemoryRecallIndex({ dbPath });
    });

    afterEach(async () => {
        index.close();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('ranks relevant memory entries above unrelated entries', () => {
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: [
                'User prefers dark mode',
                'Project uses Vitest for package tests',
                'Deploy production with Docker',
            ],
        });

        const recalled = index.recall({
            namespace: 'ws-test',
            query: 'How should I run vitest tests?',
        });

        expect(recalled.map(entry => entry.content)).toEqual([
            'Project uses Vitest for package tests',
        ]);
    });

    it('always includes protected entries even when they are unrelated', () => {
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: ['Project uses Vitest for package tests'],
        });
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'system',
            entries: ['Always prefer Windows-style paths'],
            isProtected: () => true,
        });

        const recalled = index.recall({
            namespace: 'ws-test',
            query: 'vitest package tests',
        });

        expect(recalled.map(entry => entry.content)).toEqual([
            'Always prefer Windows-style paths',
            'Project uses Vitest for package tests',
        ]);
        expect(recalled[0].protected).toBe(true);
    });

    it('respects the character budget for ranked entries while keeping protected entries', () => {
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: [
                'alpha short',
                'alpha second entry that does not fit',
            ],
        });
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'system',
            entries: ['protected system memory that exceeds the budget'],
            isProtected: () => true,
        });

        const recalled = index.recall({
            namespace: 'ws-test',
            query: 'alpha',
            charBudget: `protected system memory that exceeds the budget${ENTRY_DELIMITER}alpha short`.length,
        });

        expect(recalled.map(entry => entry.content)).toEqual([
            'protected system memory that exceeds the budget',
            'alpha short',
        ]);
    });

    it('records recall events and preserves counts across index resync', () => {
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: ['Project uses Vitest for package tests'],
        });

        index.recall({
            namespace: 'ws-test',
            query: 'vitest tests',
            recalledAt: '2026-05-03T10:00:00.000Z',
        });
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: ['Project uses Vitest for package tests'],
        });
        index.recall({
            namespace: 'ws-test',
            query: 'vitest tests',
            recalledAt: '2026-05-03T10:01:00.000Z',
        });

        const db = new Database(dbPath, { readonly: true });
        try {
            const entry = db.prepare(`
                SELECT recall_count, last_recalled_at, last_query_hash
                FROM memory_recall_entries
            `).get() as { recall_count: number; last_recalled_at: string; last_query_hash: string };
            const eventCount = (db.prepare(`
                SELECT COUNT(*) AS count FROM memory_recall_events
            `).get() as { count: number }).count;

            expect(entry.recall_count).toBe(2);
            expect(entry.last_recalled_at).toBe('2026-05-03T10:01:00.000Z');
            expect(entry.last_query_hash).toMatch(/^[a-f0-9]{64}$/);
            expect(eventCount).toBe(2);
        } finally {
            db.close();
        }
    });

    it('keeps repo and system scopes separated', () => {
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'repo',
            entries: ['Repo uses Vitest'],
        });
        index.syncEntries({
            namespace: 'ws-test',
            scope: 'system',
            entries: ['System uses Vitest'],
            isProtected: () => true,
        });

        const recalled = index.recall({
            namespace: 'ws-test',
            query: 'vitest',
            scopes: ['repo'],
        });

        expect(recalled.map(entry => entry.content)).toEqual(['Repo uses Vitest']);
        expect(recalled.every(entry => entry.scope === 'repo')).toBe(true);
    });
});
