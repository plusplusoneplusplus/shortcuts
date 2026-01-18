/**
 * External Terminal Launcher
 *
 * Platform-specific logic for launching external terminal applications
 * with AI CLI tools (copilot, claude) for interactive sessions.
 *
 * Supports:
 * - macOS: Terminal.app, iTerm2
 * - Windows: Windows Terminal, cmd.exe, PowerShell
 * - Linux: gnome-terminal, konsole, xfce4-terminal, xterm
 */

import { spawn, execSync, SpawnOptions } from 'child_process';
import * as path from 'path';
import {
    ExternalTerminalLaunchOptions,
    ExternalTerminalLaunchResult,
    InteractiveToolType,
    TerminalType
} from './types';

/**
 * Terminal configuration for each platform
 */
interface TerminalConfig {
    /** Command to check if terminal is available */
    checkCommand: string;
    /** Function to build spawn arguments */
    buildSpawnArgs: (cwd: string, command: string) => { cmd: string; args: string[] };
}

/**
 * Terminal configurations by platform and terminal type
 */
const TERMINAL_CONFIGS: Record<string, Record<string, TerminalConfig>> = {
    darwin: {
        'iterm': {
            checkCommand: 'osascript -e \'application "iTerm" exists\'',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'osascript',
                args: [
                    '-e', `tell application "iTerm"`,
                    '-e', `create window with default profile`,
                    '-e', `tell current session of current window`,
                    '-e', `write text "cd ${escapeAppleScript(cwd)} && ${escapeAppleScript(command)}"`,
                    '-e', `end tell`,
                    '-e', `end tell`
                ]
            })
        },
        'terminal.app': {
            checkCommand: 'osascript -e \'application "Terminal" exists\'',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'osascript',
                args: [
                    '-e', `tell application "Terminal"`,
                    '-e', `do script "cd ${escapeAppleScript(cwd)} && ${escapeAppleScript(command)}"`,
                    '-e', `activate`,
                    '-e', `end tell`
                ]
            })
        }
    },
    win32: {
        'windows-terminal': {
            checkCommand: 'where wt',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'wt',
                args: ['-d', cwd, 'cmd', '/k', command]
            })
        },
        'powershell': {
            checkCommand: 'where powershell',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'powershell',
                args: ['-NoExit', '-Command', `Set-Location '${cwd}'; ${command}`]
            })
        },
        'cmd': {
            checkCommand: 'where cmd',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'cmd',
                args: ['/k', `cd /d "${cwd}" && ${command}`]
            })
        }
    },
    linux: {
        'gnome-terminal': {
            checkCommand: 'which gnome-terminal',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'gnome-terminal',
                args: ['--working-directory', cwd, '--', 'bash', '-c', `${command}; exec bash`]
            })
        },
        'konsole': {
            checkCommand: 'which konsole',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'konsole',
                args: ['--workdir', cwd, '-e', 'bash', '-c', `${command}; exec bash`]
            })
        },
        'xfce4-terminal': {
            checkCommand: 'which xfce4-terminal',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'xfce4-terminal',
                args: ['--working-directory', cwd, '-e', `bash -c "${command}; exec bash"`]
            })
        },
        'xterm': {
            checkCommand: 'which xterm',
            buildSpawnArgs: (cwd: string, command: string) => ({
                cmd: 'xterm',
                args: ['-e', `cd "${cwd}" && ${command} && exec bash`]
            })
        }
    }
};

/**
 * Order of terminal preference by platform
 */
const TERMINAL_PREFERENCE_ORDER: Record<string, TerminalType[]> = {
    darwin: ['iterm', 'terminal.app'],
    win32: ['windows-terminal', 'powershell', 'cmd'],
    linux: ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']
};

/**
 * Escape a string for use in AppleScript
 */
function escapeAppleScript(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/'/g, "'\\''");
}

/**
 * Build the CLI command string for the specified tool
 */
export function buildCliCommand(tool: InteractiveToolType, initialPrompt?: string): string {
    const baseCommand = tool === 'copilot' ? 'copilot' : 'claude';

    if (!initialPrompt) {
        return baseCommand;
    }

    // Escape the prompt for shell use
    const platform = process.platform;
    const escapedPrompt = escapeShellArg(initialPrompt, platform as NodeJS.Platform);

    return `${baseCommand} -p ${escapedPrompt}`;
}

/**
 * Escape a string for safe use in shell commands
 */
export function escapeShellArg(str: string, platform: NodeJS.Platform): string {
    if (platform === 'win32') {
        // Windows: Use double quotes, escape internal double quotes
        const escaped = str
            .replace(/\r\n/g, '\\n')
            .replace(/\r/g, '')
            .replace(/\n/g, '\\n')
            .replace(/%/g, '%%')
            .replace(/!/g, '^!')
            .replace(/"/g, '""');
        return `"${escaped}"`;
    } else {
        // Unix: Use single quotes, escape internal single quotes
        const escaped = str.replace(/'/g, "'\\''");
        return `'${escaped}'`;
    }
}

/**
 * External Terminal Launcher
 *
 * Handles platform-specific detection and launching of external terminals
 * for interactive AI CLI sessions.
 */
export class ExternalTerminalLauncher {
    private platform: NodeJS.Platform;
    private terminalCache: Map<TerminalType, boolean> = new Map();

    // Dependency injection points for testing
    private execSyncFn: typeof execSync;
    private spawnFn: typeof spawn;

    constructor(
        platform?: NodeJS.Platform,
        execSyncFn?: typeof execSync,
        spawnFn?: typeof spawn
    ) {
        this.platform = platform ?? process.platform;
        this.execSyncFn = execSyncFn ?? execSync;
        this.spawnFn = spawnFn ?? spawn;
    }

    /**
     * Get the current platform
     */
    getPlatform(): NodeJS.Platform {
        return this.platform;
    }

    /**
     * Check if a specific terminal is available on the system
     */
    isTerminalAvailable(terminalType: TerminalType): boolean {
        // Check cache first
        const cached = this.terminalCache.get(terminalType);
        if (cached !== undefined) {
            return cached;
        }

        const platformKey = this.getPlatformKey();
        const configs = TERMINAL_CONFIGS[platformKey];

        if (!configs || !configs[terminalType]) {
            this.terminalCache.set(terminalType, false);
            return false;
        }

        const config = configs[terminalType];

        try {
            this.execSyncFn(config.checkCommand, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000
            });
            this.terminalCache.set(terminalType, true);
            return true;
        } catch {
            this.terminalCache.set(terminalType, false);
            return false;
        }
    }

    /**
     * Detect the best available terminal for the current platform
     */
    detectTerminal(): TerminalType {
        const platformKey = this.getPlatformKey();
        const preferenceOrder = TERMINAL_PREFERENCE_ORDER[platformKey];

        if (!preferenceOrder) {
            return 'unknown';
        }

        for (const terminal of preferenceOrder) {
            if (this.isTerminalAvailable(terminal)) {
                return terminal;
            }
        }

        return 'unknown';
    }

    /**
     * Get all available terminals for the current platform
     */
    getAvailableTerminals(): TerminalType[] {
        const platformKey = this.getPlatformKey();
        const preferenceOrder = TERMINAL_PREFERENCE_ORDER[platformKey];

        if (!preferenceOrder) {
            return [];
        }

        return preferenceOrder.filter(terminal => this.isTerminalAvailable(terminal));
    }

    /**
     * Launch an external terminal with the specified options
     */
    async launch(options: ExternalTerminalLaunchOptions): Promise<ExternalTerminalLaunchResult> {
        const { workingDirectory, tool, initialPrompt, preferredTerminal } = options;

        // Determine which terminal to use
        let terminalType: TerminalType;

        if (preferredTerminal && this.isTerminalAvailable(preferredTerminal)) {
            terminalType = preferredTerminal;
        } else {
            terminalType = this.detectTerminal();
        }

        if (terminalType === 'unknown') {
            return {
                success: false,
                terminalType: 'unknown',
                error: `No supported terminal found for platform: ${this.platform}`
            };
        }

        // Build the CLI command
        const command = buildCliCommand(tool, initialPrompt);

        // Get the terminal configuration
        const platformKey = this.getPlatformKey();
        const config = TERMINAL_CONFIGS[platformKey]?.[terminalType];

        if (!config) {
            return {
                success: false,
                terminalType,
                error: `Terminal configuration not found for: ${terminalType}`
            };
        }

        try {
            const { cmd, args } = config.buildSpawnArgs(workingDirectory, command);

            const spawnOptions: SpawnOptions = {
                detached: true,
                stdio: 'ignore',
                // On Windows, we need shell: true for some commands
                shell: this.platform === 'win32'
            };

            const child = this.spawnFn(cmd, args, spawnOptions);

            // Unref to allow the parent process to exit independently
            child.unref();

            return {
                success: true,
                terminalType,
                pid: child.pid
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                terminalType,
                error: `Failed to launch terminal: ${errorMessage}`
            };
        }
    }

    /**
     * Get the platform key for configuration lookup
     */
    private getPlatformKey(): string {
        // Normalize platform to our supported keys
        if (this.platform === 'darwin') {
            return 'darwin';
        } else if (this.platform === 'win32') {
            return 'win32';
        } else {
            // All other Unix-like systems use linux config
            return 'linux';
        }
    }

    /**
     * Clear the terminal availability cache
     */
    clearCache(): void {
        this.terminalCache.clear();
    }

    /**
     * Get supported terminals for a specific platform
     */
    static getSupportedTerminals(platform: NodeJS.Platform): TerminalType[] {
        let platformKey: string;
        if (platform === 'darwin') {
            platformKey = 'darwin';
        } else if (platform === 'win32') {
            platformKey = 'win32';
        } else {
            platformKey = 'linux';
        }

        return TERMINAL_PREFERENCE_ORDER[platformKey] ?? [];
    }
}

/**
 * Singleton instance for convenience
 */
let defaultLauncher: ExternalTerminalLauncher | undefined;

/**
 * Get the default ExternalTerminalLauncher instance
 */
export function getExternalTerminalLauncher(): ExternalTerminalLauncher {
    if (!defaultLauncher) {
        defaultLauncher = new ExternalTerminalLauncher();
    }
    return defaultLauncher;
}

/**
 * Reset the default launcher (useful for testing)
 */
export function resetExternalTerminalLauncher(): void {
    defaultLauncher = undefined;
}
