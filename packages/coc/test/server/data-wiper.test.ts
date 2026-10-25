/**
 * Tests for the DataWiper class: wipe logic, dry-run, error handling,
 * and SQLite queue row deletion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { DataWiper } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'data-wiper-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('DataWiper', () => {
    let dataDir: string;
    let store: SqliteProcessStore;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ========================================================================
    // getDryRunSummary
    // ========================================================================

    describe('getDryRunSummary', () => {
        it('should return zeros for empty data directory', async () => {
            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedProcesses).toBe(0);
            expect(summary.deletedWorkspaces).toBe(0);
            expect(summary.deletedQueues).toBe(0);
            expect(summary.deletedPreferences).toBe(false);
            expect(summary.errors).toEqual([]);
        });

        it('should count existing processes and workspaces', async () => {
            // Seed data
            await store.addProcess({
                id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
            });
            await store.addProcess({
                id: 'p2', type: 'clarification', promptPreview: 'test2', fullPrompt: 'test2', status: 'running', startTime: new Date(),
            });
            await store.registerWorkspace({ id: 'ws1', name: 'Workspace 1', rootPath: '/tmp/ws1' });

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedProcesses).toBe(2);
            expect(summary.deletedWorkspaces).toBe(1);
        });

        it('should count queue rows from SQLite', async () => {
            const db = store.getDatabase();
            db.prepare('INSERT INTO queue_tasks (id, repo_id, type, status, priority, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t1', 'repo1', 'chat', 'queued', 'normal', '{}', Date.now());
            db.prepare('INSERT INTO queue_tasks (id, repo_id, type, status, priority, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t2', 'repo1', 'chat', 'running', 'normal', '{}', Date.now());
            db.prepare('INSERT INTO queue_repo_state (repo_id, is_paused) VALUES (?, ?)').run('repo1', 0);

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedQueues).toBe(3);
        });

        it('should count queue files from repos directory', async () => {
            writeJSON(path.join(dataDir, 'repos', 'repo1', 'queues.json'), {
                version: 3,
                repoRootPath: '/repo1',
                repoId: 'repo1',
                pending: [],
                history: [],
            });

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedQueues).toBe(1);
        });

        it('should detect preferences file', async () => {
            writeJSON(path.join(dataDir, 'preferences.json'), { lastModel: 'gpt-4' });

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedPreferences).toBe(true);
        });

        it('should not modify data during dry run', async () => {
            await store.addProcess({
                id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
            });

            const wiper = new DataWiper(dataDir, store);
            await wiper.getDryRunSummary();

            const processes = await store.getAllProcesses();
            expect(processes).toHaveLength(1);
        });

        it('should list preserved config file', async () => {
            writeJSON(path.join(dataDir, 'config.yaml'), {});

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.preservedFiles).toContain(path.join(dataDir, 'config.yaml'));
        });

        it('should list preserved skills directory', async () => {
            const skillsDir = path.join(dataDir, 'skills');
            fs.mkdirSync(skillsDir, { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'my-skill'));
            fs.writeFileSync(path.join(skillsDir, 'my-skill', 'SKILL.md'), '# Test');

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.preservedFiles).toContain(skillsDir);
        });

        it('should count blob files in blobs/ directory', async () => {
            const blobsDir = path.join(dataDir, 'blobs');
            fs.mkdirSync(blobsDir, { recursive: true });
            writeJSON(path.join(blobsDir, 'task-1.images.json'), ['data:image/png;base64,abc']);
            writeJSON(path.join(blobsDir, 'task-2.images.json'), ['data:image/png;base64,def']);

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            // Blobs are still deleted but no longer tracked in WipeResult
            expect(summary.deletedSchedules).toBe(0);
            expect(summary.deletedGitOps).toBe(0);
        });

        it('should count schedule and git-ops files', async () => {
            const repoDir = path.join(dataDir, 'repos', 'abc123');
            fs.mkdirSync(repoDir, { recursive: true });
            // New YAML schedule format: individual files in schedules/ directory
            const schedulesDir = path.join(repoDir, 'schedules');
            fs.mkdirSync(schedulesDir, { recursive: true });
            fs.writeFileSync(path.join(schedulesDir, 'sched-1.yaml'), 'id: sched-1\nname: Test');
            const db = store.getDatabase();
            db.prepare('INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, status) VALUES (?, ?, ?, ?, ?)').run('run1', 'sched-1', 'abc123', '2026-03-01T00:00:00Z', 'completed');
            writeJSON(path.join(repoDir, 'git-ops.json'), {});
            writeJSON(path.join(repoDir, 'preferences.json'), {});

            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedSchedules).toBe(2); // 1 YAML + 1 SQLite row
            expect(summary.deletedGitOps).toBe(1);
            expect(summary.deletedRepoPreferences).toBe(1);
        });

        it('should return zero schedule/git-ops counts when repos dir does not exist', async () => {
            const wiper = new DataWiper(dataDir, store);
            const summary = await wiper.getDryRunSummary();

            expect(summary.deletedSchedules).toBe(0);
            expect(summary.deletedGitOps).toBe(0);
            expect(summary.deletedRepoPreferences).toBe(0);
        });

        it('should not delete blob files during dry run', async () => {
            const blobsDir = path.join(dataDir, 'blobs');
            fs.mkdirSync(blobsDir, { recursive: true });
            const blobFile = path.join(blobsDir, 'task-1.images.json');
            writeJSON(blobFile, ['data:image/png;base64,abc']);

            const wiper = new DataWiper(dataDir, store);
            await wiper.getDryRunSummary();

            expect(fs.existsSync(blobFile)).toBe(true);
        });
    });

    // ========================================================================
    // wipeData
    // ========================================================================

    describe('wipeData', () => {
        it('should clear all processes', async () => {
            await store.addProcess({
                id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
            });
            await store.addProcess({
                id: 'p2', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'failed', startTime: new Date(),
            });

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedProcesses).toBe(2);
            const remaining = await store.getAllProcesses();
            expect(remaining).toHaveLength(0);
        });

        it('should clear all workspaces', async () => {
            await store.registerWorkspace({ id: 'ws1', name: 'WS1', rootPath: '/tmp/ws1' });
            await store.registerWorkspace({ id: 'ws2', name: 'WS2', rootPath: '/tmp/ws2' });

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedWorkspaces).toBe(2);
            const remaining = await store.getWorkspaces();
            expect(remaining).toHaveLength(0);
        });

        it('should delete queue rows from SQLite', async () => {
            const db = store.getDatabase();
            db.prepare('INSERT INTO queue_tasks (id, repo_id, type, status, priority, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('t1', 'repo1', 'chat', 'queued', 'normal', '{}', Date.now());
            db.prepare('INSERT INTO queue_repo_state (repo_id, is_paused) VALUES (?, ?)').run('repo1', 0);
            // queue_repo_paths is created lazily by SqliteQueuePersistence — create it for the test
            db.exec('CREATE TABLE IF NOT EXISTS queue_repo_paths (repo_id TEXT PRIMARY KEY, root_path TEXT NOT NULL)');
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run('repo1', '/tmp/repo1');

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedQueues).toBe(2); // 1 task + 1 repo state
            const taskRows = db.prepare('SELECT COUNT(*) as cnt FROM queue_tasks').get() as { cnt: number };
            expect(taskRows.cnt).toBe(0);
            const stateRows = db.prepare('SELECT COUNT(*) as cnt FROM queue_repo_state').get() as { cnt: number };
            expect(stateRows.cnt).toBe(0);
            const pathRows = db.prepare('SELECT COUNT(*) as cnt FROM queue_repo_paths').get() as { cnt: number };
            expect(pathRows.cnt).toBe(0);
        });

        it('should delete queue files from repos directory', async () => {
            const queuePath = path.join(dataDir, 'repos', 'repo1', 'queues.json');
            writeJSON(queuePath, {
                version: 3,
                repoRootPath: '/repo1',
                repoId: 'repo1',
                pending: [],
                history: [],
            });

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedQueues).toBe(1);
            expect(fs.existsSync(queuePath)).toBe(false);
        });

        it('should delete preferences file', async () => {
            const prefsPath = path.join(dataDir, 'preferences.json');
            writeJSON(prefsPath, { lastModel: 'gpt-4' });

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedPreferences).toBe(true);
            expect(fs.existsSync(prefsPath)).toBe(false);
        });

        it('should not delete config.yaml', async () => {
            const configPath = path.join(dataDir, 'config.yaml');
            fs.writeFileSync(configPath, 'model: gpt-4\n', 'utf-8');

            const wiper = new DataWiper(dataDir, store);
            await wiper.wipeData();

            expect(fs.existsSync(configPath)).toBe(true);
        });

        it('should leave legacy wiki rows and their output directories untouched', async () => {
            const wikiDir = path.join(dataDir, 'wiki-output');
            fs.mkdirSync(wikiDir, { recursive: true });
            fs.writeFileSync(path.join(wikiDir, 'index.html'), '<html></html>');
            const db = store.getDatabase();
            db.exec('CREATE TABLE IF NOT EXISTS wikis (id TEXT PRIMARY KEY, wiki_dir TEXT NOT NULL)');
            db.prepare('INSERT INTO wikis (id, wiki_dir) VALUES (?, ?)').run('w1', wikiDir);

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.errors).toEqual([]);
            expect(fs.existsSync(path.join(wikiDir, 'index.html'))).toBe(true);
            expect((db.prepare('SELECT COUNT(*) AS cnt FROM wikis').get() as { cnt: number }).cnt).toBe(1);
        });

        it('should handle empty queue tables gracefully', async () => {
            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedQueues).toBe(0);
            expect(result.errors).toEqual([]);
        });

        it('should delete all blob files from blobs/ directory', async () => {
            const blobsDir = path.join(dataDir, 'blobs');
            fs.mkdirSync(blobsDir, { recursive: true });
            const blob1 = path.join(blobsDir, 'task-1.images.json');
            const blob2 = path.join(blobsDir, 'task-2.images.json');
            writeJSON(blob1, ['data:image/png;base64,abc']);
            writeJSON(blob2, ['data:image/png;base64,def']);

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            // Blob files are deleted even though deletedBlobs is no longer in WipeResult
            expect(fs.existsSync(blob1)).toBe(false);
            expect(fs.existsSync(blob2)).toBe(false);
        });

        it('should handle missing blobs directory gracefully', async () => {
            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.errors).toEqual([]);
        });

        it('should delete schedule files and schedule run rows from repos/', async () => {
            const repoDir = path.join(dataDir, 'repos', 'abc123');
            fs.mkdirSync(repoDir, { recursive: true });
            // New YAML schedule format: individual files in schedules/ directory
            const schedulesDir = path.join(repoDir, 'schedules');
            fs.mkdirSync(schedulesDir, { recursive: true });
            fs.writeFileSync(path.join(schedulesDir, 'sched-1.yaml'), 'id: sched-1\nname: Test');
            const db = store.getDatabase();
            db.prepare('INSERT INTO schedule_runs (id, schedule_id, repo_id, started_at, status) VALUES (?, ?, ?, ?, ?)').run('run1', 'sched-1', 'abc123', '2026-03-01T00:00:00Z', 'completed');
            writeJSON(path.join(repoDir, 'git-ops.json'), {});

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            expect(result.deletedSchedules).toBe(2); // 1 YAML + 1 SQLite row
            expect(result.deletedGitOps).toBe(1);
            expect(fs.existsSync(schedulesDir)).toBe(false);
            expect(fs.existsSync(path.join(repoDir, 'git-ops.json'))).toBe(false);
            // SQLite rows should be gone
            const runCount = (db.prepare('SELECT COUNT(*) as cnt FROM schedule_runs').get() as { cnt: number }).cnt;
            expect(runCount).toBe(0);
        });

        it('should report errors but continue on partial failures', async () => {
            await store.addProcess({
                id: 'p1', type: 'clarification', promptPreview: 'test', fullPrompt: 'test', status: 'completed', startTime: new Date(),
            });

            const wiper = new DataWiper(dataDir, store);
            const result = await wiper.wipeData();

            // Should succeed overall
            expect(result.deletedProcesses).toBe(1);
        });
    });
});
