/**
 * Process Monitor
 *
 * Monitors external terminal processes to detect when they terminate.
 * Uses platform-specific commands to check if processes are still running.
 *
 * Platform-specific checks:
 * - Windows: tasklist /FI "PID eq X"
 * - macOS/Linux: ps -p X (exit code 0 = running)
 */

import { execSync } from 'child_process';

/**
 * Disposable interface for cleanup
 * Compatible with VS Code's Disposable interface
 */
export interface Disposable {
    dispose(): void;
}

/**
 * Result of checking if a process is running
 */
export interface ProcessCheckResult {
    /** Whether the process is currently running */
    isRunning: boolean;
    /** Error message if the check failed */
    error?: string;
}

/**
 * Configuration options for ProcessMonitor
 */
export interface ProcessMonitorOptions {
    /** Poll interval in milliseconds (default: 5000) */
    pollIntervalMs?: number;
    /** Platform override for testing (default: process.platform) */
    platform?: NodeJS.Platform;
    /** Custom exec function for testing */
    execSyncFn?: typeof execSync;
}

/**
 * Monitored session entry
 */
interface MonitoredSession {
    /** Process ID to monitor */
    pid: number;
    /** Callback to invoke when process terminates */
    onTerminated: () => void;
}

/**
 * Default poll interval (5 seconds)
 */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * ProcessMonitor
 *
 * Monitors external terminal processes and notifies when they terminate.
 * Uses polling with platform-specific commands to check process status.
 */
export class ProcessMonitor implements Disposable {
    private checkInterval?: ReturnType<typeof setInterval>;
    private monitoredSessions: Map<string, MonitoredSession> = new Map();
    private readonly pollIntervalMs: number;
    private readonly platform: NodeJS.Platform;
    private readonly execSyncFn: typeof execSync;
    private isDisposed: boolean = false;

    constructor(options: ProcessMonitorOptions = {}) {
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.platform = options.platform ?? process.platform;
        this.execSyncFn = options.execSyncFn ?? execSync;
    }

    /**
     * Check if a process is currently running
     *
     * @param pid Process ID to check
     * @returns ProcessCheckResult indicating if the process is running
     */
    isProcessRunning(pid: number): ProcessCheckResult {
        if (pid <= 0) {
            return { isRunning: false, error: 'Invalid PID' };
        }

        try {
            if (this.platform === 'win32') {
                return this.checkWindowsProcess(pid);
            } else {
                return this.checkUnixProcess(pid);
            }
        } catch (error) {
            return {
                isRunning: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Check if a process is running on Windows
     */
    private checkWindowsProcess(pid: number): ProcessCheckResult {
        try {
            // tasklist returns exit code 0 if process found, non-zero if not found
            // We use /FI to filter by PID and /NH to skip headers
            const output = this.execSyncFn(`tasklist /FI "PID eq ${pid}" /NH`, {
                encoding: 'utf8',
                windowsHide: true,
                timeout: 5000
            });

            // If the output contains the PID, the process is running
            // tasklist returns "INFO: No tasks are running which match the specified criteria."
            // when no process is found
            const isRunning = !output.includes('No tasks are running') &&
                output.includes(String(pid));

            return { isRunning };
        } catch (error) {
            // If tasklist fails, assume process is not running
            return { isRunning: false };
        }
    }

    /**
     * Check if a process is running on Unix (macOS/Linux)
     */
    private checkUnixProcess(pid: number): ProcessCheckResult {
        try {
            // ps -p returns exit code 0 if process exists, 1 if not
            this.execSyncFn(`ps -p ${pid}`, {
                encoding: 'utf8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // If we get here without error, the process is running
            return { isRunning: true };
        } catch {
            // ps -p returns non-zero exit code if process doesn't exist
            return { isRunning: false };
        }
    }

    /**
     * Start monitoring a session's process
     *
     * @param sessionId Unique identifier for the session
     * @param pid Process ID to monitor
     * @param onTerminated Callback to invoke when the process terminates
     */
    startMonitoring(sessionId: string, pid: number, onTerminated: () => void): void {
        if (this.isDisposed) {
            return;
        }

        if (pid <= 0) {
            // Invalid PID, don't monitor
            return;
        }

        // Store the session for monitoring
        this.monitoredSessions.set(sessionId, { pid, onTerminated });

        // Start the polling interval if not already running
        if (!this.checkInterval && this.monitoredSessions.size > 0) {
            this.startPolling();
        }
    }

    /**
     * Stop monitoring a session's process
     *
     * @param sessionId Session ID to stop monitoring
     */
    stopMonitoring(sessionId: string): void {
        this.monitoredSessions.delete(sessionId);

        // Stop polling if no more sessions to monitor
        if (this.monitoredSessions.size === 0 && this.checkInterval) {
            this.stopPolling();
        }
    }

    /**
     * Get the number of sessions currently being monitored
     */
    getMonitoredSessionCount(): number {
        return this.monitoredSessions.size;
    }

    /**
     * Check if a specific session is being monitored
     */
    isMonitoring(sessionId: string): boolean {
        return this.monitoredSessions.has(sessionId);
    }

    /**
     * Start the polling interval
     */
    private startPolling(): void {
        if (this.checkInterval || this.isDisposed) {
            return;
        }

        this.checkInterval = setInterval(() => {
            this.checkAllProcesses();
        }, this.pollIntervalMs);
    }

    /**
     * Stop the polling interval
     */
    private stopPolling(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = undefined;
        }
    }

    /**
     * Check all monitored processes and invoke callbacks for terminated ones
     */
    private checkAllProcesses(): void {
        const terminatedSessions: string[] = [];

        for (const [sessionId, { pid, onTerminated }] of this.monitoredSessions.entries()) {
            const result = this.isProcessRunning(pid);

            if (!result.isRunning) {
                terminatedSessions.push(sessionId);

                // Invoke the callback
                try {
                    onTerminated();
                } catch (error) {
                    // Log but don't throw - we want to continue checking other processes
                    console.error(`Error in termination callback for session ${sessionId}:`, error);
                }
            }
        }

        // Remove terminated sessions from monitoring
        for (const sessionId of terminatedSessions) {
            this.monitoredSessions.delete(sessionId);
        }

        // Stop polling if no more sessions to monitor
        if (this.monitoredSessions.size === 0 && this.checkInterval) {
            this.stopPolling();
        }
    }

    /**
     * Force an immediate check of all processes (useful for testing)
     */
    checkNow(): void {
        this.checkAllProcesses();
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.isDisposed = true;
        this.stopPolling();
        this.monitoredSessions.clear();
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
