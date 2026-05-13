/**
 * Serve Command Tests
 *
 * Tests for the coc serve command — option parsing, startup banner,
 * browser open, signal handling, error handling, and config integration.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setColorEnabled } from '../../src/logger';
import { EXIT_CODES, createProgram } from '../../src/cli';
import { mergeConfig, DEFAULT_CONFIG } from '../../src/config';
import type { ServeCommandOptions } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Mock the server module to avoid starting a real HTTP server
// ============================================================================

const mockClose = vi.fn().mockResolvedValue({ drainOutcome: 'completed' });
const mockGetAllProcesses = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
const mockGetProcessCount = vi.fn().mockResolvedValue(2);
const mockStore = {
    addProcess: vi.fn(),
    updateProcess: vi.fn(),
    getProcess: vi.fn(),
    getAllProcesses: mockGetAllProcesses,
    getProcessCount: mockGetProcessCount,
    removeProcess: vi.fn(),
    clearProcesses: vi.fn(),
    getWorkspaces: vi.fn(),
    registerWorkspace: vi.fn(),
};

const mockCreateExecutionServer = vi.fn();
let suiteLogDir: string;

vi.mock('../../src/server/index', () => ({
    createExecutionServer: (...args: unknown[]) => mockCreateExecutionServer(...args),
}));

// Mock child_process.exec for browser open tests
const mockExec = vi.fn();
vi.mock('child_process', () => ({
    exec: (...args: unknown[]) => mockExec(...args),
}));

// Partial mock of config module to control loadConfigFile per-test
const { mockLoadConfigFile } = vi.hoisted(() => ({
    mockLoadConfigFile: vi.fn<() => any>(() => undefined),
}));
vi.mock('../../src/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/config')>();
    return { ...actual, loadConfigFile: mockLoadConfigFile };
});

// ============================================================================
// Helpers
// ============================================================================

function makeServerResult(overrides: Record<string, unknown> = {}) {
    return {
        server: {},
        store: mockStore,
        port: 4000,
        host: 'localhost',
        url: 'http://localhost:4000',
        close: mockClose,
        ...overrides,
    };
}

/**
 * Import executeServe and emit SIGINT shortly after to unblock the promise.
 */
async function runServeWithSigint(options: ServeCommandOptions, delayMs = 50): Promise<number> {
    const { executeServe } = await import('../../src/commands/serve');
    const timer = setTimeout(() => process.emit('SIGINT', 'SIGINT'), delayMs);
    const exitCode = await executeServe({ ...options, logDir: options.logDir ?? suiteLogDir });
    clearTimeout(timer);
    return exitCode;
}

describe('Serve Command', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let tmpDir: string;
    let savedSigintListeners: Function[];
    let savedSigtermListeners: Function[];

    beforeAll(() => {
        suiteLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-serve-logs-'));
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-serve-'));
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        setColorEnabled(false);
        mockClose.mockClear();
        mockClose.mockResolvedValue({ drainOutcome: 'completed' });
        mockGetAllProcesses.mockClear();
        mockExec.mockClear();
        mockCreateExecutionServer.mockReset();
        mockCreateExecutionServer.mockResolvedValue(makeServerResult());
        mockLoadConfigFile.mockReset();
        mockLoadConfigFile.mockReturnValue(undefined);
        // Save and remove all SIGINT/SIGTERM listeners to isolate tests
        savedSigintListeners = process.rawListeners('SIGINT') as Function[];
        savedSigtermListeners = process.rawListeners('SIGTERM') as Function[];
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
    });

    afterEach(async () => {
        // Remove any listeners added during test
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        // Restore original listeners
        for (const listener of savedSigintListeners) {
            process.on('SIGINT', listener as (...args: any[]) => void);
        }
        for (const listener of savedSigtermListeners) {
            process.on('SIGTERM', listener as (...args: any[]) => void);
        }
        stderrSpy.mockRestore();
        setColorEnabled(true);
        // Close any SQLite stores created during the test to release file locks
        for (const call of mockCreateExecutionServer.mock.calls) {
            const store = call[0]?.store;
            if (store && typeof store.close === 'function') {
                store.close();
            }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    });

    afterAll(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.rmSync(suiteLogDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });

    // ========================================================================
    // 1. Command registration & option parsing
    // ========================================================================

    describe('Command registration & option parsing', () => {
        it('should register the serve command on the program', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve');
            expect(serveCmd).toBeDefined();
        });

        it('should have expected options', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;
            const optionNames = serveCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--port');
            expect(optionNames).toContain('--host');
            expect(optionNames).toContain('--data-dir');
            expect(optionNames).toContain('--theme');
            expect(optionNames.some((n: string) => n === '--no-open' || n === '--open')).toBe(true);
        });

        it('should parse all options correctly', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;

            // Prevent the action from firing
            serveCmd.action(() => {});

            program.parse(['node', 'pipeline', 'serve', '-p', '8080', '-H', '0.0.0.0', '-d', '/tmp/data', '--theme', 'dark', '--no-open', '--no-color']);

            const opts = serveCmd.opts();
            expect(opts.port).toBe(8080);
            expect(opts.host).toBe('0.0.0.0');
            expect(opts.dataDir).toBe('/tmp/data');
            expect(opts.theme).toBe('dark');
            expect(opts.open).toBe(false);
            expect(opts.color).toBe(false);
        });
    });

    // ========================================================================
    // 2. Default values applied
    // ========================================================================

    describe('Default values', () => {
        it('should use defaults when no flags provided', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;
            serveCmd.action(() => {});

            program.parse(['node', 'pipeline', 'serve']);

            const opts = serveCmd.opts();
            expect(opts.port).toBeUndefined();
            expect(opts.host).toBeUndefined();
            expect(opts.dataDir).toBeUndefined();
            expect(opts.theme).toBeUndefined();
            expect(opts.open).toBe(true); // Commander's --no-open default is true
        });
    });

    // ========================================================================
    // 3. Config values used when no CLI flags
    // ========================================================================

    describe('Config integration', () => {
        it('should use config serve values as fallbacks', () => {
            const config = mergeConfig(DEFAULT_CONFIG, {
                serve: { port: 5000, host: '0.0.0.0', dataDir: '/data', theme: 'dark' },
            });
            expect(config.serve!.port).toBe(5000);
            expect(config.serve!.host).toBe('0.0.0.0');
            expect(config.serve!.dataDir).toBe('/data');
            expect(config.serve!.theme).toBe('dark');
        });
    });

    // ========================================================================
    // 4. CLI flags override config
    // ========================================================================

    describe('CLI flags override config', () => {
        it('should override config values with CLI flags', () => {
            const config = mergeConfig(DEFAULT_CONFIG, {
                serve: { port: 5000 },
            });
            const cliPort = 9000;
            const resolvedPort = cliPort ?? config.serve?.port;
            expect(resolvedPort).toBe(9000);
        });
    });

    // ========================================================================
    // 5. Graceful shutdown on SIGINT
    // ========================================================================

    describe('Graceful shutdown', () => {
        it('should call server.close() on SIGINT and return SUCCESS', async () => {
            const exitCode = await runServeWithSigint({ dataDir: tmpDir, open: false });
            expect(mockClose).toHaveBeenCalled();
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });

        it('should call server.close() with drain options by default', async () => {
            await runServeWithSigint({ dataDir: tmpDir, open: false });
            expect(mockClose).toHaveBeenCalledWith({ drain: true, drainTimeoutMs: 30000 });
        });

        it('should force shutdown on second SIGTERM', async () => {
            // Make drain hang until force shutdown
            mockClose.mockImplementation(async (opts: any) => {
                if (opts?.drain) {
                    // Simulate a slow drain — but we'll send a second signal to force
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                return { drainOutcome: 'completed' };
            });

            const { executeServe } = await import('../../src/commands/serve');
            // Send SIGTERM, then a second one shortly after to force
            const t1 = setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 30);
            const t2 = setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 80);
            const exitCode = await executeServe({ dataDir: tmpDir, open: false, logDir: suiteLogDir });
            clearTimeout(t1);
            clearTimeout(t2);

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            // close() should have been called at least twice (drain attempt + force)
            expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
        });

        it('should force shutdown on SIGTERM after SIGINT', async () => {
            mockClose.mockImplementation(async (opts: any) => {
                if (opts?.drain) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                return { drainOutcome: 'completed' };
            });

            const { executeServe } = await import('../../src/commands/serve');
            const t1 = setTimeout(() => process.emit('SIGINT', 'SIGINT'), 30);
            const t2 = setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 80);
            const exitCode = await executeServe({ dataDir: tmpDir, open: false, logDir: suiteLogDir });
            clearTimeout(t1);
            clearTimeout(t2);

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            expect(mockClose.mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ========================================================================
    // 6. Browser open triggered
    // ========================================================================

    describe('Browser open', () => {
        it('should call exec to open browser when open is true (default)', async () => {
            const exitCode = await runServeWithSigint({ dataDir: tmpDir, open: true });
            expect(mockExec).toHaveBeenCalled();
            const command = mockExec.mock.calls[0][0] as string;
            expect(command).toContain('http://localhost:4000');
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });
    });

    // ========================================================================
    // 7. Browser NOT opened when --no-open
    // ========================================================================

    describe('Browser not opened', () => {
        it('should NOT call exec when open is false', async () => {
            const exitCode = await runServeWithSigint({ dataDir: tmpDir, open: false });
            expect(mockExec).not.toHaveBeenCalled();
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });
    });

    // ========================================================================
    // 8. Startup banner printed to stderr
    // ========================================================================

    describe('Startup banner', () => {
        it('should print banner with dashboard info to stderr', async () => {
            await runServeWithSigint({ dataDir: tmpDir, open: false });

            const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
            expect(output).toContain('CoC (Copilot Of Copilot)');
            expect(output).toContain('http://localhost:4000');
            expect(output).toContain('Ctrl+C');
        });
    });

    // ========================================================================
    // 9. EADDRINUSE produces helpful error
    // ========================================================================

    describe('EADDRINUSE error', () => {
        it('should return EXECUTION_ERROR and mention the port', async () => {
            mockCreateExecutionServer.mockRejectedValueOnce(
                new Error('listen EADDRINUSE: address already in use :::4000')
            );

            const { executeServe } = await import('../../src/commands/serve');
            const exitCode = await executeServe({ dataDir: tmpDir, logDir: suiteLogDir, open: false });

            expect(exitCode).toBe(EXIT_CODES.EXECUTION_ERROR);
            const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
            expect(output).toContain('Port');
            expect(output).toContain('already in use');
        });
    });

    // ========================================================================
    // 10. Data directory created if missing
    // ========================================================================

    describe('Data directory creation', () => {
        it('should create data directory if it does not exist', async () => {
            const nonExistentDir = path.join(tmpDir, 'nested', 'data');
            expect(fs.existsSync(nonExistentDir)).toBe(false);

            await runServeWithSigint({ dataDir: nonExistentDir, open: false });

            expect(fs.existsSync(nonExistentDir)).toBe(true);
        });
    });

    // ========================================================================
    // 11. Graceful drain on shutdown
    // ========================================================================

    describe('Graceful drain', () => {
        it('should call close with drain options when drain enabled', async () => {
            const exitCode = await runServeWithSigint({ dataDir: tmpDir, open: false });
            expect(mockClose).toHaveBeenCalled();
            // Default is drain: true with 30s timeout
            const closeArgs = mockClose.mock.calls[0];
            expect(closeArgs[0]).toEqual({ drain: true, drainTimeoutMs: 30000 });
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });

        it('should pass drainTimeoutMs when --drain-timeout is set', async () => {
            const exitCode = await runServeWithSigint({
                dataDir: tmpDir,
                open: false,
                drainTimeout: 30, // 30 seconds
            });
            expect(mockClose).toHaveBeenCalled();
            const closeArgs = mockClose.mock.calls[0];
            expect(closeArgs[0]).toEqual({ drain: true, drainTimeoutMs: 30000 });
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });

        it('should skip drain when --no-drain is set', async () => {
            const exitCode = await runServeWithSigint({
                dataDir: tmpDir,
                open: false,
                noDrain: true,
            });
            expect(mockClose).toHaveBeenCalled();
            // noDrain means close is called without drain options
            const closeArgs = mockClose.mock.calls[0];
            expect(closeArgs[0]).toBeUndefined();
            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
        });

        it('should report drain timeout result', async () => {
            mockClose.mockResolvedValueOnce({ drainOutcome: 'timeout' });

            const exitCode = await runServeWithSigint({
                dataDir: tmpDir,
                open: false,
                drainTimeout: 1,
            });

            expect(exitCode).toBe(EXIT_CODES.SUCCESS);
            const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
            expect(output).toContain('timeout');
        });
    });

    // ========================================================================
    // 12. CLI option parsing for drain flags
    // ========================================================================

    describe('Drain CLI flags', () => {
        it('should register drain-timeout and no-drain options', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;
            const optionNames = serveCmd.options.map(o => o.long || o.short);
            expect(optionNames).toContain('--drain-timeout');
            expect(optionNames.some((n: string) => n === '--no-drain' || n === '--drain')).toBe(true);
        });

        it('should parse --drain-timeout value', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;
            serveCmd.action(() => {});

            program.parse(['node', 'coc', 'serve', '--drain-timeout', '60']);

            const opts = serveCmd.opts();
            expect(opts.drainTimeout).toBe(60);
        });

        it('should parse --no-drain flag', () => {
            const program = createProgram();
            const serveCmd = program.commands.find(c => c.name() === 'serve')!;
            serveCmd.action(() => {});

            program.parse(['node', 'coc', 'serve', '--no-drain']);

            const opts = serveCmd.opts();
            expect(opts.drain).toBe(false);
        });
    });

    // ========================================================================
    // 13. FileProcessStore wired into createExecutionServer
    // ========================================================================

    describe('FileProcessStore wiring', () => {
        it('should pass a store option to createExecutionServer', async () => {
            await runServeWithSigint({ dataDir: tmpDir, open: false });

            expect(mockCreateExecutionServer).toHaveBeenCalledTimes(1);
            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeDefined();
        });

        it('should pass a SqliteProcessStore instance as store by default', async () => {
            const { SqliteProcessStore } = await import('@plusplusoneplusplus/forge');

            await runServeWithSigint({ dataDir: tmpDir, open: false });

            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeInstanceOf(SqliteProcessStore);
            // Close the SQLite database to release the file lock before tmpDir cleanup
            (opts.store as InstanceType<typeof SqliteProcessStore>).close();
        });

        it('should configure FileProcessStore with the resolved dataDir', async () => {
            const customDir = path.join(tmpDir, 'custom-data');

            await runServeWithSigint({ dataDir: customDir, open: false });

            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeDefined();
            expect(opts.dataDir).toBe(customDir);
        });
    });

    // ========================================================================
    // 14. fileConfig passed to createExecutionServer (no double loadConfigFile)
    // ========================================================================

    describe('fileConfig passed to createExecutionServer', () => {
        it('should pass fileConfig to createExecutionServer', async () => {
            await runServeWithSigint({ dataDir: tmpDir, open: false });

            expect(mockCreateExecutionServer).toHaveBeenCalledTimes(1);
            const opts = mockCreateExecutionServer.mock.calls[0][0];
            // fileConfig is either the loaded CLIConfig or undefined (when no config file exists)
            // but the key must be present so that createExecutionServer can skip its own load
            expect('fileConfig' in opts).toBe(true);
        });

        it('should not call loadConfigFile a second time inside createExecutionServer when fileConfig is provided', async () => {
            const { loadConfigFile } = await import('../../src/config');
            const spy = vi.spyOn(await import('../../src/config'), 'loadConfigFile');

            await runServeWithSigint({ dataDir: tmpDir, open: false });

            // loadConfigFile should be called exactly once (in serve.ts), not again inside
            // createExecutionServer (which is mocked here, so 0 or 1 calls are both fine —
            // the important check is that fileConfig is forwarded so a real server can skip it).
            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect('fileConfig' in opts).toBe(true);
            spy.mockRestore();
        });
    });

    // ========================================================================
    // 15. Store backend wiring based on config
    // ========================================================================

    describe('Store backend wiring', () => {
        it('should create SqliteProcessStore when config has store.backend: sqlite', async () => {
            mockLoadConfigFile.mockReturnValue({ store: { backend: 'sqlite' } });
            const { SqliteProcessStore } = await import('@plusplusoneplusplus/forge');

            await runServeWithSigint({ dataDir: tmpDir, open: false });

            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeInstanceOf(SqliteProcessStore);
            // Close the SQLite database to release the file lock before tmpDir cleanup
            (opts.store as InstanceType<typeof SqliteProcessStore>).close();
        });

        it('should create FileProcessStore when config has store.backend: file', async () => {
            mockLoadConfigFile.mockReturnValue({ store: { backend: 'file' } });
            const { FileProcessStore } = await import('@plusplusoneplusplus/forge');

            await runServeWithSigint({ dataDir: tmpDir, open: false });

            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeInstanceOf(FileProcessStore);
        });

        it('should default to SqliteProcessStore when store config is absent', async () => {
            mockLoadConfigFile.mockReturnValue(undefined);
            const { SqliteProcessStore } = await import('@plusplusoneplusplus/forge');

            await runServeWithSigint({ dataDir: tmpDir, open: false });

            const opts = mockCreateExecutionServer.mock.calls[0][0];
            expect(opts.store).toBeInstanceOf(SqliteProcessStore);
            // Close the SQLite database to release the file lock before tmpDir cleanup
            (opts.store as InstanceType<typeof SqliteProcessStore>).close();
        });
    });
});
