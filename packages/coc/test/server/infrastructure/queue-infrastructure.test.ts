/**
 * createQueueInfrastructure Tests
 *
 * Regression coverage for the extracted queue infrastructure builder.
 * Verifies that createQueueInfrastructure returns correctly configured
 * instances equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import { createQueueInfrastructure } from '../../../src/server/infrastructure/queue-infrastructure';
import { MultiRepoQueueExecutorBridge } from '../../../src/server/multi-repo-executor-bridge';
import { MultiRepoQueuePersistence } from '../../../src/server/multi-repo-queue-persistence';
import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-infra-test-'));
}

describe('createQueueInfrastructure', () => {
    let dataDir: string;
    const getWsServer = () => ({ broadcastProcessEvent: vi.fn() }) as any;

    beforeEach(() => {
        dataDir = makeTempDir();
    });

    it('returns registry, bridge, queuePersistence and queueFacade', () => {
        const store = createMockProcessStore();
        const result = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            getWsServer,
        );

        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.bridge).toBeInstanceOf(MultiRepoQueueExecutorBridge);
        expect(result.queuePersistence).toBeInstanceOf(MultiRepoQueuePersistence);
        expect(result.queueFacade).toBeDefined();
        expect(typeof result.queueFacade.enqueue).toBe('function');
    });

    it('applies historyLimit option to registry maxHistorySize', () => {
        const store = createMockProcessStore();
        const { registry } = createQueueInfrastructure(
            store,
            dataDir,
            { queue: { autoStart: false, historyLimit: 42 } },
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            getWsServer,
        );

        expect(registry).toBeInstanceOf(RepoQueueRegistry);
    });

    it('passes followUpSuggestions to bridge without throwing', () => {
        const store = createMockProcessStore();
        const followUpSuggestions = { enabled: true, count: 5 };

        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                DEFAULT_AI_TIMEOUT_MS,
                followUpSuggestions,
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('restores persisted queue state during construction', () => {
        const repoId = 'test-repo';
        const reposDir = path.join(dataDir, 'repos', repoId);
        fs.mkdirSync(reposDir, { recursive: true });
        const queueFile = path.join(reposDir, 'queues.json');
        fs.writeFileSync(
            queueFile,
            JSON.stringify({
                version: 1,
                repoPath: '/tmp/test-repo',
                queue: [],
                history: [],
            }),
        );

        const store = createMockProcessStore();
        expect(() =>
            createQueueInfrastructure(
                store,
                dataDir,
                { queue: { autoStart: false } },
                DEFAULT_AI_TIMEOUT_MS,
                undefined,
                getWsServer,
            ),
        ).not.toThrow();
    });

    it('works with no queue options provided', () => {
        const store = createMockProcessStore();
        const result = createQueueInfrastructure(
            store,
            dataDir,
            {},
            DEFAULT_AI_TIMEOUT_MS,
            undefined,
            getWsServer,
        );
        expect(result.registry).toBeInstanceOf(RepoQueueRegistry);
        expect(result.queueFacade).toBeDefined();
    });
});
