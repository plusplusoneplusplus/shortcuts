/**
 * sanitizeTaskForPersistence Tests
 *
 * Covers: image externalization, deep clone, idempotency, blob file creation,
 * integration with QueuePersistence and MultiRepoQueuePersistence save paths,
 * and round-trip persistence with image rehydration metadata.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { TaskQueueManager, type TaskQueueManagerOptions } from '@plusplusoneplusplus/pipeline-core';
import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
import {
    sanitizeTaskForPersistence,
    QueuePersistence,
    computeRepoId,
    getRepoQueueFilePath,
} from '../../src/server/queue-persistence';
import { ImageBlobStore } from '../../src/server/image-blob-store';

// SDK mock — needed for multi-repo tests
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import { RepoQueueRegistry } from '@plusplusoneplusplus/pipeline-core';
import { MultiRepoQueueExecutorBridge } from '../../src/server/multi-repo-executor-bridge';
import { MultiRepoQueuePersistence } from '../../src/server/multi-repo-queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

let dataDir: string;

function removeDirSafe(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error: any) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

function makeTask(
    id: string,
    payload: Record<string, unknown> = {},
): QueuedTask {
    return {
        id,
        type: 'custom' as const,
        priority: 'normal' as const,
        status: 'queued' as const,
        createdAt: Date.now(),
        payload,
        config: {},
    } as QueuedTask;
}

const SAMPLE_IMAGES = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
];

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
    sdkMocks.resetAll();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-task-test-'));
});

afterEach(() => {
    removeDirSafe(dataDir);
});

// ============================================================================
// sanitizeTaskForPersistence — unit tests
// ============================================================================

describe('sanitizeTaskForPersistence', () => {
    it('externalizes images and sets metadata', async () => {
        const task = makeTask('task-with-images', {
            prompt: 'describe this',
            images: [...SAMPLE_IMAGES],
        });

        const result = await sanitizeTaskForPersistence(task, dataDir);
        const payload = result.payload as any;

        expect(payload.images).toEqual([]);
        expect(payload.imagesCount).toBe(2);
        expect(payload.imagesFilePath).toBe(
            path.join(dataDir, 'blobs', 'task-with-images.images.json')
        );
    });

    it('returns clone unchanged when payload has no images', async () => {
        const task = makeTask('task-no-images', {
            prompt: 'just text',
        });

        const result = await sanitizeTaskForPersistence(task, dataDir);
        const payload = result.payload as any;

        expect(payload.images).toBeUndefined();
        expect(payload.imagesFilePath).toBeUndefined();
        expect(payload.imagesCount).toBeUndefined();
        expect(payload.prompt).toBe('just text');
    });

    it('returns clone unchanged when images is an empty array', async () => {
        const task = makeTask('task-empty-images', {
            prompt: 'empty images',
            images: [],
        });

        const result = await sanitizeTaskForPersistence(task, dataDir);
        const payload = result.payload as any;

        expect(payload.images).toEqual([]);
        expect(payload.imagesFilePath).toBeUndefined();
        expect(payload.imagesCount).toBeUndefined();
    });

    it('does not mutate the original task object', async () => {
        const originalImages = [...SAMPLE_IMAGES];
        const task = makeTask('task-immutable', {
            prompt: 'check immutability',
            images: originalImages,
        });

        const payloadBefore = JSON.stringify(task.payload);
        await sanitizeTaskForPersistence(task, dataDir);
        const payloadAfter = JSON.stringify(task.payload);

        expect(payloadAfter).toBe(payloadBefore);
        expect((task.payload as any).images).toEqual(originalImages);
        expect((task.payload as any).imagesFilePath).toBeUndefined();
    });

    it('writes blob file to correct path', async () => {
        const task = makeTask('task-blob-check', {
            images: [...SAMPLE_IMAGES],
        });

        await sanitizeTaskForPersistence(task, dataDir);

        const blobPath = path.join(dataDir, 'blobs', 'task-blob-check.images.json');
        expect(fs.existsSync(blobPath)).toBe(true);

        const content = JSON.parse(fs.readFileSync(blobPath, 'utf-8'));
        expect(content).toEqual(SAMPLE_IMAGES);
    });

    it('is idempotent — re-sanitizing already-sanitized task is safe', async () => {
        const task = makeTask('task-idempotent', {
            images: [...SAMPLE_IMAGES],
        });

        const first = await sanitizeTaskForPersistence(task, dataDir);
        const second = await sanitizeTaskForPersistence(first, dataDir);
        const payload = second.payload as any;

        // images is [] from first sanitize, so second sanitize is a no-op
        expect(payload.images).toEqual([]);
        expect(payload.imagesFilePath).toBeDefined();
        expect(payload.imagesCount).toBe(2);
    });

    it('preserves all other payload fields', async () => {
        const task = makeTask('task-fields', {
            prompt: 'my prompt',
            model: 'gpt-4',
            workingDirectory: '/some/path',
            images: [...SAMPLE_IMAGES],
            customField: { nested: true },
        });

        const result = await sanitizeTaskForPersistence(task, dataDir);
        const payload = result.payload as any;

        expect(payload.prompt).toBe('my prompt');
        expect(payload.model).toBe('gpt-4');
        expect(payload.workingDirectory).toBe('/some/path');
        expect(payload.customField).toEqual({ nested: true });
    });

    it('preserves task-level fields (id, type, priority, status)', async () => {
        const task = makeTask('task-meta', {
            images: [...SAMPLE_IMAGES],
        });
        task.displayName = 'My Task';

        const result = await sanitizeTaskForPersistence(task, dataDir);

        expect(result.id).toBe('task-meta');
        expect(result.type).toBe('custom');
        expect(result.priority).toBe('normal');
        expect(result.status).toBe('queued');
        expect(result.displayName).toBe('My Task');
    });
});

// ============================================================================
// QueuePersistence.save() integration — image externalization
// ============================================================================

describe('QueuePersistence save with images', () => {
    let queueManager: TaskQueueManager;
    let persistence: QueuePersistence;

    function createManager(options: Partial<TaskQueueManagerOptions> = {}): TaskQueueManager {
        return new TaskQueueManager({
            maxQueueSize: 0,
            keepHistory: true,
            maxHistorySize: 100,
            ...options,
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        queueManager = createManager();
    });

    afterEach(() => {
        if (persistence) {
            persistence.dispose();
        }
        vi.useRealTimers();
    });

    async function flushSave(): Promise<void> {
        await vi.advanceTimersByTimeAsync(400);
    }

    it('persists task with images: images externalized, metadata present', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/images-test';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, images: [...SAMPLE_IMAGES] },
            config: {},
        });

        // Directly await the async save (bypassing debounce) since
        // ImageBlobStore uses real fs.promises I/O that fake timers can't flush
        await (persistence as any).save();

        const filePath = getRepoQueueFilePath(dataDir, rootPath);
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        expect(state.pending).toHaveLength(1);
        const payload = state.pending[0].payload;
        expect(payload.images).toEqual([]);
        expect(payload.imagesCount).toBe(2);
        expect(payload.imagesFilePath).toContain('.images.json');
    });

    it('persists task without images: payload unchanged', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/no-images-test';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, prompt: 'hello' },
            config: {},
        });

        await flushSave();

        const filePath = getRepoQueueFilePath(dataDir, rootPath);
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        expect(state.pending).toHaveLength(1);
        const payload = state.pending[0].payload;
        expect(payload.prompt).toBe('hello');
        expect(payload.imagesFilePath).toBeUndefined();
        expect(payload.imagesCount).toBeUndefined();
    });

    it('creates blob file after save', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/blob-test';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, images: [...SAMPLE_IMAGES] },
            config: {},
        });

        await (persistence as any).save();

        const blobsDir = path.join(dataDir, 'blobs');
        expect(fs.existsSync(blobsDir)).toBe(true);
        const blobFiles = fs.readdirSync(blobsDir).filter(f => f.endsWith('.images.json'));
        expect(blobFiles).toHaveLength(1);
    });

    it('does not mutate in-memory task during save', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/mutation-test';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, images: [...SAMPLE_IMAGES] },
            config: {},
        });

        await (persistence as any).save();

        // The in-memory task should still have images
        const queued = queueManager.getQueued();
        expect(queued).toHaveLength(1);
        expect((queued[0].payload as any).images).toEqual(SAMPLE_IMAGES);
        expect((queued[0].payload as any).imagesFilePath).toBeUndefined();
    });
});

// ============================================================================
// MultiRepoQueuePersistence.save() integration — image externalization
// ============================================================================

describe('MultiRepoQueuePersistence save with images', () => {
    let registry: RepoQueueRegistry;
    let bridge: MultiRepoQueueExecutorBridge;
    let persistence: MultiRepoQueuePersistence;

    function createBridge(): { registry: RepoQueueRegistry; bridge: MultiRepoQueueExecutorBridge } {
        const reg = new RepoQueueRegistry();
        const store = createMockProcessStore();
        const br = new MultiRepoQueueExecutorBridge(reg, store, { autoStart: false });
        return { registry: reg, bridge: br };
    }

    beforeEach(() => {
        vi.useFakeTimers();
        const created = createBridge();
        registry = created.registry;
        bridge = created.bridge;
    });

    afterEach(() => {
        if (persistence) {
            persistence.dispose();
        }
        bridge.dispose();
        vi.useRealTimers();
    });

    it('externalizes images on save', async () => {
        persistence = new MultiRepoQueuePersistence(bridge, dataDir);
        persistence.restore();

        const rootPath = '/repo/multi-img';
        bridge.getOrCreateBridge(rootPath);
        const qm = registry.getQueueForRepo(rootPath);
        qm.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { images: [...SAMPLE_IMAGES] },
            config: {},
        });

        await persistence.save(rootPath);

        const filePath = getRepoQueueFilePath(dataDir, rootPath);
        const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        expect(state.pending).toHaveLength(1);
        const payload = state.pending[0].payload;
        expect(payload.images).toEqual([]);
        expect(payload.imagesCount).toBe(2);
        expect(payload.imagesFilePath).toContain('.images.json');
    });
});

// ============================================================================
// Round-trip: save → restore → verify metadata
// ============================================================================

describe('Round-trip with image externalization', () => {
    let queueManager: TaskQueueManager;
    let persistence: QueuePersistence;

    function createManager(options: Partial<TaskQueueManagerOptions> = {}): TaskQueueManager {
        return new TaskQueueManager({
            maxQueueSize: 0,
            keepHistory: true,
            maxHistorySize: 100,
            ...options,
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        queueManager = createManager();
    });

    afterEach(() => {
        if (persistence) {
            persistence.dispose();
        }
        vi.useRealTimers();
    });

    async function flushSave(): Promise<void> {
        await vi.advanceTimersByTimeAsync(400);
    }

    it('restored task has imagesFilePath and imagesCount but no inline images', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/roundtrip-images';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, images: [...SAMPLE_IMAGES] },
            config: {},
        });

        await (persistence as any).save();
        persistence.dispose();
        persistence = undefined!;

        // Restore into a new instance
        const qm2 = createManager();
        const p2 = new QueuePersistence(qm2, dataDir);
        p2.restore();

        const queued = qm2.getQueued();
        expect(queued).toHaveLength(1);

        const payload = queued[0].payload as any;
        expect(payload.imagesFilePath).toContain('.images.json');
        expect(payload.imagesCount).toBe(2);
        expect(payload.images).toEqual([]);

        // Blob file should exist and contain the original images
        const loaded = await ImageBlobStore.loadImages(payload.imagesFilePath);
        expect(loaded).toEqual(SAMPLE_IMAGES);

        p2.dispose();
    });

    it('restored task without images has no externalization metadata', async () => {
        persistence = new QueuePersistence(queueManager, dataDir);
        const rootPath = '/repo/roundtrip-no-images';

        queueManager.enqueue({
            type: 'custom',
            priority: 'normal',
            payload: { workingDirectory: rootPath, prompt: 'hello' },
            config: {},
        });

        await flushSave();
        persistence.dispose();
        persistence = undefined!;

        const qm2 = createManager();
        const p2 = new QueuePersistence(qm2, dataDir);
        p2.restore();

        const queued = qm2.getQueued();
        expect(queued).toHaveLength(1);

        const payload = queued[0].payload as any;
        expect(payload.imagesFilePath).toBeUndefined();
        expect(payload.imagesCount).toBeUndefined();
        expect(payload.prompt).toBe('hello');

        p2.dispose();
    });
});
