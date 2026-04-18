/**
 * Tests for buildBoundedMemoryAddon
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildBoundedMemoryAddon } from '../../../src/server/executors/bounded-memory-addon';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { ENTRY_DELIMITER } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'test-ws-bounded-mem';

function writeMemoryFile(dataDir: string, workspaceId: string, content: string): void {
    const memoryDir = path.join(dataDir, 'repos', workspaceId, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), content, 'utf-8');
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
});
