/**
 * Tests for WindowFocusService
 *
 * Tests the Windows-specific window focusing functionality.
 * Uses dependency injection to mock spawn for cross-platform testing.
 */

import * as assert from 'assert';
import { ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { WindowFocusService } from '../../shortcuts/ai-service/window-focus-service';
import { InteractiveSession, TerminalType } from '../../shortcuts/ai-service/types';

// ============================================================================
// Mock Types
// ============================================================================

interface SpawnCall {
    cmd: string;
    args: string[];
    options: SpawnOptions;
}

interface MockChildProcess extends EventEmitter {
    pid: number;
    stdout: EventEmitter | null;
    stderr: EventEmitter | null;
    stdin: null;
    killed: boolean;
    exitCode: number | null;
    signalCode: string | null;
}

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock spawn function that simulates PowerShell execution
 */
function createMockSpawn(options: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    shouldError?: boolean;
    errorMessage?: string;
}): {
    fn: typeof import('child_process').spawn;
    calls: SpawnCall[];
} {
    const calls: SpawnCall[] = [];

    const fn = ((cmd: string, args: string[], spawnOptions: SpawnOptions) => {
        calls.push({ cmd, args, options: spawnOptions });

        const mockProcess: MockChildProcess = Object.assign(new EventEmitter(), {
            pid: 12345,
            stdout: new EventEmitter(),
            stderr: new EventEmitter(),
            stdin: null,
            killed: false,
            exitCode: null,
            signalCode: null
        });

        // Simulate async behavior
        setImmediate(() => {
            if (options.shouldError) {
                mockProcess.emit('error', new Error(options.errorMessage || 'Spawn error'));
                return;
            }

            if (options.stdout && mockProcess.stdout) {
                mockProcess.stdout.emit('data', Buffer.from(options.stdout));
            }

            if (options.stderr && mockProcess.stderr) {
                mockProcess.stderr.emit('data', Buffer.from(options.stderr));
            }

            mockProcess.emit('close', options.exitCode ?? 0);
        });

        return mockProcess as unknown as ChildProcess;
    }) as typeof import('child_process').spawn;

    return { fn, calls };
}

/**
 * Create a mock session for testing
 */
function createMockSession(overrides: Partial<InteractiveSession> = {}): InteractiveSession {
    return {
        id: 'test-session-1',
        startTime: new Date(),
        status: 'active',
        workingDirectory: 'C:\\Projects\\test',
        tool: 'copilot',
        terminalType: 'powershell',
        pid: 12345,
        ...overrides
    };
}

// ============================================================================
// Platform Support Tests
// ============================================================================

suite('WindowFocusService - Platform Support', () => {
    test('should report supported on Windows', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isSupported(), true);
    });

    test('should report not supported on macOS', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('darwin', spawnFn);

        assert.strictEqual(service.isSupported(), false);
    });

    test('should report not supported on Linux', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('linux', spawnFn);

        assert.strictEqual(service.isSupported(), false);
    });

    test('should return correct platform', () => {
        const { fn: spawnFn } = createMockSpawn({});

        const win32Service = new WindowFocusService('win32', spawnFn);
        assert.strictEqual(win32Service.getPlatform(), 'win32');

        const darwinService = new WindowFocusService('darwin', spawnFn);
        assert.strictEqual(darwinService.getPlatform(), 'darwin');

        const linuxService = new WindowFocusService('linux', spawnFn);
        assert.strictEqual(linuxService.getPlatform(), 'linux');
    });
});

// ============================================================================
// Terminal Type Support Tests
// ============================================================================

suite('WindowFocusService - Terminal Type Support', () => {
    test('should support cmd terminal on Windows', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isTerminalSupported('cmd'), true);
    });

    test('should support PowerShell terminal on Windows', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isTerminalSupported('powershell'), true);
    });

    test('should not support Windows Terminal (single process for tabs)', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isTerminalSupported('windows-terminal'), false);
    });

    test('should not support any terminal on non-Windows platforms', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('darwin', spawnFn);

        assert.strictEqual(service.isTerminalSupported('cmd'), false);
        assert.strictEqual(service.isTerminalSupported('powershell'), false);
        assert.strictEqual(service.isTerminalSupported('terminal.app'), false);
    });

    test('should not support macOS terminals', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isTerminalSupported('terminal.app'), false);
        assert.strictEqual(service.isTerminalSupported('iterm'), false);
    });

    test('should not support Linux terminals', () => {
        const { fn: spawnFn } = createMockSpawn({});
        const service = new WindowFocusService('win32', spawnFn);

        assert.strictEqual(service.isTerminalSupported('gnome-terminal'), false);
        assert.strictEqual(service.isTerminalSupported('konsole'), false);
    });
});

// ============================================================================
// Focus Session Tests - Success Cases
// ============================================================================

suite('WindowFocusService - Focus Session Success', () => {
    test('should successfully focus PowerShell session on Windows', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ terminalType: 'powershell', pid: 54321 });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.error, undefined);

        // Verify PowerShell was called with correct command
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].cmd, 'powershell');
        assert.ok(calls[0].args.includes('-Command'));
        assert.ok(calls[0].args.some(arg => arg.includes('AppActivate')));
        assert.ok(calls[0].args.some(arg => arg.includes('54321')));
    });

    test('should successfully focus cmd session on Windows', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ terminalType: 'cmd', pid: 99999 });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, true);
        assert.ok(calls[0].args.some(arg => arg.includes('99999')));
    });

    test('should handle session in starting status', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ status: 'starting' });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, true);
    });
});

// ============================================================================
// Focus Session Tests - Failure Cases
// ============================================================================

suite('WindowFocusService - Focus Session Failures', () => {
    test('should fail on non-Windows platform', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({});

        const service = new WindowFocusService('darwin', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('not supported'));
        assert.ok(result.error?.includes('darwin'));
        assert.strictEqual(calls.length, 0); // Should not call PowerShell
    });

    test('should fail when session has no PID', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({});

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ pid: undefined });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('process ID'));
        assert.strictEqual(calls.length, 0);
    });

    test('should fail when session status is ended', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({});

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ status: 'ended' });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('status'));
        assert.ok(result.error?.includes('ended'));
        assert.strictEqual(calls.length, 0);
    });

    test('should fail when session status is error', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({});

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ status: 'error' });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('status'));
        assert.strictEqual(calls.length, 0);
    });

    test('should fail when AppActivate returns False (window not found)', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 0,
            stdout: 'False'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ pid: 12345 });

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('not found'));
        assert.ok(result.error?.includes('12345'));
    });

    test('should fail when PowerShell command fails', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 1,
            stderr: 'Some PowerShell error'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('failed'));
        assert.ok(result.error?.includes('Some PowerShell error'));
    });

    test('should fail when spawn throws an error', async () => {
        const { fn: spawnFn } = createMockSpawn({
            shouldError: true,
            errorMessage: 'PowerShell not found'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('PowerShell not found'));
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

suite('WindowFocusService - Edge Cases', () => {
    test('should handle empty stdout gracefully', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 0,
            stdout: ''
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        // Empty stdout means False (window not found)
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('not found'));
    });

    test('should handle stdout with whitespace', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 0,
            stdout: '  True  \n'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, true);
    });

    test('should handle case-insensitive True/False', async () => {
        const { fn: spawnFn } = createMockSpawn({
            exitCode: 0,
            stdout: 'TRUE'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        const result = await service.focusSession(session);

        assert.strictEqual(result.success, true);
    });

    test('should use shell option in spawn', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession();

        await service.focusSession(session);

        assert.strictEqual(calls[0].options.shell, true);
    });
});

// ============================================================================
// PowerShell Command Tests
// ============================================================================

suite('WindowFocusService - PowerShell Command', () => {
    test('should use WScript.Shell AppActivate method', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ pid: 11111 });

        await service.focusSession(session);

        const command = calls[0].args.find(arg => arg.includes('AppActivate'));
        assert.ok(command);
        assert.ok(command.includes('WScript.Shell'));
        assert.ok(command.includes('11111'));
    });

    test('should construct correct PowerShell command format', async () => {
        const { fn: spawnFn, calls } = createMockSpawn({
            exitCode: 0,
            stdout: 'True'
        });

        const service = new WindowFocusService('win32', spawnFn);
        const session = createMockSession({ pid: 22222 });

        await service.focusSession(session);

        assert.strictEqual(calls[0].cmd, 'powershell');
        assert.deepStrictEqual(calls[0].args[0], '-Command');

        const psCommand = calls[0].args[1];
        assert.ok(psCommand.includes('New-Object'));
        assert.ok(psCommand.includes('-ComObject'));
        assert.ok(psCommand.includes('WScript.Shell'));
        assert.ok(psCommand.includes('AppActivate'));
        assert.ok(psCommand.includes('22222'));
    });
});

// ============================================================================
// Singleton Pattern Tests
// ============================================================================

suite('WindowFocusService - Singleton', () => {
    test('getWindowFocusService should return same instance', async () => {
        // Import the singleton functions
        const { getWindowFocusService, resetWindowFocusService } = await import(
            '../../shortcuts/ai-service/window-focus-service'
        );

        // Reset to get fresh instance
        resetWindowFocusService();

        const instance1 = getWindowFocusService();
        const instance2 = getWindowFocusService();

        assert.strictEqual(instance1, instance2);

        // Clean up
        resetWindowFocusService();
    });

    test('resetWindowFocusService should create new instance', async () => {
        const { getWindowFocusService, resetWindowFocusService } = await import(
            '../../shortcuts/ai-service/window-focus-service'
        );

        resetWindowFocusService();
        const instance1 = getWindowFocusService();

        resetWindowFocusService();
        const instance2 = getWindowFocusService();

        assert.notStrictEqual(instance1, instance2);

        // Clean up
        resetWindowFocusService();
    });
});
