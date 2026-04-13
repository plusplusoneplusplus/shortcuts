/**
 * Heap Memory Pressure Monitor
 *
 * Periodically samples V8 heap statistics and logs warnings when
 * memory usage exceeds configurable thresholds. Exposes a route
 * for on-demand heap snapshots via `GET /api/admin/heap`.
 */

import * as v8 from 'v8';
import type { Route } from './shared/router';
import { sendJson } from './shared/router';

// ============================================================================
// Types
// ============================================================================

export interface HeapSnapshot {
    usedHeapMB: number;
    totalHeapMB: number;
    heapLimitMB: number;
    usagePercent: number;
    externalMB: number;
    timestamp: number;
}

export interface HeapMonitorConfig {
    enabled: boolean;
    intervalMs: number;
    warnThreshold: number;
    criticalThreshold: number;
}

// ============================================================================
// Snapshot
// ============================================================================

export function getHeapSnapshot(): HeapSnapshot {
    const stats = v8.getHeapStatistics();
    const usedHeapMB = Math.round((stats.used_heap_size / (1024 * 1024)) * 100) / 100;
    const totalHeapMB = Math.round((stats.total_heap_size / (1024 * 1024)) * 100) / 100;
    const heapLimitMB = Math.round((stats.heap_size_limit / (1024 * 1024)) * 100) / 100;
    const usagePercent = Math.round((stats.used_heap_size / stats.heap_size_limit) * 10000) / 100;
    const externalMB = Math.round((stats.external_memory / (1024 * 1024)) * 100) / 100;
    return { usedHeapMB, totalHeapMB, heapLimitMB, usagePercent, externalMB, timestamp: Date.now() };
}

// ============================================================================
// HeapMonitor
// ============================================================================

export class HeapMonitor {
    private timer: ReturnType<typeof setInterval> | undefined;
    private readonly config: HeapMonitorConfig;
    private readonly log: (level: 'warn' | 'error', message: string, data: HeapSnapshot) => void;

    constructor(config: HeapMonitorConfig, log?: (level: 'warn' | 'error', message: string, data: HeapSnapshot) => void) {
        this.config = config;
        this.log = log ?? HeapMonitor.defaultLog;
    }

    private static defaultLog(level: 'warn' | 'error', message: string, data: HeapSnapshot): void {
        const line = `${message} usedMB=${data.usedHeapMB} limitMB=${data.heapLimitMB} usage=${data.usagePercent}%`;
        if (level === 'error') {
            process.stderr.write(`${line}\n`);
        } else {
            process.stderr.write(`${line}\n`);
        }
    }

    start(): void {
        if (!this.config.enabled || this.timer) return;
        this.timer = setInterval(() => this.check(), this.config.intervalMs);
        // Allow the timer to not keep the process alive
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /** Run a single check — also used in tests. */
    check(): HeapSnapshot {
        const snapshot = getHeapSnapshot();
        if (snapshot.usagePercent > this.config.criticalThreshold) {
            this.log('error', `[HeapMonitor] CRITICAL: heap usage above ${this.config.criticalThreshold}%`, snapshot);
        } else if (snapshot.usagePercent > this.config.warnThreshold) {
            this.log('warn', `[HeapMonitor] WARNING: heap usage above ${this.config.warnThreshold}%`, snapshot);
        }
        return snapshot;
    }

    dispose(): void {
        this.stop();
    }
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerHeapRoutes(routes: Route[]): void {
    routes.push({
        method: 'GET',
        pattern: '/api/admin/heap',
        handler: async (_req, res) => {
            const snapshot = getHeapSnapshot();
            sendJson(res, snapshot);
        },
    });
}
