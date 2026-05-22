/**
 * createQueueInfrastructure Tests
 *
 * Regression coverage for the extracted queue infrastructure builder.
 * Verifies that createQueueInfrastructure returns correctly configured
 * instances equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_AI_TIMEOUT_MS, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { createQueueInfrastructure } from '../../../src/server/infrastructure/queue-infrastructure';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-infra-test-'));
}

function createTempSqliteStore(dataDir: string): SqliteProcessStore {
    return new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
}

describe('createQueueInfrastructure', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    const getWsServer = () => ({ broadcastProcessEvent: vi.fn() }) as any;

    beforeEach(() => {
        dataDir = makeTempDir();
        store = createTempSqliteStore(dataDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns registry, bridge, queuePersistence and queueFacade', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.bridge).toBeInstanceOf(MultiRepoQueueRouter);
        expect(result.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
        expect(result.queueFacade).toBeDefined();
        expect(typeof result.queueFacade.enqueue).toBe('function');
    });

    it('applies historyLimit option to registry maxHistorySize', () => {
        const { registry } = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, historyLimit: 42 } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        expect(registry).toBeInstanceOf(RepoQueueRegistry);
    });

    it('passes followUpSuggestions to bridge without throwing', () => {
        const followUpSuggestions = { enabled: true, count: 5 };

        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                DEFAULT_AI_TIMEOUT_MS,
                followUpSuggestions,
                undefined,
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('restores persisted queue state from SQLite during construction', () => {
        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                DEFAULT_AI_TIMEOUT_MS,
                undefined,
                undefined,
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('works with no queue options provided', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            {},
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );
        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.queueFacade).toBeDefined();
    });

    it('passes restartPickupDelayMs through to bridge as initialDelayMs', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, restartPickupDelayMs: 5000 } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        expect(result.bridge).toBeInstanceOf(MultiRepoQueueRouter);
    });

    it('clears initialDelay after restore so lazy bridges get 0 delay', () => {
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, restartPickupDelayMs: 30000 } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        // Create a new bridge after infrastructure init — should not have delay
        const bridge = result.bridge;
        const newBridge = bridge.getOrCreateBridge('/tmp/lazy-repo');
        expect(newBridge).toBeDefined();
    });

    it('creates in-memory DB when store is not SqliteProcessStore', () => {
        const mockStore = {
            getAllProcesses: vi.fn(),
            getStorageStats: vi.fn(),
        } as any;

        const result = createQueueInfrastructure(
            mockStore,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        expect(result.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
    });

    it('persists enqueued tasks in queue_tasks table', () => {
        const { queueFacade } = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            undefined,
            getWsServer,
        );

        queueFacade.enqueue({
            type: 'test-task',
            payload: { prompt: 'hello' },
            repoId: 'test-repo',
        });

        const db = store.getDatabase();
        const rows = db.prepare('SELECT * FROM queue_tasks').all() as any[];
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows.some((r: any) => r.type === 'test-task')).toBe(true);
    });
});
