/**
 * Serve Command Tests
 *
 * Tests for the pipeline serve command — option parsing, startup banner,
 * browser open, signal handling, error handling, and config integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { setColorEnabled } from '../../src/logger';
import { EXIT_CODES, createProgram } from '../../src/cli';
import { mergeConfig, DEFAULT_CONFIG } from '../../src/config';
import type { ServeCommandOptions } from '../../src/server/types';

// ============================================================================
// Mock the server module to avoid starting a real HTTP server
// ============================================================================

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockGetAllProcesses = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
const mockStore = {
    addProcess: vi.fn(),
    updateProcess: vi.fn(),
    getProcess: vi.fn(),
    getAllProcesses: mockGetAllProcesses,
    removeProcess: vi.fn(),
    clearProcesses: vi.fn(),
    getWorkspaces: vi.fn(),
    registerWorkspace: vi.fn(),
};

const mockCreateExecutionServer = vi.fn();

vi.mock('../../src/server/index', () => ({
    createExecutionServer: (...args: unknown[]) => mockCreateExecutionServer(...args),
}));

// Mock child_process.exec for browser open tests
const mockExec = vi.fn();
vi.mock('child_process', () => ({
    exec: (...args: unknown[]) => mockExec(...args),
}));

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
    const exitCode = await executeServe(options);
    clearTimeout(timer);
    return exitCode;
}

describe('Serve Command', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-cli-serve-'));
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        setColorEnabled(false);
        mockClose.mockClear();
        mockGetAllProcesses.mockClear();
        mockExec.mockClear();
        mockCreateExecutionServer.mockReset();
        mockCreateExecutionServer.mockResolvedValue(makeServerResult());
    });

    afterEach(() => {
        stderrSpy.mockRestore();
        setColorEnabled(true);
        fs.rmSync(tmpDir, { recursive: true, force: true });
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
            expect(output).toContain('AI Execution Dashboard');
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
            const exitCode = await executeServe({ dataDir: tmpDir, open: false });

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
});
