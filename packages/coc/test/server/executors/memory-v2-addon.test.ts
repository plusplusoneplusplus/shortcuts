/**
 * Tests for buildMemoryV2Addon (AC-05)
 *
 * Covers: disabled (feature flag off), enabled global mode, enabled isolated mode,
 *         frozen snapshot content, per-turn recall block, no-query no-recall,
 *         missing dataDir/workspaceId → empty addon, dispose is safe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMemoryStores } from '@plusplusoneplusplus/coc-memory';
import { buildMemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
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
        addon.dispose(); // safe to call
    });

    it('returns empty addon when workspaceId is undefined', async () => {
        const addon = await buildMemoryV2Addon(tmpDir, undefined);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.suffix).toBe('');
    });

    it('returns empty addon when memoryV2 preference is absent', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, {});
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    it('returns empty addon when memoryV2.enabled is false', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: false } });
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    // -----------------------------------------------------------------------
    // Enabled — global mode
    // -----------------------------------------------------------------------

    it('returns populated addon when enabled (global mode)', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, 'test query', 'proc-1');
        try {
            // Should have 2 tools
            expect(addon.tools).toHaveLength(2);
            const toolNames = addon.tools.map(t => t.name);
            expect(toolNames).toContain(MEMORY_V2_STORE_TOOL_NAME);
            expect(toolNames).toContain(MEMORY_V2_RECALL_TOOL_NAME);

            // Should have non-empty tool guidance suffix
            expect(addon.suffix).toContain('memory');
        } finally {
            addon.dispose();
        }
    });

    it('includes frozen snapshot block when active facts exist (global mode)', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });

        // Seed a fact in the global store
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

    it('includes per-turn recall block when query matches a fact', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'Project uses Vitest for unit tests', ['testing']);

        // Use simple query without special characters to avoid FTS5 parse errors
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, 'vitest tests', 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeTruthy();
            // Should have both blocks
            expect(addon.systemMessageSuffix).toContain('<memory_snapshot>');
            expect(addon.systemMessageSuffix).toContain('<recalled_memory>');
        } finally {
            addon.dispose();
        }
    });

    it('has no recall block when query is empty string', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });

        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'User prefers Vitest', ['testing']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, '', 'proc-1');
        try {
            // May have frozen snapshot but no recalled_memory block
            if (addon.systemMessageSuffix) {
                expect(addon.systemMessageSuffix).not.toContain('<recalled_memory>');
            }
        } finally {
            addon.dispose();
        }
    });

    it('has undefined systemMessageSuffix when no facts exist and no query', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });
        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.systemMessageSuffix).toBeUndefined();
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Enabled — isolated workspace mode
    // -----------------------------------------------------------------------

    it('uses workspace-scoped store in isolated mode', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true, isolated: true } });

        // Seed a fact in workspace store (isolated mode uses workspace memory dir)
        const workspaceDir = path.join(tmpDir, 'repos', WORKSPACE_ID, 'memory');
        await seedFact(workspaceDir, 'Isolated workspace fact', ['scope-test']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            expect(addon.tools).toHaveLength(2);
            expect(addon.systemMessageSuffix).toContain('Isolated workspace fact');
        } finally {
            addon.dispose();
        }
    });

    it('does not read global facts in isolated mode', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true, isolated: true } });

        // Only seed global facts — not workspace
        const globalDir = path.join(tmpDir, 'memory', 'global');
        await seedFact(globalDir, 'Global fact only', ['global']);

        const addon = await buildMemoryV2Addon(tmpDir, WORKSPACE_ID, undefined, 'proc-1');
        try {
            // systemMessageSuffix should NOT contain the global fact
            if (addon.systemMessageSuffix) {
                expect(addon.systemMessageSuffix).not.toContain('Global fact only');
            }
        } finally {
            addon.dispose();
        }
    });

    // -----------------------------------------------------------------------
    // Dispose
    // -----------------------------------------------------------------------

    it('dispose is idempotent (safe to call twice)', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryV2: { enabled: true } });

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
});
