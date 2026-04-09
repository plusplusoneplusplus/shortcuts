/**
 * Tests for ExternalTerminalLauncher
 *
 * Covers platform-specific terminal detection, availability caching,
 * launch success/failure, AppleScript escaping, singleton behavior,
 * and preferred terminal override.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    ExternalTerminalLauncher,
    getExternalTerminalLauncher,
    resetExternalTerminalLauncher,
} from '../../src/utils/external-terminal-launcher';
import type { TerminalType, ExternalTerminalLaunchOptions } from '../../src/utils/terminal-types';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock execSync that reports specific terminals as available. */
function createExecSyncMock(availableTerminals: Set<string>) {
    return vi.fn((cmd: string) => {
        for (const name of availableTerminals) {
            if (cmd.includes(name) || cmd.includes(name.replace('.', ''))) {
                return Buffer.from(`/usr/bin/${name}`);
            }
        }
        throw new Error('not found');
    });
}

/** Create a minimal mock ChildProcess with a given pid. */
function createMockChild(pid: number): ChildProcess {
    const emitter = new EventEmitter();
    return Object.assign(emitter, {
        pid,
        stdin: null,
        stdout: null,
        stderr: null,
        stdio: [null, null, null, null, null] as ChildProcess['stdio'],
        connected: false,
        exitCode: null,
        signalCode: null,
        spawnargs: [] as string[],
        spawnfile: '',
        killed: false,
        kill: vi.fn(() => true),
        send: vi.fn(),
        disconnect: vi.fn(),
        unref: vi.fn(),
        ref: vi.fn(),
        [Symbol.dispose]: vi.fn(),
    }) as unknown as ChildProcess;
}

// ---------------------------------------------------------------------------
// getSupportedTerminals (static)
// ---------------------------------------------------------------------------

describe('ExternalTerminalLauncher.getSupportedTerminals', () => {
    it('returns macOS terminals for darwin', () => {
        const terminals = ExternalTerminalLauncher.getSupportedTerminals('darwin');
        expect(terminals).toEqual(['iterm', 'terminal.app']);
    });

    it('returns Windows terminals for win32', () => {
        const terminals = ExternalTerminalLauncher.getSupportedTerminals('win32');
        expect(terminals).toEqual(['windows-terminal', 'powershell', 'cmd']);
    });

    it('returns Linux terminals for linux', () => {
        const terminals = ExternalTerminalLauncher.getSupportedTerminals('linux');
        expect(terminals).toEqual(['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
    });

    it('falls back to linux terminals for unknown platforms', () => {
        const terminals = ExternalTerminalLauncher.getSupportedTerminals('freebsd' as NodeJS.Platform);
        expect(terminals).toEqual(['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
    });
});

// ---------------------------------------------------------------------------
// isTerminalAvailable / getAvailableTerminals
// ---------------------------------------------------------------------------

describe('ExternalTerminalLauncher terminal detection', () => {
    it('detects available terminal via injected execSync', () => {
        const execSyncFn = createExecSyncMock(new Set(['iTerm']));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any);

        expect(launcher.isTerminalAvailable('iterm')).toBe(true);
        expect(launcher.isTerminalAvailable('terminal.app')).toBe(false);
    });

    it('getAvailableTerminals returns only present terminals', () => {
        const execSyncFn = createExecSyncMock(new Set(['gnome-terminal', 'xterm']));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any);

        const available = launcher.getAvailableTerminals();
        expect(available).toContain('gnome-terminal');
        expect(available).toContain('xterm');
        expect(available).not.toContain('konsole');
        expect(available).not.toContain('xfce4-terminal');
    });

    it('caches terminal availability results', () => {
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/wt'));
        const launcher = new ExternalTerminalLauncher('win32', execSyncFn as any);

        launcher.isTerminalAvailable('windows-terminal');
        launcher.isTerminalAvailable('windows-terminal');

        // execSync should be called only once due to caching
        expect(execSyncFn).toHaveBeenCalledTimes(1);
    });

    it('clearCache forces re-detection', () => {
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/wt'));
        const launcher = new ExternalTerminalLauncher('win32', execSyncFn as any);

        launcher.isTerminalAvailable('windows-terminal');
        launcher.clearCache();
        launcher.isTerminalAvailable('windows-terminal');

        expect(execSyncFn).toHaveBeenCalledTimes(2);
    });

    it('returns false for terminals not in current platform config', () => {
        const execSyncFn = vi.fn();
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any);

        // gnome-terminal is a Linux terminal, not macOS
        expect(launcher.isTerminalAvailable('gnome-terminal')).toBe(false);
        // execSync should never be called for a terminal not in the platform config
        expect(execSyncFn).not.toHaveBeenCalled();
    });

    it('returns empty list for unsupported platform with no config', () => {
        const execSyncFn = vi.fn();
        // Internally, unknown platforms map to 'linux', so this actually returns linux terminals.
        // But if we mock execSync to always throw, we get no available terminals.
        execSyncFn.mockImplementation(() => { throw new Error('not found'); });
        const launcher = new ExternalTerminalLauncher('aix' as NodeJS.Platform, execSyncFn as any);
        expect(launcher.getAvailableTerminals()).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// detectTerminal
// ---------------------------------------------------------------------------

describe('ExternalTerminalLauncher.detectTerminal', () => {
    it('returns first available terminal in preference order', () => {
        // On macOS, iterm is preferred over terminal.app
        const execSyncFn = createExecSyncMock(new Set(['Terminal', 'iTerm']));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any);

        expect(launcher.detectTerminal()).toBe('iterm');
    });

    it('falls back to later terminal when preferred is unavailable', () => {
        // Only terminal.app available (iTerm not found)
        const execSyncFn = createExecSyncMock(new Set(['Terminal']));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any);

        expect(launcher.detectTerminal()).toBe('terminal.app');
    });

    it('returns unknown when no terminal is available', () => {
        const execSyncFn = vi.fn().mockImplementation(() => { throw new Error('not found'); });
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any);

        expect(launcher.detectTerminal()).toBe('unknown');
    });
});

// ---------------------------------------------------------------------------
// launch - success
// ---------------------------------------------------------------------------

describe('ExternalTerminalLauncher.launch', () => {
    it('launch resolves with pid on success', async () => {
        const mockChild = createMockChild(12345);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        const result = await launcher.launch({
            workingDirectory: '/home/user/project',
            tool: 'copilot',
        });

        expect(result.success).toBe(true);
        expect(result.pid).toBe(12345);
        expect(result.terminalType).toBe('gnome-terminal');
        expect(mockChild.unref).toHaveBeenCalled();
    });

    it('spawns with detached: true and stdio: ignore', async () => {
        const mockChild = createMockChild(100);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        const spawnOpts = spawnFn.mock.calls[0][2] as SpawnOptions;
        expect(spawnOpts.detached).toBe(true);
        expect(spawnOpts.stdio).toBe('ignore');
    });

    it('sets shell: true on Windows', async () => {
        const mockChild = createMockChild(200);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('C:\\Windows\\System32\\cmd.exe'));
        const launcher = new ExternalTerminalLauncher('win32', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: 'C:\\Users\\test',
            tool: 'copilot',
        });

        const spawnOpts = spawnFn.mock.calls[0][2] as SpawnOptions;
        expect(spawnOpts.shell).toBe(true);
    });

    it('sets shell: false on non-Windows platforms', async () => {
        const mockChild = createMockChild(300);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        const spawnOpts = spawnFn.mock.calls[0][2] as SpawnOptions;
        expect(spawnOpts.shell).toBe(false);
    });

    // -----------------------------------------------------------------------
    // launch - preferred terminal
    // -----------------------------------------------------------------------

    it('uses preferred terminal when available', async () => {
        const mockChild = createMockChild(400);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        // Both gnome-terminal and xterm available
        const execSyncFn = createExecSyncMock(new Set(['gnome-terminal', 'xterm']));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        const result = await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
            preferredTerminal: 'xterm',
        });

        expect(result.terminalType).toBe('xterm');
    });

    it('falls back to auto-detect when preferred terminal is unavailable', async () => {
        const mockChild = createMockChild(500);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        // Only gnome-terminal available
        const execSyncFn = createExecSyncMock(new Set(['gnome-terminal']));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        const result = await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
            preferredTerminal: 'konsole',
        });

        expect(result.terminalType).toBe('gnome-terminal');
    });

    // -----------------------------------------------------------------------
    // launch - failure
    // -----------------------------------------------------------------------

    it('returns error when no terminal is available', async () => {
        const spawnFn = vi.fn();
        const execSyncFn = vi.fn().mockImplementation(() => { throw new Error('not found'); });
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        const result = await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        expect(result.success).toBe(false);
        expect(result.terminalType).toBe('unknown');
        expect(result.error).toContain('No supported terminal found');
        expect(spawnFn).not.toHaveBeenCalled();
    });

    it('returns error when spawn throws', async () => {
        const spawnFn = vi.fn().mockImplementation(() => {
            throw new Error('ENOENT');
        });
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        const result = await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to launch terminal');
        expect(result.error).toContain('ENOENT');
    });

    // -----------------------------------------------------------------------
    // launch - command building
    // -----------------------------------------------------------------------

    it('passes initial prompt to the CLI command', async () => {
        const mockChild = createMockChild(600);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
            initialPrompt: 'hello',
        });

        // The spawn args should contain the prompt somewhere in the command
        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        expect(fullCommand).toContain('hello');
    });

    it('passes model flag to the CLI command', async () => {
        const mockChild = createMockChild(700);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
            model: 'gpt-4',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        expect(fullCommand).toContain('--model gpt-4');
    });

    it('passes resume session ID to the CLI command', async () => {
        const mockChild = createMockChild(800);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
            resumeSessionId: 'session-abc-123',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        expect(fullCommand).toContain('--resume=session-abc-123');
    });
});

// ---------------------------------------------------------------------------
// macOS AppleScript escaping
// ---------------------------------------------------------------------------

describe('AppleScript escaping in macOS terminal launch', () => {
    it('escapes double quotes in workDir for AppleScript', async () => {
        const mockChild = createMockChild(900);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        // Mock iTerm as available
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('true'));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/Users/test/my "project"',
            tool: 'copilot',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        // Double quotes should be escaped as \"
        expect(fullCommand).toContain('my \\"project\\"');
    });

    it('escapes backslashes in workDir for AppleScript', async () => {
        const mockChild = createMockChild(1000);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('true'));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/Users/test/path\\with\\backslashes',
            tool: 'copilot',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        // Backslashes should be escaped as \\
        expect(fullCommand).toContain('path\\\\with\\\\backslashes');
    });

    it('preserves single quotes in workDir for AppleScript (safe in double-quoted strings)', async () => {
        const mockChild = createMockChild(1100);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('true'));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: "/Users/test/it's a project",
            tool: 'copilot',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        // Single quotes should be preserved as-is in AppleScript double-quoted strings
        expect(fullCommand).toContain("it's a project");
    });

    it('handles spaces in workDir for AppleScript', async () => {
        const mockChild = createMockChild(1200);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('true'));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/Users/test/My Project Folder',
            tool: 'copilot',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        expect(fullCommand).toContain('My Project Folder');
    });
});

// ---------------------------------------------------------------------------
// Singleton: getExternalTerminalLauncher / resetExternalTerminalLauncher
// ---------------------------------------------------------------------------

describe('singleton helpers', () => {
    beforeEach(() => {
        resetExternalTerminalLauncher();
    });

    it('getExternalTerminalLauncher returns same instance', () => {
        const a = getExternalTerminalLauncher();
        const b = getExternalTerminalLauncher();
        expect(a).toBe(b);
    });

    it('resetExternalTerminalLauncher clears the singleton', () => {
        const a = getExternalTerminalLauncher();
        resetExternalTerminalLauncher();
        const b = getExternalTerminalLauncher();
        expect(a).not.toBe(b);
    });

    it('getExternalTerminalLauncher returns an ExternalTerminalLauncher', () => {
        const launcher = getExternalTerminalLauncher();
        expect(launcher).toBeInstanceOf(ExternalTerminalLauncher);
    });
});

// ---------------------------------------------------------------------------
// getPlatform
// ---------------------------------------------------------------------------

describe('ExternalTerminalLauncher.getPlatform', () => {
    it('returns the platform passed to constructor', () => {
        const launcher = new ExternalTerminalLauncher('darwin');
        expect(launcher.getPlatform()).toBe('darwin');
    });

    it('defaults to process.platform when not specified', () => {
        const launcher = new ExternalTerminalLauncher();
        expect(launcher.getPlatform()).toBe(process.platform);
    });
});

// ---------------------------------------------------------------------------
// Platform-specific spawn argument structure
// ---------------------------------------------------------------------------

describe('platform-specific spawn arguments', () => {
    it('uses osascript for macOS iTerm', async () => {
        const mockChild = createMockChild(1300);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('true'));
        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        expect(spawnFn.mock.calls[0][0]).toBe('osascript');
    });

    it('uses gnome-terminal binary directly on Linux', async () => {
        const mockChild = createMockChild(1400);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = createExecSyncMock(new Set(['gnome-terminal']));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'copilot',
        });

        expect(spawnFn.mock.calls[0][0]).toBe('gnome-terminal');
        const args = spawnFn.mock.calls[0][1] as string[];
        expect(args).toContain('--working-directory');
        expect(args).toContain('/tmp');
    });

    it('uses wt for Windows Terminal', async () => {
        const mockChild = createMockChild(1500);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = createExecSyncMock(new Set(['wt']));
        const launcher = new ExternalTerminalLauncher('win32', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: 'C:\\Users\\test',
            tool: 'copilot',
        });

        expect(spawnFn.mock.calls[0][0]).toBe('wt');
        const args = spawnFn.mock.calls[0][1] as string[];
        expect(args).toContain('-d');
        expect(args).toContain('C:\\Users\\test');
    });

    it('uses claude command when tool is claude', async () => {
        const mockChild = createMockChild(1600);
        const spawnFn = vi.fn().mockReturnValue(mockChild);
        const execSyncFn = vi.fn().mockReturnValue(Buffer.from('/usr/bin/gnome-terminal'));
        const launcher = new ExternalTerminalLauncher('linux', execSyncFn as any, spawnFn as any);

        await launcher.launch({
            workingDirectory: '/tmp',
            tool: 'claude',
        });

        const spawnArgs = spawnFn.mock.calls[0][1] as string[];
        const fullCommand = spawnArgs.join(' ');
        expect(fullCommand).toContain('claude');
        expect(fullCommand).not.toContain('copilot');
    });
});
