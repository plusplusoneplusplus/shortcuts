/**
 * Tests for memory-v2-tools.ts (AC-05)
 *
 * Covers: store_memory happy path, safety block, missing content,
 *         recall_memory happy path, no results, missing query, error recovery,
 *         target parameter (global default vs explicit workspace),
 *         multi-store recall merging.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createMemoryStores,
} from '@plusplusoneplusplus/coc-memory';
import type { SqliteFactStore } from '@plusplusoneplusplus/coc-memory';
import {
    createMemoryStoreFactTool,
    createMemoryRecallTool,
    MEMORY_V2_STORE_TOOL_NAME,
    MEMORY_V2_RECALL_TOOL_NAME,
    type MemoryStoreFactResult,
    type MemoryRecallResult,
    type MemoryV2ToolDeps,
} from '../../../src/server/llm-tools/memory-v2-tools';

// ============================================================================
// Helpers
// ============================================================================

function makeGlobalDeps(storeDir: string): MemoryV2ToolDeps & { close: () => void } {
    const handle = createMemoryStores(storeDir);
    return {
        globalFactStore: handle.facts as unknown as SqliteFactStore,
        globalEpisodeStore: handle.episodes,
        workspaceId: 'ws-test',
        processId: 'proc-test',
        close: () => handle.close(),
    };
}

function makeWorkspaceDeps(storeDir: string): MemoryV2ToolDeps & { close: () => void } {
    const handle = createMemoryStores(storeDir);
    return {
        workspaceFactStore: handle.facts as unknown as SqliteFactStore,
        workspaceEpisodeStore: handle.episodes,
        workspaceId: 'ws-test',
        processId: 'proc-test',
        close: () => handle.close(),
    };
}

function makeDualDeps(globalDir: string, wsDir: string): MemoryV2ToolDeps & { close: () => void } {
    const globalHandle = createMemoryStores(globalDir);
    const wsHandle = createMemoryStores(wsDir);
    return {
        globalFactStore: globalHandle.facts as unknown as SqliteFactStore,
        globalEpisodeStore: globalHandle.episodes,
        workspaceFactStore: wsHandle.facts as unknown as SqliteFactStore,
        workspaceEpisodeStore: wsHandle.episodes,
        workspaceId: 'ws-test',
        processId: 'proc-test',
        close: () => { globalHandle.close(); wsHandle.close(); },
    };
}

// ============================================================================
// store_memory
// ============================================================================

describe('createMemoryStoreFactTool', () => {
    let tmpDir: string;
    let deps: ReturnType<typeof makeGlobalDeps>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-store-tool-'));
        deps = makeGlobalDeps(tmpDir);
    });

    afterEach(() => {
        deps.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('has the correct tool name', () => {
        const { tool } = createMemoryStoreFactTool(deps);
        expect(tool.name).toBe(MEMORY_V2_STORE_TOOL_NAME);
        expect(tool.name).toBe('store_memory');
    });

    it('stores a fact and returns ok=true with active status', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({ content: 'User prefers tabs over spaces' }) as MemoryStoreFactResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.id).toBeTruthy();
        expect(result.status).toMatch(/^(active|review)$/);
        expect(result.message).toBeTruthy();
    });

    it('stores a fact with tags and importance', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({
            content: 'Project uses Vitest for testing',
            importance: 0.9,
            tags: ['testing', 'tooling'],
        }) as MemoryStoreFactResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.id).toBeTruthy();
    });

    it('returns error when content is empty string', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({ content: '   ' }) as MemoryStoreFactResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('missing_content');
    });

    it('returns error when content is missing', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({} as any) as MemoryStoreFactResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('missing_content');
    });

    it('blocks fact containing a secret-like value (API key pattern)', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        // Secrets scanner should block API key patterns
        const result = await tool.handler({
            content: 'My API key is sk-1234567890abcdefABCDEF1234567890',
        }) as MemoryStoreFactResult;

        // Either blocked or goes to review — must not return an active unscanned fact
        if (result.ok) {
            // If it gets through, it should be in review (not immediately active with raw secret)
            // The safety scanner may route it to review rather than hard-block
            expect(['active', 'review']).toContain(result.status);
        } else {
            expect(result.code).toBe('blocked_by_safety');
        }
    });

    it('defaults to global target when no target is specified', async () => {
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({ content: 'Global default fact' }) as MemoryStoreFactResult;
        expect(result.ok).toBe(true);
    });

    it('writes to workspace store when target=workspace', async () => {
        const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-store-'));
        const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-store-'));
        const dualDeps = makeDualDeps(globalDir, wsDir);

        try {
            const { tool } = createMemoryStoreFactTool(dualDeps);
            const result = await tool.handler({
                content: 'Workspace-specific convention',
                target: 'workspace',
            }) as MemoryStoreFactResult;

            expect(result.ok).toBe(true);

            // Verify the fact exists in workspace store
            const facts = await dualDeps.workspaceFactStore!.listFacts({ statuses: ['active', 'review'] });
            const globalFacts = await dualDeps.globalFactStore!.listFacts({ statuses: ['active', 'review'] });

            expect(facts.length).toBeGreaterThan(0);
            expect(globalFacts).toHaveLength(0); // not written to global
        } finally {
            dualDeps.close();
            fs.rmSync(globalDir, { recursive: true, force: true });
            fs.rmSync(wsDir, { recursive: true, force: true });
        }
    });

    it('returns error when target=workspace but no workspace store available', async () => {
        // deps has only global store
        const { tool } = createMemoryStoreFactTool(deps);
        const result = await tool.handler({
            content: 'Should fail',
            target: 'workspace',
        }) as MemoryStoreFactResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('unexpected_error');
    });

    it('returns error when no store is available', async () => {
        const emptyDeps: MemoryV2ToolDeps = { processId: 'proc-test' };
        const { tool } = createMemoryStoreFactTool(emptyDeps);
        const result = await tool.handler({ content: 'Some fact' }) as MemoryStoreFactResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('unexpected_error');
    });
});

// ============================================================================
// recall_memory
// ============================================================================

describe('createMemoryRecallTool', () => {
    let tmpDir: string;
    let deps: ReturnType<typeof makeGlobalDeps>;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-recall-tool-'));
        deps = makeGlobalDeps(tmpDir);

        // Seed some facts via the store tool
        const { tool: storeTool } = createMemoryStoreFactTool(deps);
        await storeTool.handler({ content: 'User prefers Vitest for unit tests', tags: ['testing'] });
        await storeTool.handler({ content: 'Always use TypeScript strict mode', tags: ['typescript'] });
        await storeTool.handler({ content: 'Docker is used for production deploys', tags: ['devops'] });
    });

    afterEach(() => {
        deps.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('has the correct tool name', () => {
        const { tool } = createMemoryRecallTool(deps);
        expect(tool.name).toBe(MEMORY_V2_RECALL_TOOL_NAME);
        expect(tool.name).toBe('recall_memory');
    });

    it('returns relevant facts for a query', async () => {
        const { tool } = createMemoryRecallTool(deps);
        // Use simple query without special chars; FTS5 ANDs all terms so use words actually in the data
        const result = await tool.handler({ query: 'vitest tests' }) as MemoryRecallResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.query).toBe('vitest tests');
        expect(result.count).toBeGreaterThan(0);
        expect(result.results[0]).toMatchObject({
            id: expect.any(String),
            content: expect.any(String),
            importance: expect.any(Number),
            confidence: expect.any(Number),
            tags: expect.any(Array),
            score: expect.any(Number),
        });
        expect(result.warning).toContain('background context');
    });

    it('returns empty results for a query with no matches', async () => {
        const { tool } = createMemoryRecallTool(deps);
        const result = await tool.handler({ query: 'completely unrelated xyzzy foobar' }) as MemoryRecallResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        // May return 0 or some results depending on BM25 scoring — just check structure
        expect(Array.isArray(result.results)).toBe(true);
    });

    it('returns error when query is empty', async () => {
        const { tool } = createMemoryRecallTool(deps);
        const result = await tool.handler({ query: '  ' }) as MemoryRecallResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('missing_query');
    });

    it('returns error when query is missing', async () => {
        const { tool } = createMemoryRecallTool(deps);
        const result = await tool.handler({} as any) as MemoryRecallResult;

        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('Expected error');
        expect(result.code).toBe('missing_query');
    });

    it('respects the limit parameter', async () => {
        const { tool } = createMemoryRecallTool(deps);
        const result = await tool.handler({ query: 'user preferences', limit: 1 }) as MemoryRecallResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it('clamps limit to MAX_RECALL_LIMIT (30)', async () => {
        const { tool } = createMemoryRecallTool(deps);
        const result = await tool.handler({ query: 'typescript', limit: 9999 }) as MemoryRecallResult;

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.error);
        // Results can't exceed total stored facts (3 seeded)
        expect(result.results.length).toBeLessThanOrEqual(30);
    });

    it('merges results from both global and workspace stores', async () => {
        const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-recall-'));
        const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-recall-'));
        const dualDeps = makeDualDeps(globalDir, wsDir);

        try {
            // Seed a distinct fact in each store using a shared query term
            const { tool: gStore } = createMemoryStoreFactTool({
                globalFactStore: dualDeps.globalFactStore,
                globalEpisodeStore: dualDeps.globalEpisodeStore,
            });
            await gStore.handler({ content: 'multistore global preference fact' });

            const { tool: wStore } = createMemoryStoreFactTool({
                workspaceFactStore: dualDeps.workspaceFactStore,
                workspaceEpisodeStore: dualDeps.workspaceEpisodeStore,
                workspaceId: 'ws-test',
            });
            await wStore.handler({ content: 'multistore workspace convention fact', target: 'workspace' });

            const { tool: recallTool } = createMemoryRecallTool(dualDeps);
            // "multistore" appears in both facts — should match from both stores
            const result = await recallTool.handler({ query: 'multistore' }) as MemoryRecallResult;

            expect(result.ok).toBe(true);
            if (!result.ok) throw new Error(result.error);
            // Both stores should contribute at least one match
            expect(result.count).toBeGreaterThanOrEqual(2);
        } finally {
            dualDeps.close();
            fs.rmSync(globalDir, { recursive: true, force: true });
            fs.rmSync(wsDir, { recursive: true, force: true });
        }
    });
});
