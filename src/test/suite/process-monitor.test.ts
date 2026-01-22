/**
 * Tests for ProcessMonitor
 *
 * Tests for monitoring external terminal processes and detecting termination.
 * Covers platform-specific behavior (Windows/Unix), polling, and callbacks.
 */

import * as assert from 'assert';
import {
    ProcessMonitor,
    ProcessMonitorOptions,
    DEFAULT_POLL_INTERVAL_MS
} from '../../shortcuts/ai-service/process-monitor';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock execSync function that returns process running
 */
function createMockExecSyncRunning(): typeof import('child_process').execSync {
    return (() => Buffer.from('process info')) as unknown as typeof import('child_process').execSync;
}

/**
 * Create a mock execSync function that throws (process not running)
 */
function createMockExecSyncNotRunning(): typeof import('child_process').execSync {
    return (() => {
        throw new Error('Process not found');
    }) as unknown as typeof import('child_process').execSync;
}

/**
 * Create a mock execSync function for Windows that returns process running
 */
function createMockExecSyncWindowsRunning(pid: number): typeof import('child_process').execSync {
    return (() => Buffer.from(`Image Name                     PID Session Name        Session#    Mem Usage
========================= ======== ================ =========== ============
node.exe                     ${pid} Console                    1     50,000 K`)) as unknown as typeof import('child_process').execSync;
}

/**
 * Create a mock execSync function for Windows that returns process not running
 */
function createMockExecSyncWindowsNotRunning(): typeof import('child_process').execSync {
    return (() => Buffer.from('INFO: No tasks are running which match the specified criteria.')) as unknown as typeof import('child_process').execSync;
}

/**
 * Create a mock execSync function that tracks calls
 */
function createMockExecSyncWithTracking(
    runningPids: Set<number>
): { execSync: typeof import('child_process').execSync; calls: string[] } {
    const calls: string[] = [];
    const execSync = ((command: string) => {
        calls.push(command);
        // Extract PID from command
        const pidMatch = command.match(/(\d+)/);
        if (pidMatch) {
            const pid = parseInt(pidMatch[1], 10);
            if (runningPids.has(pid)) {
                return Buffer.from('process info');
            }
        }
        throw new Error('Process not found');
    }) as unknown as typeof import('child_process').execSync;
    return { execSync, calls };
}

// ============================================================================
// ProcessMonitor - Process Running Detection Tests
// ============================================================================

suite('ProcessMonitor - Process Running Detection', () => {
    test('should detect running process on Unix', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, true);
        assert.strictEqual(result.error, undefined);

        monitor.dispose();
    });

    test('should detect running process on Linux', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: createMockExecSyncRunning()
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, true);
        assert.strictEqual(result.error, undefined);

        monitor.dispose();
    });

    test('should detect terminated process on Unix', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncNotRunning()
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, false);

        monitor.dispose();
    });

    test('should detect terminated process on Linux', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: createMockExecSyncNotRunning()
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, false);

        monitor.dispose();
    });

    test('should detect running process on Windows', () => {
        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: createMockExecSyncWindowsRunning(12345)
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, true);
        assert.strictEqual(result.error, undefined);

        monitor.dispose();
    });

    test('should detect terminated process on Windows', () => {
        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: createMockExecSyncWindowsNotRunning()
        });

        const result = monitor.isProcessRunning(12345);

        assert.strictEqual(result.isRunning, false);

        monitor.dispose();
    });

    test('should return error for invalid PID (zero)', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        const result = monitor.isProcessRunning(0);

        assert.strictEqual(result.isRunning, false);
        assert.strictEqual(result.error, 'Invalid PID');

        monitor.dispose();
    });

    test('should return error for invalid PID (negative)', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        const result = monitor.isProcessRunning(-1);

        assert.strictEqual(result.isRunning, false);
        assert.strictEqual(result.error, 'Invalid PID');

        monitor.dispose();
    });
});

// ============================================================================
// ProcessMonitor - Monitoring Lifecycle Tests
// ============================================================================

suite('ProcessMonitor - Monitoring Lifecycle', () => {
    test('should start monitoring a session', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        let callbackCalled = false;
        monitor.startMonitoring('session-1', 12345, () => {
            callbackCalled = true;
        });

        assert.strictEqual(monitor.getMonitoredSessionCount(), 1);
        assert.strictEqual(monitor.isMonitoring('session-1'), true);
        assert.strictEqual(callbackCalled, false);

        monitor.dispose();
    });

    test('should stop monitoring a session', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        monitor.startMonitoring('session-1', 12345, () => { });
        assert.strictEqual(monitor.getMonitoredSessionCount(), 1);

        monitor.stopMonitoring('session-1');
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);
        assert.strictEqual(monitor.isMonitoring('session-1'), false);

        monitor.dispose();
    });

    test('should monitor multiple sessions', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        monitor.startMonitoring('session-1', 12345, () => { });
        monitor.startMonitoring('session-2', 12346, () => { });
        monitor.startMonitoring('session-3', 12347, () => { });

        assert.strictEqual(monitor.getMonitoredSessionCount(), 3);
        assert.strictEqual(monitor.isMonitoring('session-1'), true);
        assert.strictEqual(monitor.isMonitoring('session-2'), true);
        assert.strictEqual(monitor.isMonitoring('session-3'), true);

        monitor.dispose();
    });

    test('should not monitor invalid PID', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        monitor.startMonitoring('session-1', 0, () => { });
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.startMonitoring('session-2', -1, () => { });
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.dispose();
    });

    test('should replace monitoring for same session ID', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        let callback1Called = false;
        let callback2Called = false;

        monitor.startMonitoring('session-1', 12345, () => {
            callback1Called = true;
        });

        monitor.startMonitoring('session-1', 12346, () => {
            callback2Called = true;
        });

        assert.strictEqual(monitor.getMonitoredSessionCount(), 1);

        monitor.dispose();
    });

    test('should clear all sessions on dispose', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        monitor.startMonitoring('session-1', 12345, () => { });
        monitor.startMonitoring('session-2', 12346, () => { });

        monitor.dispose();

        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);
    });

    test('should not start monitoring after dispose', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        monitor.dispose();

        monitor.startMonitoring('session-1', 12345, () => { });
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);
    });
});

// ============================================================================
// ProcessMonitor - Callback Invocation Tests
// ============================================================================

suite('ProcessMonitor - Callback Invocation', () => {
    test('should invoke callback when process terminates', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncNotRunning(),
            pollIntervalMs: 1000
        });

        let callbackCalled = false;
        monitor.startMonitoring('session-1', 12345, () => {
            callbackCalled = true;
        });

        // Force immediate check
        monitor.checkNow();

        assert.strictEqual(callbackCalled, true);
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.dispose();
    });

    test('should not invoke callback when process is running', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 1000
        });

        let callbackCalled = false;
        monitor.startMonitoring('session-1', 12345, () => {
            callbackCalled = true;
        });

        // Force immediate check
        monitor.checkNow();

        assert.strictEqual(callbackCalled, false);
        assert.strictEqual(monitor.getMonitoredSessionCount(), 1);

        monitor.dispose();
    });

    test('should invoke callbacks for multiple terminated processes', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncNotRunning(),
            pollIntervalMs: 1000
        });

        const callbacks: string[] = [];

        monitor.startMonitoring('session-1', 12345, () => {
            callbacks.push('session-1');
        });
        monitor.startMonitoring('session-2', 12346, () => {
            callbacks.push('session-2');
        });
        monitor.startMonitoring('session-3', 12347, () => {
            callbacks.push('session-3');
        });

        // Force immediate check
        monitor.checkNow();

        assert.strictEqual(callbacks.length, 3);
        assert.ok(callbacks.includes('session-1'));
        assert.ok(callbacks.includes('session-2'));
        assert.ok(callbacks.includes('session-3'));
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.dispose();
    });

    test('should only invoke callback for terminated processes', () => {
        const runningPids = new Set([12345, 12347]);
        const { execSync } = createMockExecSyncWithTracking(runningPids);

        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: execSync,
            pollIntervalMs: 1000
        });

        const callbacks: string[] = [];

        monitor.startMonitoring('session-1', 12345, () => {
            callbacks.push('session-1');
        });
        monitor.startMonitoring('session-2', 12346, () => {
            callbacks.push('session-2');
        });
        monitor.startMonitoring('session-3', 12347, () => {
            callbacks.push('session-3');
        });

        // Force immediate check
        monitor.checkNow();

        // Only session-2 (PID 12346) should have terminated
        assert.strictEqual(callbacks.length, 1);
        assert.ok(callbacks.includes('session-2'));
        assert.strictEqual(monitor.getMonitoredSessionCount(), 2);

        monitor.dispose();
    });

    test('should handle callback errors gracefully', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncNotRunning(),
            pollIntervalMs: 1000
        });

        let secondCallbackCalled = false;

        monitor.startMonitoring('session-1', 12345, () => {
            throw new Error('Callback error');
        });
        monitor.startMonitoring('session-2', 12346, () => {
            secondCallbackCalled = true;
        });

        // Force immediate check - should not throw
        assert.doesNotThrow(() => {
            monitor.checkNow();
        });

        // Second callback should still be called
        assert.strictEqual(secondCallbackCalled, true);

        monitor.dispose();
    });

    test('should remove session after callback invocation', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncNotRunning(),
            pollIntervalMs: 1000
        });

        let callCount = 0;
        monitor.startMonitoring('session-1', 12345, () => {
            callCount++;
        });

        // Force multiple checks
        monitor.checkNow();
        monitor.checkNow();
        monitor.checkNow();

        // Callback should only be called once
        assert.strictEqual(callCount, 1);

        monitor.dispose();
    });
});

// ============================================================================
// ProcessMonitor - Configuration Tests
// ============================================================================

suite('ProcessMonitor - Configuration', () => {
    test('should use default poll interval', () => {
        const monitor = new ProcessMonitor();

        // Default poll interval should be 5000ms
        assert.strictEqual(DEFAULT_POLL_INTERVAL_MS, 5000);

        monitor.dispose();
    });

    test('should use custom poll interval', () => {
        const monitor = new ProcessMonitor({
            pollIntervalMs: 1000
        });

        // Monitor created with custom interval - no direct way to verify
        // but it should work without errors
        monitor.dispose();
    });

    test('should use specified platform', () => {
        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: createMockExecSyncWindowsRunning(12345)
        });

        const result = monitor.isProcessRunning(12345);
        assert.strictEqual(result.isRunning, true);

        monitor.dispose();
    });

    test('should use custom execSync function', () => {
        let execSyncCalled = false;
        const customExecSync = (() => {
            execSyncCalled = true;
            return Buffer.from('process info');
        }) as unknown as typeof import('child_process').execSync;

        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: customExecSync
        });

        monitor.isProcessRunning(12345);

        assert.strictEqual(execSyncCalled, true);

        monitor.dispose();
    });
});

// ============================================================================
// ProcessMonitor - Platform-Specific Tests
// ============================================================================

suite('ProcessMonitor - Platform-Specific Behavior', () => {
    test('should use ps command on macOS', () => {
        const { execSync, calls } = createMockExecSyncWithTracking(new Set([12345]));

        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: execSync
        });

        monitor.isProcessRunning(12345);

        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].includes('ps -p 12345'));

        monitor.dispose();
    });

    test('should use ps command on Linux', () => {
        const { execSync, calls } = createMockExecSyncWithTracking(new Set([12345]));

        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: execSync
        });

        monitor.isProcessRunning(12345);

        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].includes('ps -p 12345'));

        monitor.dispose();
    });

    test('should use tasklist command on Windows', () => {
        const calls: string[] = [];
        const execSync = ((command: string) => {
            calls.push(command);
            return Buffer.from(`node.exe                     12345 Console                    1     50,000 K`);
        }) as unknown as typeof import('child_process').execSync;

        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: execSync
        });

        monitor.isProcessRunning(12345);

        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].includes('tasklist'));
        assert.ok(calls[0].includes('12345'));

        monitor.dispose();
    });

    test('should handle Windows tasklist error gracefully', () => {
        const execSync = (() => {
            throw new Error('tasklist failed');
        }) as unknown as typeof import('child_process').execSync;

        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: execSync
        });

        const result = monitor.isProcessRunning(12345);

        // Should not throw, just return not running
        assert.strictEqual(result.isRunning, false);

        monitor.dispose();
    });
});

// ============================================================================
// ProcessMonitor - Edge Cases
// ============================================================================

suite('ProcessMonitor - Edge Cases', () => {
    test('should handle stopping non-existent session', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        // Should not throw
        assert.doesNotThrow(() => {
            monitor.stopMonitoring('non-existent');
        });

        monitor.dispose();
    });

    test('should handle checkNow with no monitored sessions', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        // Should not throw
        assert.doesNotThrow(() => {
            monitor.checkNow();
        });

        monitor.dispose();
    });

    test('should handle rapid start/stop monitoring', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning(),
            pollIntervalMs: 100
        });

        for (let i = 0; i < 100; i++) {
            monitor.startMonitoring(`session-${i}`, 12345 + i, () => { });
        }

        assert.strictEqual(monitor.getMonitoredSessionCount(), 100);

        for (let i = 0; i < 100; i++) {
            monitor.stopMonitoring(`session-${i}`);
        }

        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.dispose();
    });

    test('should handle very large PID', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        const largePid = 2147483647; // Max 32-bit signed integer
        const result = monitor.isProcessRunning(largePid);

        assert.strictEqual(result.isRunning, true);

        monitor.dispose();
    });

    test('should handle multiple dispose calls', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        monitor.startMonitoring('session-1', 12345, () => { });

        // Should not throw on multiple dispose calls
        assert.doesNotThrow(() => {
            monitor.dispose();
            monitor.dispose();
            monitor.dispose();
        });
    });

    test('should handle isMonitoring for non-existent session', () => {
        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: createMockExecSyncRunning()
        });

        assert.strictEqual(monitor.isMonitoring('non-existent'), false);

        monitor.dispose();
    });
});

// ============================================================================
// ProcessMonitor - Integration Tests
// ============================================================================

suite('ProcessMonitor - Integration', () => {
    test('should work with real process detection on current platform', () => {
        // This test uses the real execSync to verify basic functionality
        // on the current platform
        const monitor = new ProcessMonitor();

        // Check current process (should be running)
        const currentPid = process.pid;
        const result = monitor.isProcessRunning(currentPid);

        assert.strictEqual(result.isRunning, true);

        monitor.dispose();
    });

    test('should detect non-existent process on current platform', () => {
        const monitor = new ProcessMonitor();

        // Use a very high PID that's unlikely to exist
        // Note: On some systems, PIDs can be reused, so we use a very high number
        const nonExistentPid = 2147483647;
        const result = monitor.isProcessRunning(nonExistentPid);

        // Should not be running (or at least not throw)
        assert.strictEqual(typeof result.isRunning, 'boolean');

        monitor.dispose();
    });

    test('should handle monitoring lifecycle correctly', () => {
        const runningPids = new Set([12345]);
        const { execSync } = createMockExecSyncWithTracking(runningPids);

        const monitor = new ProcessMonitor({
            platform: 'darwin',
            execSyncFn: execSync,
            pollIntervalMs: 100
        });

        let terminatedSessions: string[] = [];

        // Start monitoring
        monitor.startMonitoring('session-1', 12345, () => {
            terminatedSessions.push('session-1');
        });
        monitor.startMonitoring('session-2', 12346, () => {
            terminatedSessions.push('session-2');
        });

        // Check - session-2 should terminate (not in runningPids)
        monitor.checkNow();
        assert.ok(terminatedSessions.includes('session-2'));
        assert.ok(!terminatedSessions.includes('session-1'));

        // Simulate session-1 terminating
        runningPids.delete(12345);
        terminatedSessions = [];

        monitor.checkNow();
        assert.ok(terminatedSessions.includes('session-1'));

        // Both sessions should now be removed
        assert.strictEqual(monitor.getMonitoredSessionCount(), 0);

        monitor.dispose();
    });
});
