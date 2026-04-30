/**
 * Tests for buildBoundedMemoryAddon
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBoundedMemoryAddon } from '../../../src/server/executors/bounded-memory-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { ENTRY_DELIMITER, MEMORY_SCHEMA, getMemorySchema } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'test-ws-bounded-mem';

function writeMemoryFile(dataDir: string, workspaceId: string, content: string): void {
    const memoryDir = path.join(dataDir, 'repos', workspaceId, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), content, 'utf-8');
}

function writeSystemMemoryFile(dataDir: string, content: string): void {
    const systemDir = path.join(dataDir, 'memory', 'system');
    fs.mkdirSync(systemDir, { recursive: true });
    fs.writeFileSync(path.join(systemDir, 'MEMORY.md'), content, 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('buildBoundedMemoryAddon', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-mem-addon-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty addon when dataDir is undefined', async () => {
        const addon = await buildBoundedMemoryAddon(undefined, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    it('returns empty addon when workspaceId is undefined', async () => {
        const addon = await buildBoundedMemoryAddon(tmpDir, undefined);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    it('returns empty addon when boundedMemory.enabled is false', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: false } });
        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    it('returns empty addon when boundedMemory preference is absent', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, {});
        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
        expect(addon.systemMessageSuffix).toBeUndefined();
    });

    it('returns populated addon when enabled with MEMORY.md content', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });
        writeMemoryFile(tmpDir, WORKSPACE_ID, `User prefers tabs over spaces${ENTRY_DELIMITER}Project uses Vitest for tests`);

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.systemMessageSuffix).toBeDefined();
        expect(addon.systemMessageSuffix).toContain('User prefers tabs over spaces');
        expect(addon.systemMessageSuffix).toContain('Project uses Vitest for tests');
        expect(addon.tools).toHaveLength(1);
        expect(addon.tools[0].name).toBe('memory');
        expect(addon.suffix).toContain('`memory` tool');
    });

    it('returns addon with tool but no snapshot when MEMORY.md is empty', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });
        // No MEMORY.md written — store will be empty

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.systemMessageSuffix).toBeUndefined();
        expect(addon.tools).toHaveLength(1);
        expect(addon.tools[0].name).toBe('memory');
        expect(addon.suffix).toContain('`memory` tool');
    });

    it('respects charLimit from preferences', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true, charLimit: 100 } });
        // Write content under limit
        const shortContent = 'Short fact about project';
        writeMemoryFile(tmpDir, WORKSPACE_ID, shortContent);

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.systemMessageSuffix).toBeDefined();
        expect(addon.systemMessageSuffix).toContain('Short fact about project');
        // The snapshot header should show the 100 char limit
        expect(addon.systemMessageSuffix).toContain('/100');
    });

    it('includes system store content in systemMessageSuffix when system MEMORY.md has entries', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });
        writeSystemMemoryFile(tmpDir, 'Cross-repo system fact');

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.systemMessageSuffix).toBeDefined();
        expect(addon.systemMessageSuffix).toContain('Cross-repo system fact');
        expect(addon.systemMessageSuffix).toContain('SYSTEM MEMORY');
    });

    it('includes both repo and system content when both MEMORY.md files have entries', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });
        writeMemoryFile(tmpDir, WORKSPACE_ID, 'Repo-scoped fact');
        writeSystemMemoryFile(tmpDir, 'System-level fact');

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.systemMessageSuffix).toBeDefined();
        expect(addon.systemMessageSuffix).toContain('Repo-scoped fact');
        expect(addon.systemMessageSuffix).toContain('System-level fact');
        expect(addon.systemMessageSuffix).toContain('MEMORY (your personal notes)');
        expect(addon.systemMessageSuffix).toContain('SYSTEM MEMORY (cross-project notes)');
    });

    it('system target is available in the tool when enabled', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.tools).toHaveLength(1);
        const tool = addon.tools[0] as any;
        const result = await tool.handler({ action: 'add', target: 'system', content: 'test system fact' });
        expect(result.success).toBe(true);
    });

    it('memory target is available in the tool when enabled', async () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });

        const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

        expect(addon.tools).toHaveLength(1);
        const tool = addon.tools[0] as any;
        const result = await tool.handler({ action: 'add', target: 'repo', content: 'test repo fact' });
        expect(result.success).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Write frequency passthrough
    // -----------------------------------------------------------------------

    describe('writeFrequency passthrough', () => {
        it('uses default (medium) schema when writeFrequency is not set', async () => {
            writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true } });
            const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

            expect(addon.tools).toHaveLength(1);
            expect(addon.tools[0].description).toBe(MEMORY_SCHEMA);
        });

        it('uses low schema when writeFrequency is "low"', async () => {
            writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true, writeFrequency: 'low' } });
            const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

            expect(addon.tools).toHaveLength(1);
            expect(addon.tools[0].description).toBe(getMemorySchema('low'));
            expect(addon.tools[0].description).toContain('only on explicit request');
        });

        it('uses high schema when writeFrequency is "high"', async () => {
            writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true, writeFrequency: 'high' } });
            const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

            expect(addon.tools).toHaveLength(1);
            expect(addon.tools[0].description).toBe(getMemorySchema('high'));
            expect(addon.tools[0].description).toContain('err on the side of saving');
        });

        it('passes writeFrequency to MemoryPromptBuilder (guidance in systemMessageSuffix)', async () => {
            writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true, writeFrequency: 'low' } });
            writeMemoryFile(tmpDir, WORKSPACE_ID, 'some fact');

            const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

            expect(addon.systemMessageSuffix).toBeDefined();
            expect(addon.systemMessageSuffix).toContain('sparingly');
        });

        it('high frequency guidance appears in systemMessageSuffix', async () => {
            writeRepoPreferences(tmpDir, WORKSPACE_ID, { boundedMemory: { enabled: true, writeFrequency: 'high' } });
            writeMemoryFile(tmpDir, WORKSPACE_ID, 'some fact');

            const addon = await buildBoundedMemoryAddon(tmpDir, WORKSPACE_ID);

            expect(addon.systemMessageSuffix).toBeDefined();
            expect(addon.systemMessageSuffix).toContain('Actively capture');
        });
    });
});
