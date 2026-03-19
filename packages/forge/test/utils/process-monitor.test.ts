import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';

// Mock logger to avoid real logger dependency
vi.mock('../../src/logger', () => ({
    getLogger: () => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
    LogCategory: { UTILS: 'utils' },
}));

// Mock config/defaults
vi.mock('../../src/config/defaults', () => ({
    DEFAULT_POLL_INTERVAL_MS: 5000,
}));

import { ProcessMonitor, getProcessMonitor, resetProcessMonitor } from '../../src/utils/process-monitor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock execSync that simulates a running process (Windows). */
function makeExecSyncRunning(pid: number): typeof execSync {
    return vi.fn().mockReturnValue(`Image Name  PID\nsome.exe   ${pid}\n`) as unknown as typeof execSync;
}

/** Build a mock execSync that simulates a dead process (Windows). */
function makeExecSyncDead(): typeof execSync {
    return vi.fn().mockReturnValue('INFO: No tasks are running which match the specified criteria.\n') as unknown as typeof execSync;
}

/** Build a mock execSync that succeeds (Unix — ps exits 0 = running). */
function makeExecSyncUnixRunning(): typeof execSync {
    return vi.fn().mockReturnValue('') as unknown as typeof execSync;
}

/** Build a mock execSync that throws (Unix — ps exits non-zero = not running). */
function makeExecSyncUnixDead(): typeof execSync {
    return vi.fn().mockImplementation(() => { throw new Error('ps: no process found'); }) as unknown as typeof execSync;
}

// ---------------------------------------------------------------------------
// isProcessRunning
// ---------------------------------------------------------------------------

describe('ProcessMonitor.isProcessRunning', () => {
    it('returns false for invalid PID (0)', () => {
        const monitor = new ProcessMonitor();
        expect(monitor.isProcessRunning(0).isRunning).toBe(false);
    });

    it('returns false for negative PID', () => {
        const monitor = new ProcessMonitor();
        expect(monitor.isProcessRunning(-1).isRunning).toBe(false);
    });

    it('returns true when Windows tasklist output contains the PID', () => {
        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: makeExecSyncRunning(1234),
        });
        expect(monitor.isProcessRunning(1234).isRunning).toBe(true);
    });

    it('returns false when Windows tasklist output indicates no tasks running', () => {
        const monitor = new ProcessMonitor({
            platform: 'win32',
            execSyncFn: makeExecSyncDead(),
        });
        expect(monitor.isProcessRunning(1234).isRunning).toBe(false);
    });

    it('returns true when Unix ps exits successfully (process running)', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: makeExecSyncUnixRunning(),
        });
        expect(monitor.isProcessRunning(5678).isRunning).toBe(true);
    });

    it('returns false when Unix ps throws (process not running)', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: makeExecSyncUnixDead(),
        });
        expect(monitor.isProcessRunning(5678).isRunning).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// startMonitoring / stopMonitoring / getMonitoredSessionCount
// ---------------------------------------------------------------------------

describe('ProcessMonitor session management', () => {
    let monitor: ProcessMonitor;

    beforeEach(() => {
        vi.useFakeTimers();
        monitor = new ProcessMonitor({
            pollIntervalMs: 1000,
            platform: 'linux',
            execSyncFn: makeExecSyncUnixRunning(),
        });
    });

    afterEach(() => {
        monitor.dispose();
        vi.useRealTimers();
    });

    it('tracks a newly added session', () => {
        monitor.startMonitoring('s1', 100, vi.fn());
        expect(monitor.getMonitoredSessionCount()).toBe(1);
        expect(monitor.isMonitoring('s1')).toBe(true);
    });

    it('does not track a session with invalid PID', () => {
        monitor.startMonitoring('s2', -1, vi.fn());
        expect(monitor.getMonitoredSessionCount()).toBe(0);
    });

    it('removes a session on stopMonitoring', () => {
        monitor.startMonitoring('s3', 200, vi.fn());
        monitor.stopMonitoring('s3');
        expect(monitor.getMonitoredSessionCount()).toBe(0);
        expect(monitor.isMonitoring('s3')).toBe(false);
    });

    it('invokes onTerminated callback when process exits during poll', () => {
        const onTerminated = vi.fn();
        const deadExec = makeExecSyncUnixDead();
        const deadMonitor = new ProcessMonitor({
            pollIntervalMs: 1000,
            platform: 'linux',
            execSyncFn: deadExec,
        });

        deadMonitor.startMonitoring('s4', 999, onTerminated);
        deadMonitor.checkNow();

        expect(onTerminated).toHaveBeenCalledOnce();
        expect(deadMonitor.getMonitoredSessionCount()).toBe(0);
        deadMonitor.dispose();
    });

    it('does not invoke callback for a still-running process', () => {
        const onTerminated = vi.fn();
        monitor.startMonitoring('s5', 101, onTerminated);
        monitor.checkNow();
        expect(onTerminated).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('ProcessMonitor.dispose', () => {
    it('clears all monitored sessions', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: makeExecSyncUnixRunning(),
        });
        monitor.startMonitoring('s6', 300, vi.fn());
        monitor.dispose();
        expect(monitor.getMonitoredSessionCount()).toBe(0);
    });

    it('does not accept new sessions after dispose', () => {
        const monitor = new ProcessMonitor({
            platform: 'linux',
            execSyncFn: makeExecSyncUnixRunning(),
        });
        monitor.dispose();
        monitor.startMonitoring('s7', 400, vi.fn());
        expect(monitor.getMonitoredSessionCount()).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Singleton helpers
// ---------------------------------------------------------------------------

describe('getProcessMonitor / resetProcessMonitor', () => {
    afterEach(() => {
        resetProcessMonitor();
    });

    it('returns the same instance on repeated calls', () => {
        const a = getProcessMonitor();
        const b = getProcessMonitor();
        expect(a).toBe(b);
    });

    it('returns a new instance after reset', () => {
        const a = getProcessMonitor();
        resetProcessMonitor();
        const b = getProcessMonitor();
        expect(a).not.toBe(b);
    });
});
