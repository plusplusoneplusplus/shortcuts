/**
 * OutputPruner Tests
 *
 * Tests for output file cleanup alongside process removal/pruning.
 * Uses OS temp directories for cross-platform compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess, AIProcessStatus } from '@plusplusoneplusplus/pipeline-core';
import { OutputPruner } from '../../src/server/output-pruner';
import { OutputFileManager } from '../../src/server/output-file-manager';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'clarification',
        promptPreview: `prompt-${id}`,
        fullPrompt: `Full prompt for ${id}`,
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

describe('OutputPruner', () => {
    let tmpDir: string;
    let store: FileProcessStore;
    let pruner: OutputPruner;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-pruner-test-'));
        store = new FileProcessStore({ dataDir: tmpDir });
        pruner = new OutputPruner(store, tmpDir);
    });

    afterEach(async () => {
        pruner.stopListening();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // ========================================================================
    // cleanupOrphans
    // ========================================================================

    describe('cleanupOrphans', () => {
        it('should delete output files for processes not in the store', async () => {
            // Create output files for some "processes"
            await OutputFileManager.saveOutput('orphan-1', 'content1', tmpDir);
            await OutputFileManager.saveOutput('orphan-2', 'content2', tmpDir);
            await OutputFileManager.saveOutput('active-1', 'content3', tmpDir);

            // Only active-1 exists in the store
            await store.addProcess(makeProcess('active-1', { status: 'running' }));

            const deleted = await pruner.cleanupOrphans();

            expect(deleted).toBe(2);

            // Orphan files should be gone
            await expect(fs.access(path.join(tmpDir, 'outputs', 'orphan-1.md'))).rejects.toThrow();
            await expect(fs.access(path.join(tmpDir, 'outputs', 'orphan-2.md'))).rejects.toThrow();

            // Active file should remain
            const content = await fs.readFile(path.join(tmpDir, 'outputs', 'active-1.md'), 'utf-8');
            expect(content).toBe('content3');
        });

        it('should preserve output files for running/queued processes', async () => {
            await OutputFileManager.saveOutput('running-1', 'output', tmpDir);
            await OutputFileManager.saveOutput('queued-1', 'output', tmpDir);

            await store.addProcess(makeProcess('running-1', { status: 'running' }));
            await store.addProcess(makeProcess('queued-1', { status: 'queued' }));

            const deleted = await pruner.cleanupOrphans();
            expect(deleted).toBe(0);

            // Both files should remain
            const content1 = await fs.readFile(path.join(tmpDir, 'outputs', 'running-1.md'), 'utf-8');
            expect(content1).toBe('output');
            const content2 = await fs.readFile(path.join(tmpDir, 'outputs', 'queued-1.md'), 'utf-8');
            expect(content2).toBe('output');
        });

        it('should return 0 when outputs directory does not exist', async () => {
            const deleted = await pruner.cleanupOrphans();
            expect(deleted).toBe(0);
        });

        it('should return 0 when outputs directory is empty', async () => {
            await fs.mkdir(path.join(tmpDir, 'outputs'), { recursive: true });
            const deleted = await pruner.cleanupOrphans();
            expect(deleted).toBe(0);
        });
    });

    // ========================================================================
    // deleteOutputFile
    // ========================================================================

    describe('deleteOutputFile', () => {
        it('should delete an existing output file', async () => {
            await OutputFileManager.saveOutput('proc-1', 'content', tmpDir);

            await pruner.deleteOutputFile('proc-1');

            await expect(fs.access(path.join(tmpDir, 'outputs', 'proc-1.md'))).rejects.toThrow();
        });

        it('should not throw for missing file', async () => {
            await expect(pruner.deleteOutputFile('non-existent')).resolves.toBeUndefined();
        });
    });

    // ========================================================================
    // Event-driven cleanup via startListening
    // ========================================================================

    describe('startListening / stopListening', () => {
        it('should delete output file when removeProcess is called', async () => {
            pruner.startListening();

            await store.addProcess(makeProcess('proc-1', { status: 'completed' }));
            await OutputFileManager.saveOutput('proc-1', 'content', tmpDir);

            await store.removeProcess('proc-1');

            // Give async cleanup a tick to run
            await new Promise(r => setTimeout(r, 50));

            await expect(fs.access(path.join(tmpDir, 'outputs', 'proc-1.md'))).rejects.toThrow();
        });

        it('should clean up all output files when clearProcesses is called', async () => {
            pruner.startListening();

            await store.addProcess(makeProcess('proc-1'));
            await store.addProcess(makeProcess('proc-2'));
            await OutputFileManager.saveOutput('proc-1', 'content1', tmpDir);
            await OutputFileManager.saveOutput('proc-2', 'content2', tmpDir);

            await store.clearProcesses();

            // Give async cleanup a tick to run
            await new Promise(r => setTimeout(r, 100));

            await expect(fs.access(path.join(tmpDir, 'outputs', 'proc-1.md'))).rejects.toThrow();
            await expect(fs.access(path.join(tmpDir, 'outputs', 'proc-2.md'))).rejects.toThrow();
        });

        it('should forward events to previous onProcessChange callback', async () => {
            const events: string[] = [];
            store.onProcessChange = (event) => events.push(event.type);

            pruner.startListening();

            await store.addProcess(makeProcess('proc-1'));
            await store.removeProcess('proc-1');

            expect(events).toContain('process-added');
            expect(events).toContain('process-removed');
        });

        it('should stop cleaning up after stopListening', async () => {
            pruner.startListening();
            pruner.stopListening();

            await store.addProcess(makeProcess('proc-1'));
            await OutputFileManager.saveOutput('proc-1', 'content', tmpDir);
            await store.removeProcess('proc-1');

            // Give time for any cleanup
            await new Promise(r => setTimeout(r, 50));

            // File should still exist since pruner stopped listening
            const content = await fs.readFile(path.join(tmpDir, 'outputs', 'proc-1.md'), 'utf-8');
            expect(content).toBe('content');
        });

        it('should be idempotent (calling startListening twice is safe)', async () => {
            pruner.startListening();
            pruner.startListening(); // second call should be no-op

            await store.addProcess(makeProcess('proc-1'));
            await OutputFileManager.saveOutput('proc-1', 'content', tmpDir);
            await store.removeProcess('proc-1');

            await new Promise(r => setTimeout(r, 50));
            await expect(fs.access(path.join(tmpDir, 'outputs', 'proc-1.md'))).rejects.toThrow();
        });
    });

    // ========================================================================
    // handlePrunedEntries (prune hook)
    // ========================================================================

    describe('handlePrunedEntries', () => {
        it('should delete output files for pruned entries', async () => {
            const maxProcesses = 5;
            const prunerStore = new FileProcessStore({ dataDir: tmpDir, maxProcesses });
            const prunerInstance = new OutputPruner(prunerStore, tmpDir);

            // Wire the prune hook
            prunerStore.onPrune = (entries) => prunerInstance.handlePrunedEntries(entries);

            // Add processes at limit with output files
            for (let i = 0; i < 5; i++) {
                const id = `proc-${i}`;
                await prunerStore.addProcess(makeProcess(id, {
                    status: 'completed',
                    startTime: new Date(Date.now() + i * 1000),
                }));
                await OutputFileManager.saveOutput(id, `content-${i}`, tmpDir);
            }

            // Add 3 more to trigger pruning of 3 oldest
            for (let i = 5; i < 8; i++) {
                await prunerStore.addProcess(makeProcess(`proc-${i}`, {
                    status: 'completed',
                    startTime: new Date(Date.now() + i * 1000),
                }));
            }

            // Give async delete a tick
            await new Promise(r => setTimeout(r, 500));

            // The 3 oldest output files should be deleted
            for (let i = 0; i < 3; i++) {
                await expect(
                    fs.access(path.join(tmpDir, 'outputs', `proc-${i}.md`))
                ).rejects.toThrow();
            }

            // Remaining files should still exist
            for (let i = 3; i < 5; i++) {
                const content = await fs.readFile(
                    path.join(tmpDir, 'outputs', `proc-${i}.md`), 'utf-8'
                );
                expect(content).toBe(`content-${i}`);
            }
        });
    });

    // ========================================================================
    // cleanupStaleQueueEntries
    // ========================================================================

    describe('cleanupStaleQueueEntries', () => {
        it('should remove stale entries from queue.json', async () => {
            // Write a queue.json with entries referencing non-existent processes
            const queueState = {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: [
                    { id: 'task-1', processId: 'queue-task-1', status: 'queued', type: 'ai-clarification' },
                    { id: 'task-2', processId: 'queue-task-2', status: 'queued', type: 'ai-clarification' },
                ],
                history: [
                    { id: 'task-3', processId: 'queue-task-3', status: 'completed', type: 'ai-clarification' },
                ],
            };
            await fs.writeFile(path.join(tmpDir, 'queue.json'), JSON.stringify(queueState), 'utf-8');

            // Only queue-task-1 exists in the store
            await store.addProcess(makeProcess('queue-task-1'));

            const removed = await pruner.cleanupStaleQueueEntries();

            expect(removed).toBe(2); // task-2 from pending, task-3 from history

            // Verify the file was updated
            const raw = await fs.readFile(path.join(tmpDir, 'queue.json'), 'utf-8');
            const updated = JSON.parse(raw);
            expect(updated.pending).toHaveLength(1);
            expect(updated.pending[0].id).toBe('task-1');
            expect(updated.history).toHaveLength(0);
        });

        it('should preserve entries without processId', async () => {
            const queueState = {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: [
                    { id: 'task-1', status: 'queued', type: 'ai-clarification' }, // no processId
                ],
                history: [],
            };
            await fs.writeFile(path.join(tmpDir, 'queue.json'), JSON.stringify(queueState), 'utf-8');

            const removed = await pruner.cleanupStaleQueueEntries();
            expect(removed).toBe(0);
        });

        it('should return 0 when queue.json does not exist', async () => {
            const removed = await pruner.cleanupStaleQueueEntries();
            expect(removed).toBe(0);
        });

        it('should return 0 for corrupt queue.json', async () => {
            await fs.writeFile(path.join(tmpDir, 'queue.json'), 'not-valid-json', 'utf-8');
            const removed = await pruner.cleanupStaleQueueEntries();
            expect(removed).toBe(0);
        });
    });
});
