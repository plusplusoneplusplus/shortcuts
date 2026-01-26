/**
 * Process Monitor
 *
 * Re-exports from @plusplusoneplusplus/pipeline-core for backward compatibility.
 * The actual implementation has been moved to the pipeline-core package.
 * 
 * The VS Code extension wraps the pure ProcessMonitor to implement vscode.Disposable
 * if needed, but the underlying implementation is now in pipeline-core.
 */

import * as vscode from 'vscode';
import {
    ProcessMonitor as CoreProcessMonitor,
    ProcessMonitorOptions as CoreProcessMonitorOptions,
    getProcessMonitor as getCoreProcessMonitor,
    resetProcessMonitor as resetCoreProcessMonitor,
    ProcessCheckResult,
    DEFAULT_POLL_INTERVAL_MS
} from '@plusplusoneplusplus/pipeline-core';

// Re-export types from pipeline-core
export { ProcessCheckResult, DEFAULT_POLL_INTERVAL_MS } from '@plusplusoneplusplus/pipeline-core';
export type { ProcessMonitorOptions } from '@plusplusoneplusplus/pipeline-core';

/**
 * ProcessMonitor that implements vscode.Disposable
 * Wraps the pipeline-core ProcessMonitor for VS Code integration.
 */
export class ProcessMonitor implements vscode.Disposable {
    private coreMonitor: CoreProcessMonitor;

    constructor(options: CoreProcessMonitorOptions = {}) {
        this.coreMonitor = new CoreProcessMonitor(options);
    }

    isProcessRunning(pid: number): ProcessCheckResult {
        return this.coreMonitor.isProcessRunning(pid);
    }

    startMonitoring(sessionId: string, pid: number, onTerminated: () => void): void {
        return this.coreMonitor.startMonitoring(sessionId, pid, onTerminated);
    }

    stopMonitoring(sessionId: string): void {
        return this.coreMonitor.stopMonitoring(sessionId);
    }

    getMonitoredSessionCount(): number {
        return this.coreMonitor.getMonitoredSessionCount();
    }

    isMonitoring(sessionId: string): boolean {
        return this.coreMonitor.isMonitoring(sessionId);
    }

    checkNow(): void {
        return this.coreMonitor.checkNow();
    }

    dispose(): void {
        return this.coreMonitor.dispose();
    }
}

/**
 * Singleton instance for convenience
 */
let defaultMonitor: ProcessMonitor | undefined;

/**
 * Get the default ProcessMonitor instance
 */
export function getProcessMonitor(): ProcessMonitor {
    if (!defaultMonitor) {
        defaultMonitor = new ProcessMonitor();
    }
    return defaultMonitor;
}

/**
 * Reset the default monitor (useful for testing)
 */
export function resetProcessMonitor(): void {
    if (defaultMonitor) {
        defaultMonitor.dispose();
        defaultMonitor = undefined;
    }
}
