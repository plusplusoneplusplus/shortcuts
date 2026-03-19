/**
 * FileProcessStore Retry Tests — Per-Workspace Paths
 *
 * Verifies that atomic writes retry on transient FS errors and
 * propagate non-retryable errors immediately.
 * Uses vi.mock to intercept fs/promises.rename and fs/promises.writeFile.
 * Path assertions use the per-workspace layout: processes/<workspaceId>/<id>.json
 * and processes/_id-map.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

import { isRetryExhaustedError } from '../src/runtime/retry';

// ---- module-level mock ----
const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');

type InterceptorFn = (original: (...args: any[]) => Promise<any>, ...args: any[]) => Promise<any>;

let renameInterceptor: InterceptorFn | null = null;
let writeFileInterceptor: InterceptorFn | null = null;

vi.mock('fs/promises', async () => {
    const real = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    return {
        ...real,
        rename: vi.fn(async (...args: any[]) => {
            if (renameInterceptor) {
                return renameInterceptor(real.rename as any, ...args);
            }
            return (real.rename as any)(...args);
        }),
        writeFile: vi.fn(async (...args: any[]) => {
            if (writeFileInterceptor) {
                return writeFileInterceptor(real.writeFile as any, ...args);
            }
            return (real.writeFile as any)(...args);
        }),
    };
});

import type { AIProcess, AIProcessStatus } from '../src/index';

const { FileProcessStore } = await import('../src/index');

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        ...overrides,
    };
}

function makeErrnoError(code: string, message?: string): NodeJS.ErrnoException {
    const err = new Error(message ?? `${code} error`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
}

describe('FileProcessStore - Retry on atomic writes (per-workspace paths)', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await actualFs.mkdtemp(path.join(os.tmpdir(), 'fps-retry-test-'));
        renameInterceptor = null;
        writeFileInterceptor = null;
    });

    afterEach(async () => {
        renameInterceptor = null;
        writeFileInterceptor = null;
        await actualFs.rm(tmpDir, { recursive: true, force: true });
    });

    // 20. Retry on EBUSY writing process file at processes/ws-a/<id>.json
    it('should retry and succeed when process file rename fails twice with EBUSY', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const p = makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            const dest = path.basename(args[1] as string);
            if (dest === 'p1.json') {
                callCount++;
                if (callCount <= 2) {
                    throw makeErrnoError('EBUSY', 'resource busy');
                }
            }
            return real(...args);
        };

        await store.addProcess(p);
        const retrieved = await store.getProcess('p1', 'ws-a');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe('p1');
        expect(callCount).toBeGreaterThan(2);
    });

    // 21. Retry on EBUSY writing _id-map.json
    it('should retry and succeed when _id-map.json rename fails twice with EBUSY', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            const dest = path.basename(args[1] as string);
            if (dest === '_id-map.json') {
                callCount++;
                if (callCount <= 2) {
                    throw makeErrnoError('EBUSY', 'resource busy');
                }
            }
            return real(...args);
        };

        await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        const p = await store.getProcess('p1');
        expect(p).toBeDefined();
        expect(callCount).toBeGreaterThan(2);
    });

    // 22. Non-retryable error (ENOSPC) on process file propagates immediately
    it('should propagate ENOSPC immediately without retrying on process file', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (_real, ...args) => {
            const dest = path.basename(args[1] as string);
            if (dest === 'p1.json') {
                callCount++;
                throw makeErrnoError('ENOSPC', 'no space left on device');
            }
            return _real(...args);
        };

        await expect(
            store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }))
        ).rejects.toThrow('no space left on device');
        expect(callCount).toBe(1);
    });

    // 23. RetryExhaustedError after all retries on _id-map
    it('should throw RetryExhaustedError when all retries fail on _id-map.json rename', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        renameInterceptor = async (_real, ...args) => {
            const dest = path.basename(args[1] as string);
            if (dest === '_id-map.json') {
                throw makeErrnoError('EBUSY', 'resource busy');
            }
            return _real(...args);
        };

        try {
            await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
            expect.fail('should have thrown');
        } catch (err) {
            expect(isRetryExhaustedError(err)).toBe(true);
        }
    });

    // 24. Tmp file cleanup on exhaustion
    it('should clean up .tmp files after RetryExhaustedError', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        renameInterceptor = async () => {
            throw makeErrnoError('EBUSY', 'resource busy');
        };

        try {
            await store.addProcess(makeProcess('p1', { metadata: { type: 'ai', workspaceId: 'ws-a' } }));
        } catch {
            // expected
        }

        // Check ws-a dir for .tmp files
        const wsADir = path.join(tmpDir, 'repos', 'ws-a', 'processes');
        const wsATmpFiles = await actualFs.readdir(wsADir).then(
            files => files.filter(f => f.endsWith('.tmp')),
            () => [] as string[]
        );
        expect(wsATmpFiles).toEqual([]);

        // Check repos dir for _id-map.json.tmp
        const processesDir = path.join(tmpDir, 'repos');
        const processesTmpFiles = await actualFs.readdir(processesDir).then(
            files => files.filter(f => f.endsWith('.tmp')),
            () => [] as string[]
        );
        expect(processesTmpFiles).toEqual([]);
    });
});
