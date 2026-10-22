import { targetToken } from '../../src/server/shared/sentinel-target-reference';
import { createFixedQueueRuntimeConfig } from '../../src/server/queue/queue-runtime-config';
import { DEFAULT_CONFIG } from '../../src/config';
/**
 * CLITaskExecutor.steerProcess() unit tests
 *
 * Verifies the steerProcess method on the queue executor bridge:
 * - Returns true when the SDK session is steered successfully
 * - Returns false when no process exists
 * - Returns false when process has no sdkSessionId
 * - Returns false when steerSession fails
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockProcessStore, createProcessFixture, createCompletedProcessWithSession } from './helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

const sdkMocks = createMockSDKService();
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

vi.mock('child_process', () => ({
    spawn: vi.fn(() => {
        const cp = new (require('events').EventEmitter)();
        (cp as any).stdout = new (require('events').EventEmitter)();
        (cp as any).stderr = new (require('events').EventEmitter)();
        (cp as any).pid = 12345;
        setTimeout(() => cp.emit('close', 0), 10);
        return cp;
    }),
}));

// Import after mocks
const { CLITaskExecutor } = await import('../../src/server/queue/queue-executor-bridge');

describe('CLITaskExecutor.steerProcess()', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let executor: InstanceType<typeof CLITaskExecutor>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
    });

    it.each([false, true])('adds exact context to Sentinel steering only behind its owner flag (enabled=%s)', async enabled => {
        const proc = createCompletedProcessWithSession('proc-1', 'sess-1');
        proc.metadata = { ...proc.metadata, mode: 'sentinel' };
        store.processes.set('proc-1', proc);
        sdkMocks.mockSteerSession.mockResolvedValue(true);
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any,
            queueConfig: createFixedQueueRuntimeConfig({ config: { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, sentinelTargetAutocomplete: enabled } } }),
        });
        const content = targetToken({ kind: 'server', serverIdentity: 'durable-target' }, '#ubuntu-arm');
        await executor.steerProcess('proc-1', content);
        const delivered = sdkMocks.mockSteerSession.mock.calls[0][1];
        if (enabled) { expect(delivered).toContain('References grant no permission'); expect(delivered).toContain('"serverIdentity":"durable-target"'); }
        else expect(delivered).toBe(content);
    });

    it('returns true when steerSession succeeds', async () => {
        store.processes.set('proc-1', createCompletedProcessWithSession('proc-1', 'sess-1'));
        sdkMocks.mockSteerSession.mockResolvedValue(true);

        const result = await executor.steerProcess!('proc-1', 'steer me');

        expect(result).toBe(true);
        expect(sdkMocks.mockSteerSession).toHaveBeenCalledWith('sess-1', 'steer me');
    });

    it('returns false when process does not exist', async () => {
        const result = await executor.steerProcess!('nonexistent', 'msg');
        expect(result).toBe(false);
        expect(sdkMocks.mockSteerSession).not.toHaveBeenCalled();
    });

    it('returns false when process has no sdkSessionId', async () => {
        store.processes.set('proc-no-sess', createProcessFixture({
            id: 'proc-no-sess',
            status: 'running',
        }));

        const result = await executor.steerProcess!('proc-no-sess', 'msg');
        expect(result).toBe(false);
        expect(sdkMocks.mockSteerSession).not.toHaveBeenCalled();
    });

    it('returns false when steerSession returns false', async () => {
        store.processes.set('proc-2', createCompletedProcessWithSession('proc-2', 'sess-2'));
        sdkMocks.mockSteerSession.mockResolvedValue(false);

        const result = await executor.steerProcess!('proc-2', 'msg');

        expect(result).toBe(false);
        expect(sdkMocks.mockSteerSession).toHaveBeenCalledWith('sess-2', 'msg');
    });

    it('returns false when steerSession throws', async () => {
        store.processes.set('proc-3', createCompletedProcessWithSession('proc-3', 'sess-3'));
        sdkMocks.mockSteerSession.mockRejectedValue(new Error('boom'));

        const result = await executor.steerProcess!('proc-3', 'msg');

        expect(result).toBe(false);
    });
});
