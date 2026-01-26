/**
 * Window Focus Service
 *
 * Platform-specific service for bringing terminal windows to the foreground.
 * Currently only supports Windows (win32) platform.
 *
 * On Windows, each terminal window (cmd, PowerShell) is a separate process,
 * so we can use the PID to focus the specific window using PowerShell's
 * AppActivate method.
 */

import { spawn, SpawnOptions } from 'child_process';
import { InteractiveSession, TerminalType, WindowFocusResult } from './terminal-types';

/**
 * Window Focus Service
 *
 * Handles platform-specific window focusing for interactive sessions.
 * Currently only implemented for Windows.
 */
export class WindowFocusService {
    private platform: NodeJS.Platform;
    private spawnFn: typeof spawn;

    constructor(
        platform?: NodeJS.Platform,
        spawnFn?: typeof spawn
    ) {
        this.platform = platform ?? process.platform;
        this.spawnFn = spawnFn ?? spawn;
    }

    /**
     * Check if window focusing is supported on the current platform
     */
    isSupported(): boolean {
        return this.platform === 'win32';
    }

    /**
     * Check if a specific terminal type supports window focusing
     * On Windows, cmd and PowerShell have separate processes per window.
     * Windows Terminal is trickier as it uses a single process for tabs.
     */
    isTerminalSupported(terminalType: TerminalType): boolean {
        if (this.platform !== 'win32') {
            return false;
        }

        // cmd and PowerShell have separate processes per window
        // Windows Terminal uses a single process, so PID-based focusing is less reliable
        return terminalType === 'cmd' || terminalType === 'powershell';
    }

    /**
     * Focus the window associated with an interactive session
     *
     * @param session The interactive session to focus
     * @returns Promise resolving to the focus result
     */
    async focusSession(session: InteractiveSession): Promise<WindowFocusResult> {
        // Check platform support
        if (!this.isSupported()) {
            return {
                success: false,
                error: `Window focusing is not supported on ${this.platform}. Only Windows is currently supported.`
            };
        }

        // Check if session has a PID
        if (!session.pid) {
            return {
                success: false,
                error: 'Session does not have a process ID'
            };
        }

        // Check if session is active
        if (session.status !== 'active' && session.status !== 'starting') {
            return {
                success: false,
                error: `Cannot focus session with status: ${session.status}`
            };
        }

        // Focus using the appropriate method for the terminal type
        return this.focusWindowByPid(session.pid, session.terminalType);
    }

    /**
     * Focus a window by its process ID using PowerShell
     *
     * Uses WScript.Shell's AppActivate method which works with PIDs
     * for cmd and PowerShell windows.
     */
    private async focusWindowByPid(pid: number, terminalType: TerminalType): Promise<WindowFocusResult> {
        return new Promise((resolve) => {
            // PowerShell command to activate window by PID
            // AppActivate accepts a PID and brings the window to foreground
            const psCommand = `(New-Object -ComObject WScript.Shell).AppActivate(${pid})`;

            const spawnOptions: SpawnOptions = {
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            };

            try {
                const child = this.spawnFn('powershell', ['-Command', psCommand], spawnOptions);

                let stdout = '';
                let stderr = '';

                child.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });

                child.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        // AppActivate returns True if successful, False if window not found
                        const result = stdout.trim().toLowerCase();
                        if (result === 'true') {
                            resolve({ success: true });
                        } else {
                            // Window not found - might be closed or PID changed
                            resolve({
                                success: false,
                                error: `Window with PID ${pid} not found. The terminal may have been closed.`
                            });
                        }
                    } else {
                        resolve({
                            success: false,
                            error: `PowerShell command failed with code ${code}: ${stderr}`
                        });
                    }
                });

                child.on('error', (error) => {
                    resolve({
                        success: false,
                        error: `Failed to spawn PowerShell: ${error.message}`
                    });
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                resolve({
                    success: false,
                    error: `Failed to focus window: ${errorMessage}`
                });
            }
        });
    }

    /**
     * Get the current platform
     */
    getPlatform(): NodeJS.Platform {
        return this.platform;
    }
}

/**
 * Singleton instance for convenience
 */
let defaultService: WindowFocusService | undefined;

/**
 * Get the default WindowFocusService instance
 */
export function getWindowFocusService(): WindowFocusService {
    if (!defaultService) {
        defaultService = new WindowFocusService();
    }
    return defaultService;
}

/**
 * Reset the default service (useful for testing)
 */
export function resetWindowFocusService(): void {
    defaultService = undefined;
}
