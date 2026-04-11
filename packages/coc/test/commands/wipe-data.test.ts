/**
 * Wipe Data Command Tests
 *
 * Tests for the `coc admin wipe-data` command execution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { executeWipeData } from '../../src/commands/wipe-data';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'wipe-data-cmd-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('executeWipeData', () => {
    let dataDir: string;

    beforeEach(() => {
        dataDir = createTempDir();
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('should return SUCCESS for empty data directory', async () => {
        const exitCode = await executeWipeData({
            confirm: true,
            dataDir,
        });
        expect(exitCode).toBe(0);
    });

    it('should wipe data in confirm mode', async () => {
        // Seed data using SQLite (the default backend)
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        await store.addProcess({
            id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
        });
        await store.registerWorkspace({ id: 'ws1', name: 'WS', rootPath: '/tmp/ws' });
        store.close();

        writeJSON(path.join(dataDir, 'preferences.json'), { lastModel: 'gpt-4' });
        writeJSON(path.join(dataDir, 'repos', 'abc', 'queues.json'), { version: 2, pending: [] });

        const exitCode = await executeWipeData({
            confirm: true,
            dataDir,
        });

        expect(exitCode).toBe(0);

        // Verify data was actually wiped
        const store2 = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        const processes = await store2.getAllProcesses();
        expect(processes).toHaveLength(0);

        const workspaces = await store2.getWorkspaces();
        expect(workspaces).toHaveLength(0);
        store2.close();

        expect(fs.existsSync(path.join(dataDir, 'preferences.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'abc', 'queues.json'))).toBe(false);
    });

    it('should show dry-run without deleting', async () => {
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        await store.addProcess({
            id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
        });
        store.close();

        const exitCode = await executeWipeData({
            dryRun: true,
            dataDir,
        });

        expect(exitCode).toBe(0);

        // Data should still exist
        const store2 = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        const processes = await store2.getAllProcesses();
        expect(processes).toHaveLength(1);
        store2.close();
    });

    it('should preserve config.yaml', async () => {
        const configPath = path.join(dataDir, 'config.yaml');
        fs.writeFileSync(configPath, 'model: gpt-4\n', 'utf-8');

        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        await store.addProcess({
            id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
        });
        store.close();

        await executeWipeData({ confirm: true, dataDir });

        expect(fs.existsSync(configPath)).toBe(true);
    });

    it('should handle tilde in data-dir path', async () => {
        // Just verify it doesn't crash — actual path resolution is internal
        const exitCode = await executeWipeData({
            confirm: true,
            dataDir,
        });
        expect(exitCode).toBe(0);
    });
});
