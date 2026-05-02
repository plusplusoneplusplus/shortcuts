/**
 * Tests for HeapMonitor and heap routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeapMonitor, getHeapSnapshot, registerHeapRoutes } from '../../src/server/admin/heap-monitor';
import type { HeapSnapshot, HeapMonitorConfig } from '../../src/server/admin/heap-monitor';
import type { Route } from '../../src/server/shared/router';
import http from 'http';

// ============================================================================
// getHeapSnapshot()
// ============================================================================

describe('getHeapSnapshot', () => {
    it('returns a valid snapshot with all fields', () => {
        const snapshot = getHeapSnapshot();
        expect(snapshot).toHaveProperty('usedHeapMB');
        expect(snapshot).toHaveProperty('totalHeapMB');
        expect(snapshot).toHaveProperty('heapLimitMB');
        expect(snapshot).toHaveProperty('usagePercent');
        expect(snapshot).toHaveProperty('externalMB');
        expect(snapshot).toHaveProperty('timestamp');
    });

    it('returns numeric values for all fields', () => {
        const snapshot = getHeapSnapshot();
        expect(typeof snapshot.usedHeapMB).toBe('number');
        expect(typeof snapshot.totalHeapMB).toBe('number');
        expect(typeof snapshot.heapLimitMB).toBe('number');
        expect(typeof snapshot.usagePercent).toBe('number');
        expect(typeof snapshot.externalMB).toBe('number');
        expect(typeof snapshot.timestamp).toBe('number');
    });

    it('returns positive heap sizes', () => {
        const snapshot = getHeapSnapshot();
        expect(snapshot.usedHeapMB).toBeGreaterThan(0);
        expect(snapshot.totalHeapMB).toBeGreaterThan(0);
        expect(snapshot.heapLimitMB).toBeGreaterThan(0);
    });

    it('returns usage percent between 0 and 100', () => {
        const snapshot = getHeapSnapshot();
        expect(snapshot.usagePercent).toBeGreaterThanOrEqual(0);
        expect(snapshot.usagePercent).toBeLessThanOrEqual(100);
    });

    it('returns usedHeapMB <= heapLimitMB', () => {
        const snapshot = getHeapSnapshot();
        expect(snapshot.usedHeapMB).toBeLessThanOrEqual(snapshot.heapLimitMB);
    });

    it('returns values rounded to 2 decimal places', () => {
        const snapshot = getHeapSnapshot();
        const decimals = (n: number) => {
            const s = n.toString();
            const dot = s.indexOf('.');
            return dot === -1 ? 0 : s.length - dot - 1;
        };
        expect(decimals(snapshot.usedHeapMB)).toBeLessThanOrEqual(2);
        expect(decimals(snapshot.totalHeapMB)).toBeLessThanOrEqual(2);
        expect(decimals(snapshot.heapLimitMB)).toBeLessThanOrEqual(2);
        expect(decimals(snapshot.usagePercent)).toBeLessThanOrEqual(2);
        expect(decimals(snapshot.externalMB)).toBeLessThanOrEqual(2);
    });

    it('returns a recent timestamp', () => {
        const before = Date.now();
        const snapshot = getHeapSnapshot();
        const after = Date.now();
        expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
        expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    });
});

// ============================================================================
// HeapMonitor
// ============================================================================

describe('HeapMonitor', () => {
    const defaultConfig: HeapMonitorConfig = {
        enabled: true,
        intervalMs: 100,
        warnThreshold: 70,
        criticalThreshold: 85,
    };

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('creates a monitor with config', () => {
            const monitor = new HeapMonitor(defaultConfig);
            expect(monitor).toBeInstanceOf(HeapMonitor);
            monitor.dispose();
        });

        it('accepts a custom log function', () => {
            const log = vi.fn();
            const monitor = new HeapMonitor(defaultConfig, log);
            expect(monitor).toBeInstanceOf(HeapMonitor);
            monitor.dispose();
        });
    });

    describe('start/stop', () => {
        it('does not start when enabled=false', () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const monitor = new HeapMonitor({ ...defaultConfig, enabled: false });
            monitor.start();
            expect(setIntervalSpy).not.toHaveBeenCalled();
            monitor.dispose();
        });

        it('starts interval when enabled=true', () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const monitor = new HeapMonitor(defaultConfig);
            monitor.start();
            expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 100);
            monitor.dispose();
        });

        it('does not start twice', () => {
            const setIntervalSpy = vi.spyOn(global, 'setInterval');
            const monitor = new HeapMonitor(defaultConfig);
            monitor.start();
            monitor.start();
            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            monitor.dispose();
        });

        it('stops the interval timer', () => {
            const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
            const monitor = new HeapMonitor(defaultConfig);
            monitor.start();
            monitor.stop();
            expect(clearIntervalSpy).toHaveBeenCalled();
        });

        it('stop is safe to call when not started', () => {
            const monitor = new HeapMonitor(defaultConfig);
            expect(() => monitor.stop()).not.toThrow();
        });

        it('dispose stops the timer', () => {
            const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
            const monitor = new HeapMonitor(defaultConfig);
            monitor.start();
            monitor.dispose();
            expect(clearIntervalSpy).toHaveBeenCalled();
        });
    });

    describe('check', () => {
        it('returns a heap snapshot', () => {
            const monitor = new HeapMonitor(defaultConfig);
            const snapshot = monitor.check();
            expect(snapshot).toHaveProperty('usedHeapMB');
            expect(snapshot).toHaveProperty('usagePercent');
            monitor.dispose();
        });

        it('logs warning when usage exceeds warn threshold', () => {
            const log = vi.fn();
            // Use a threshold of 0 so any usage triggers warning
            const monitor = new HeapMonitor({
                ...defaultConfig,
                warnThreshold: 0,
                criticalThreshold: 100,
            }, log);
            monitor.check();
            expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('[HeapMonitor] WARNING'), expect.any(Object));
            monitor.dispose();
        });

        it('logs critical when usage exceeds critical threshold', () => {
            const log = vi.fn();
            // Use a threshold of 0 so any usage triggers critical
            const monitor = new HeapMonitor({
                ...defaultConfig,
                warnThreshold: 0,
                criticalThreshold: 0,
            }, log);
            monitor.check();
            expect(log).toHaveBeenCalledWith('error', expect.stringContaining('[HeapMonitor] CRITICAL'), expect.any(Object));
            monitor.dispose();
        });

        it('does not log when usage is below thresholds', () => {
            const log = vi.fn();
            const monitor = new HeapMonitor({
                ...defaultConfig,
                warnThreshold: 100,
                criticalThreshold: 100,
            }, log);
            monitor.check();
            expect(log).not.toHaveBeenCalled();
            monitor.dispose();
        });

        it('critical takes precedence over warning', () => {
            const log = vi.fn();
            const monitor = new HeapMonitor({
                ...defaultConfig,
                warnThreshold: 0,
                criticalThreshold: 0,
            }, log);
            monitor.check();
            // Should only get one call (critical), not both
            expect(log).toHaveBeenCalledTimes(1);
            expect(log).toHaveBeenCalledWith('error', expect.stringContaining('CRITICAL'), expect.any(Object));
            monitor.dispose();
        });
    });

    describe('periodic checking', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('calls check on interval', () => {
            const log = vi.fn();
            const monitor = new HeapMonitor({
                ...defaultConfig,
                intervalMs: 1000,
                warnThreshold: 0,
                criticalThreshold: 100,
            }, log);
            monitor.start();

            expect(log).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(log).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(1000);
            expect(log).toHaveBeenCalledTimes(2);

            monitor.dispose();
        });

        it('stops checking after dispose', () => {
            const log = vi.fn();
            const monitor = new HeapMonitor({
                ...defaultConfig,
                intervalMs: 1000,
                warnThreshold: 0,
                criticalThreshold: 100,
            }, log);
            monitor.start();
            vi.advanceTimersByTime(1000);
            expect(log).toHaveBeenCalledTimes(1);

            monitor.dispose();
            vi.advanceTimersByTime(5000);
            expect(log).toHaveBeenCalledTimes(1);
        });
    });

    describe('default log function', () => {
        it('writes to stderr', () => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
            const monitor = new HeapMonitor({
                ...defaultConfig,
                warnThreshold: 0,
                criticalThreshold: 100,
            });
            monitor.check();
            expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[HeapMonitor]'));
            monitor.dispose();
        });
    });
});

// ============================================================================
// registerHeapRoutes
// ============================================================================

describe('registerHeapRoutes', () => {
    it('registers GET /api/admin/heap route', () => {
        const routes: Route[] = [];
        registerHeapRoutes(routes);
        expect(routes).toHaveLength(1);
        expect(routes[0].method).toBe('GET');
        expect(routes[0].pattern).toBe('/api/admin/heap');
    });

    it('handler returns a valid heap snapshot', async () => {
        const routes: Route[] = [];
        registerHeapRoutes(routes);

        const responseData: { statusCode?: number; body?: string } = {};
        const res = {
            writeHead: vi.fn(),
            setHeader: vi.fn(),
            end: vi.fn((body: string) => { responseData.body = body; }),
        } as unknown as http.ServerResponse;

        // Mock the statusCode setter
        let capturedStatus = 200;
        Object.defineProperty(res, 'statusCode', {
            get: () => capturedStatus,
            set: (v: number) => { capturedStatus = v; },
        });

        const req = {} as http.IncomingMessage;
        await routes[0].handler(req, res);

        expect(responseData.body).toBeDefined();
        const snapshot = JSON.parse(responseData.body!) as HeapSnapshot;
        expect(snapshot).toHaveProperty('usedHeapMB');
        expect(snapshot).toHaveProperty('totalHeapMB');
        expect(snapshot).toHaveProperty('heapLimitMB');
        expect(snapshot).toHaveProperty('usagePercent');
        expect(snapshot).toHaveProperty('externalMB');
        expect(snapshot).toHaveProperty('timestamp');
        expect(typeof snapshot.usedHeapMB).toBe('number');
    });
});
