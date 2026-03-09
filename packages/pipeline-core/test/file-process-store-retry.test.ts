/**
 * FileProcessStore Retry Tests
 *
 * Verifies that atomic writes retry on transient FS errors and
 * propagate non-retryable errors immediately.
 *
 * Uses vi.mock to intercept fs/promises.rename and fs/promises.writeFile.
 * A shared interceptor controls per-test behavior; real implementations are
 * used by default.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

import { isRetryExhaustedError } from '../src/runtime/retry';

// ---- module-level mock ----
// importActual returns the real fs/promises so setup/teardown works normally.
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

// ---- import after mock ----
import type { AIProcess, AIProcessStatus } from '../src/index';

// Dynamic import so the mock is active when FileProcessStore loads fs/promises
const { FileProcessStore } = await import('../src/index');

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

function makeErrnoError(code: string, message?: string): NodeJS.ErrnoException {
    const err = new Error(message ?? `${code} error`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
}

describe('FileProcessStore - Retry on atomic writes', () => {
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

    it('should succeed on first attempt when no errors occur', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p1'));
        const p = await store.getProcess('p1');
        expect(p).toBeDefined();
        expect(p!.id).toBe('p1');
    });

    it('should retry and succeed when rename fails transiently with EBUSY', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            callCount++;
            if (callCount <= 2) {
                throw makeErrnoError('EBUSY', 'resource busy');
            }
            return real(...args);
        };

        await store.addProcess(makeProcess('p1'));
        const p = await store.getProcess('p1');
        expect(p).toBeDefined();
        expect(p!.id).toBe('p1');
        expect(callCount).toBeGreaterThan(2);
    });

    it('should retry and succeed when rename fails transiently with EACCES', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            callCount++;
            if (callCount === 1) {
                throw makeErrnoError('EACCES', 'permission denied');
            }
            return real(...args);
        };

        await store.addProcess(makeProcess('p1'));
        const p = await store.getProcess('p1');
        expect(p).toBeDefined();
    });

    it('should propagate ENOSPC immediately without retrying', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async () => {
            callCount++;
            throw makeErrnoError('ENOSPC', 'no space left on device');
        };

        await expect(store.addProcess(makeProcess('p1'))).rejects.toThrow('no space left on device');
        // Should have been called exactly once (no retry)
        expect(callCount).toBe(1);
    });

    it('should propagate EROFS immediately without retrying', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async () => {
            callCount++;
            throw makeErrnoError('EROFS', 'read-only filesystem');
        };

        await expect(store.addProcess(makeProcess('p1'))).rejects.toThrow('read-only filesystem');
        expect(callCount).toBe(1);
    });

    it('should throw RetryExhaustedError when all retries fail on EBUSY', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        renameInterceptor = async () => {
            throw makeErrnoError('EBUSY', 'resource busy');
        };

        try {
            await store.addProcess(makeProcess('p1'));
            expect.fail('should have thrown');
        } catch (err) {
            expect(isRetryExhaustedError(err)).toBe(true);
        }
    });

    it('should clean up .tmp file when all retries are exhausted', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await actualFs.mkdir(path.join(tmpDir, 'processes'), { recursive: true });

        renameInterceptor = async () => {
            throw makeErrnoError('EBUSY', 'resource busy');
        };

        try {
            await store.addProcess(makeProcess('p1'));
        } catch {
            // expected
        }

        const files = await actualFs.readdir(path.join(tmpDir, 'processes'));
        const tmpFiles = files.filter(f => f.endsWith('.tmp'));
        expect(tmpFiles).toEqual([]);
    });

    it('should retry workspace writes on transient errors', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            callCount++;
            if (callCount === 1) {
                throw makeErrnoError('EPERM', 'operation not permitted');
            }
            return real(...args);
        };

        await store.registerWorkspace({ id: 'ws1', name: 'Test', rootPath: '/tmp/ws' });
        const workspaces = await store.getWorkspaces();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].id).toBe('ws1');
    });

    it('should retry wiki writes on transient errors', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        renameInterceptor = async (real, ...args) => {
            callCount++;
            if (callCount === 1) {
                throw makeErrnoError('EIO', 'input/output error');
            }
            return real(...args);
        };

        await store.registerWiki({ id: 'w1', name: 'Wiki', wikiDir: '/tmp/wiki', repoPath: '/tmp/repo' });
        const wikis = await store.getWikis();
        expect(wikis).toHaveLength(1);
        expect(wikis[0].id).toBe('w1');
    });

    it('should retry when writeFile fails with a transient error', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        let callCount = 0;
        writeFileInterceptor = async (real, ...args) => {
            callCount++;
            if (callCount === 1) {
                throw makeErrnoError('EBUSY', 'resource busy');
            }
            return real(...args);
        };

        await store.addProcess(makeProcess('p1'));
        const p = await store.getProcess('p1');
        expect(p).toBeDefined();
    });

    it('should propagate non-FS errors immediately', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });

        renameInterceptor = async () => {
            throw new Error('unexpected non-FS error');
        };

        await expect(store.addProcess(makeProcess('p1'))).rejects.toThrow('unexpected non-FS error');
    });
});
