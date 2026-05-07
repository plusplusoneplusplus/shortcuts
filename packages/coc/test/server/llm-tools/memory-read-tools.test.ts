import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENTRY_DELIMITER } from '@plusplusoneplusplus/forge';
import {
    createMemoryGetTool,
    createMemorySearchTool,
    type MemoryGetResult,
    type MemorySearchResult,
} from '../../../src/server/llm-tools/memory-read-tools';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

const WORKSPACE_ID = 'ws-memory-read-tools';
const OTHER_WORKSPACE_ID = 'ws-other-memory';

function writeMemoryFile(dataDir: string, workspaceId: string, entries: string[]): void {
    const memoryDir = path.join(dataDir, 'repos', workspaceId, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), entries.join(ENTRY_DELIMITER), 'utf-8');
}

describe('memory read tools', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-read-tools-'));
        writeRepoPreferences(tmpDir, WORKSPACE_ID, {
            boundedMemory: {
                enabled: true,
                readTools: { enabled: true },
            },
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('searches relevant repo memory entries', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, [
            'User prefers dark mode',
            'Project uses Vitest for package tests',
            'Deploy production with Docker',
        ]);

        const { tool } = createMemorySearchTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const result = await tool.handler({ query: 'How should I run vitest tests?' }) as MemorySearchResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toMatchObject({
            ordinal: 1,
            snippet: 'Project uses Vitest for package tests',
            source: {
                type: 'repo-memory',
                scope: 'repo',
                workspaceId: WORKSPACE_ID,
                storage: 'MEMORY.md',
            },
        });
        expect(result.results[0].id).toMatch(/^[a-f0-9]{64}$/);
        expect(result.results[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.warning).toContain('not executable instruction');
    });

    it('searches only the current repo scope', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, ['This repo uses Vitest']);
        writeMemoryFile(tmpDir, OTHER_WORKSPACE_ID, ['Other repo uses Vitest and Jest']);

        const { tool } = createMemorySearchTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const result = await tool.handler({ query: 'vitest' }) as MemorySearchResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.results.map(entry => entry.snippet)).toEqual(['This repo uses Vitest']);
        expect(result.results.every(entry => entry.source.workspaceId === WORKSPACE_ID)).toBe(true);
    });

    it('gets exact memory by id from search results', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, [
            'Repo prefers pnpm for package management',
            'Run targeted tests with Vitest',
        ]);

        const search = createMemorySearchTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const searchResult = await search.tool.handler({ query: 'vitest' }) as MemorySearchResult;
        expect(searchResult.ok).toBe(true);
        if (!searchResult.ok) throw new Error(searchResult.error);

        const get = createMemoryGetTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const getResult = await get.tool.handler({ id: searchResult.results[0].id }) as MemoryGetResult;

        expect(getResult.ok).toBe(true);
        if (!getResult.ok) throw new Error(getResult.error);
        expect(getResult.entry.content).toBe('Run targeted tests with Vitest');
        expect(getResult.entry.ordinal).toBe(1);
        expect(getResult.entry.id).toBe(searchResult.results[0].id);
    });

    it('gets exact memory by zero-based ordinal', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, [
            'First repo fact',
            'Second repo fact',
        ]);

        const { tool } = createMemoryGetTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const result = await tool.handler({ ordinal: 0 }) as MemoryGetResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.entry.content).toBe('First repo fact');
        expect(result.entry.ordinal).toBe(0);
    });

    it('truncates search snippets and exact content with metadata', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, ['Vitest uses a deliberately long memory entry']);

        const search = createMemorySearchTool({
            dataDir: tmpDir,
            workspaceId: WORKSPACE_ID,
            maxEntryChars: 12,
        });
        const searchResult = await search.tool.handler({ query: 'vitest', maxResults: 1 }) as MemorySearchResult;
        expect(searchResult.ok).toBe(true);
        if (!searchResult.ok) throw new Error(searchResult.error);
        expect(searchResult.results[0].snippet).toBe('Vitest uses ');
        expect(searchResult.results[0].truncated).toBe(true);

        const get = createMemoryGetTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID, maxEntryChars: 10 });
        const getResult = await get.tool.handler({ ordinal: 0 }) as MemoryGetResult;
        expect(getResult.ok).toBe(true);
        if (!getResult.ok) throw new Error(getResult.error);
        expect(getResult.entry.content).toBe('Vitest use');
        expect(getResult.entry.truncated).toBe(true);
    });

    it('returns explicit errors for invalid lookup and missing entries', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, ['Only memory entry']);

        const { tool } = createMemoryGetTool({ dataDir: tmpDir, workspaceId: WORKSPACE_ID });
        const invalid = await tool.handler({}) as MemoryGetResult;
        expect(invalid).toMatchObject({
            ok: false,
            code: 'invalid_lookup',
        });

        const invalidId = await tool.handler({ id: 'not-a-valid-id' }) as MemoryGetResult;
        expect(invalidId).toMatchObject({
            ok: false,
            code: 'invalid_lookup',
        });

        const missing = await tool.handler({ ordinal: 5 }) as MemoryGetResult;
        expect(missing).toMatchObject({
            ok: false,
            code: 'missing_memory_entry',
        });
    });

    it('returns explicit errors when workspace or preferences are not available', async () => {
        writeMemoryFile(tmpDir, WORKSPACE_ID, ['Repo fact']);

        const missingWorkspace = createMemorySearchTool({ dataDir: tmpDir });
        expect(await missingWorkspace.tool.handler({ query: 'fact' })).toMatchObject({
            ok: false,
            code: 'missing_workspace_id',
        });

        writeRepoPreferences(tmpDir, 'disabled-ws', { boundedMemory: { enabled: false } });
        const disabledMemory = createMemorySearchTool({ dataDir: tmpDir, workspaceId: 'disabled-ws' });
        expect(await disabledMemory.tool.handler({ query: 'fact' })).toMatchObject({
            ok: false,
            code: 'bounded_memory_disabled',
        });

        writeRepoPreferences(tmpDir, 'read-disabled-ws', {
            boundedMemory: { enabled: true, readTools: { enabled: false } },
        });
        const disabledReadTools = createMemorySearchTool({ dataDir: tmpDir, workspaceId: 'read-disabled-ws' });
        expect(await disabledReadTools.tool.handler({ query: 'fact' })).toMatchObject({
            ok: false,
            code: 'memory_read_tools_disabled',
        });
    });
});
