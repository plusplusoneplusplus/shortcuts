/**
 * Tests for buildMemoryV2Addon (AC-05)
 *
 * Covers: disabled (neither scope enabled), only-global enabled, only-workspace
 *         enabled, both scopes enabled (dual-scope reading), frozen snapshot,
 *         per-turn recall, missing dataDir/workspaceId → empty addon, dispose.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMemoryStores } from '@plusplusoneplusplus/coc-memory';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences, writePreferences } from '../../../src/server/preferences-handler';
import { MEMORY_V2_STORE_TOOL_NAME, MEMORY_V2_RECALL_TOOL_NAME } from '../../../src/server/llm-tools/memory-v2-tools';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'ws-mem-v2-addon-test';

async function seedFact(storeDir: string, content: string, tags: string[] = []): Promise<void> {
    const handle = createMemoryStores(storeDir);
    try {
        await handle.facts.addFact({
            scope: 'global',
            content,
            importance: 0.8,
            confidence: 0.9,
            status: 'active',
            tags,
            source: 'explicit',
        });
    } finally {
        handle.close();
    }
}

function enableGlobalMemory(dataDir: string, enabled = true): void {
    writePreferences(dataDir, { global: { memoryV2: { enabled } } });
}

function enableWorkspaceMemory(dataDir: string, workspaceId: string, enabled = true): void {
    writeRepoPreferences(dataDir, workspaceId, { memoryV2: { enabled } });
}

// ============================================================================
// Tests
// ============================================================================

describe('buildMemoryV2Addon', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-v2-addon-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // Guard conditions → empty addon
    // -----------------------------------------------------------------------

    it('returns empty addon when dataDir is undefined', async () => {
        const addon = await buildMemoryV2Addon(undefined, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.suffix).toBe('');
        expect(addon.excludedBuiltinTools).toEqual([]);
        addon.dispose(); // safe to call
    });

    it('returns empty addon when workspaceId is undefined', async () => {
        const addon = await buildMemoryV2Addon(tmpDir, undefined);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.suffix).toBe('');
        expect(addon.excludedBuiltinTools).toEqual([]);
    });

    it('returns empty addon when no memory preferences are set', async () => {
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.excludedBuiltinTools).toEqual([]);
    });

    it('returns empty addon when both global and workspace memory are disabled', async () => {
        enableGlobalMemory(tmpDir, false);
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID, false);
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.excludedBuiltinTools).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Only global memory enabled
    // -----------------------------------------------------------------------

    it('returns populated addon when only global memory is enabled', async () => {
        enableGlobalMemory(tmpDir);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, 'test query', 'proc-1');
        try {
            expect(addon.tools).toHaveLength(2);
            const toolNames = addon.tools.map(t => t.name);
            expect(toolNames).toContain(MEMORY_V2_STORE_TOOL_NAME);
            expect(toolNames).toContain(MEMORY_V2_RECALL_TOOL_NAME);
            expect(addon.suffix).toContain('memory');
            // Guidance is wrapped in a named tag with the separator prefix.
            expect(addon.suffix.startsWith('\n\n<memory_tool>\n')).toBe(true);
            expect(addon.suffix.endsWith('\n</memory_tool>')).toBe(true);
            expect(addon.excludedBuiltinTools).toEqual(['vote_memory', 'store_memory']);
        } finally {
            addon.dispose();
        }
    });

    it('includes frozen snapshot block from global store when facts exist', async () => {
        enableGlobalMemory(tmpDir);

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'User prefers tabs over spaces', ['formatting']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeTruthy();
            expect(addon.systemMessageSuffix).toContain('<memory_snapshot>');
            expect(addon.systemMessageSuffix).toContain('User prefers tabs over spaces');
            expect(addon.systemMessageSuffix).toContain('[formatting]');
        } finally {
            addon.dispose();
        }
    });

    it('includes per-turn recall block when query matches a global fact', async () => {
        enableGlobalMemory(tmpDir);

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'Project uses Vitest for unit tests', ['testing']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, 'vitest tests', 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeTruthy();
            expect(addon.systemMessageSuffix).toContain('<memory_snapshot>');
            expect(addon.systemMessageSuffix).toContain('<recalled_memory>');
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Only workspace memory enabled
    // -----------------------------------------------------------------------

    it('returns populated addon when only workspace memory is enabled', async () => {
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.tools).toHaveLength(2);
        } finally {
            addon.dispose();
        }
    });

    it('reads from workspace store when only workspace memory is enabled', async () => {
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);

        const wsDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory');
        await seedFact(wsDir, 'Workspace-only fact', ['scope-test']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toContain('Workspace-only fact');
        } finally {
            addon.dispose();
        }
    });

    it('does not read global facts when only workspace memory is enabled', async () => {
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'Global-only fact', ['global']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            if (addon.systemMessageSuffix) {
                expect(addon.systemMessageSuffix).not.toContain('Global-only fact');
            }
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Both scopes enabled (dual-scope)
    // -----------------------------------------------------------------------

    it('reads from both global and workspace stores when both are enabled', async () => {
        enableGlobalMemory(tmpDir);
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);

        const globalDir = path.join(tmpDir, 'memory', 'global');
        const wsDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory');

        await seedFact(globalDir, 'Global architecture rule', ['arch']);
        await seedFact(wsDir, 'Workspace-specific convention', ['ws']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeTruthy();
            expect(addon.systemMessageSuffix).toContain('Global architecture rule');
            expect(addon.systemMessageSuffix).toContain('Workspace-specific convention');
        } finally {
            addon.dispose();
        }
    });

    it('exposes both stores to tools when both scopes enabled', async () => {
        enableGlobalMemory(tmpDir);
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.tools).toHaveLength(2);
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Misc
    // -----------------------------------------------------------------------

    it('excludedBuiltinTools is ["vote_memory", "store_memory"] when memory V2 is active (global only)', async () => {
        enableGlobalMemory(tmpDir);
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.excludedBuiltinTools).toEqual(['vote_memory', 'store_memory']);
        } finally {
            addon.dispose();
        }
    });

    it('excludedBuiltinTools is ["vote_memory", "store_memory"] when memory V2 is active (workspace only)', async () => {
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.excludedBuiltinTools).toEqual(['vote_memory', 'store_memory']);
        } finally {
            addon.dispose();
        }
    });

    it('excludedBuiltinTools is ["vote_memory", "store_memory"] when both scopes are active', async () => {
        enableGlobalMemory(tmpDir);
        enableWorkspaceMemory(tmpDir, WORKSPACE_ID);
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.excludedBuiltinTools).toEqual(['vote_memory', 'store_memory']);
        } finally {
            addon.dispose();
        }
    });

    it('has no recall block when query is empty string', async () => {
        enableGlobalMemory(tmpDir);

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'User prefers Vitest', ['testing']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, '', 'proc-1');
        try {
            if (addon.systemMessageSuffix) {
                expect(addon.systemMessageSuffix).not.toContain('<recalled_memory>');
            }
        } finally {
            addon.dispose();
        }
    });

    it('has undefined systemMessageSuffix when no facts exist and no query', async () => {
        enableGlobalMemory(tmpDir);
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeUndefined();
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Dispose
    // -----------------------------------------------------------------------

    it('dispose is idempotent (safe to call twice)', async () => {
        enableGlobalMemory(tmpDir);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
        expect(() => {
            addon.dispose();
            addon.dispose();
        }).not.toThrow();
    });

    it('empty addon dispose is a no-op', async () => {
        const addon = await buildMemoryV2Addon(undefined, undefined);
        expect(() => addon.dispose()).not.toThrow();
    });

    // -----------------------------------------------------------------------
    // AC-07: V2 enabled provides tools without bounded memory
    // -----------------------------------------------------------------------

    describe('AC-07: V2 enabled provides tools without bounded memory', () => {
        it('provides both save_memory and recall_memory tools when only global enabled', async () => {
            enableGlobalMemory(tmpDir);

            const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
            try {
                expect(addon.tools).toHaveLength(2);
                expect(addon.tools.map(t => t.name)).toContain(MEMORY_V2_STORE_TOOL_NAME);
                expect(addon.tools.map(t => t.name)).toContain(MEMORY_V2_RECALL_TOOL_NAME);
                expect(addon.suffix).toContain('memory');
            } finally {
                addon.dispose();
            }
        });

        it('buildMemoryV2Addon is independent of forge bounded-memory modules', async () => {
            enableGlobalMemory(tmpDir);

            const globalDir = path.join(tmpDir, 'memory', 'global');
            await seedFact(globalDir, 'Architectural decision: TypeScript strict mode', ['arch']);

            const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, 'architecture decisions', 'proc-1');
            try {
                expect(addon.systemMessageSuffix).toContain('Architectural decision');
                expect(addon.tools).toHaveLength(2);
            } finally {
                addon.dispose();
            }
        });
    });
});
