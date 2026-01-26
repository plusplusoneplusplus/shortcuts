/**
 * Tests for ExternalTerminalLauncher
 *
 * Comprehensive cross-platform tests for launching external terminals.
 * Tests cover macOS, Windows, and Linux terminal detection and launching.
 */

import * as assert from 'assert';
import { ChildProcess } from 'child_process';
import { ExternalTerminalLauncher } from '../../shortcuts/ai-service/external-terminal-launcher';
import { buildCliCommand, escapeShellArg } from '@plusplusoneplusplus/pipeline-core';
import { TerminalType, ExternalTerminalLaunchOptions } from '../../shortcuts/ai-service/types';

// ============================================================================
// Mock Types
// ============================================================================

interface SpawnCall {
    cmd: string;
    args: string[];
    options: any;
}

interface ExecSyncCall {
    command: string;
    options: any;
}

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock execSync function that simulates terminal availability
 */
function createMockExecSync(availableTerminals: Set<string>): {
    fn: typeof import('child_process').execSync;
    calls: ExecSyncCall[];
} {
    const calls: ExecSyncCall[] = [];

    const fn = ((command: string, options?: any) => {
        calls.push({ command, options });

        // Check if the command is checking for a terminal we have marked as available
        for (const terminal of availableTerminals) {
            if (command.includes(terminal)) {
                return Buffer.from(`/usr/bin/${terminal}`);
            }
        }

        // Terminal not found - throw error like real execSync would
        const error = new Error(`Command failed: ${command}`);
        (error as any).status = 1;
        throw error;
    }) as typeof import('child_process').execSync;

    return { fn, calls };
}

/**
 * Create a mock spawn function
 */
function createMockSpawn(): {
    fn: typeof import('child_process').spawn;
    calls: SpawnCall[];
} {
    const calls: SpawnCall[] = [];

    const fn = ((cmd: string, args: string[], options: any) => {
        calls.push({ cmd, args, options });

        // Return a mock ChildProcess
        const mockProcess = {
            pid: 12345,
            unref: () => { },
            on: () => mockProcess,
            stdout: null,
            stderr: null,
            stdin: null,
            killed: false,
            exitCode: null,
            signalCode: null,
            spawnargs: args,
            spawnfile: cmd
        } as unknown as ChildProcess;

        return mockProcess;
    }) as typeof import('child_process').spawn;

    return { fn, calls };
}

// ============================================================================
// buildCliCommand Tests
// ============================================================================

suite('ExternalTerminalLauncher - buildCliCommand', () => {
    test('should build basic copilot command without prompt', () => {
        const result = buildCliCommand('copilot');
        // Now includes base flags by default
        assert.strictEqual(result.command, 'copilot --allow-all-tools --allow-all-paths --disable-builtin-mcps');
        assert.strictEqual(result.deliveryMethod, 'direct');
    });

    test('should build basic claude command without prompt', () => {
        const result = buildCliCommand('claude');
        // Now includes base flags by default
        assert.strictEqual(result.command, 'claude --allow-all-tools --allow-all-paths --disable-builtin-mcps');
        assert.strictEqual(result.deliveryMethod, 'direct');
    });

    test('should build copilot command with simple prompt using direct delivery', () => {
        // Simple prompt without special characters should use direct delivery
        const result = buildCliCommand('copilot', { prompt: 'Hello world' });

        // The result should contain the interactive prompt flag
        assert.ok(result.command.includes('-i'), 'Should include -i flag for interactive mode');
        assert.ok(result.command.includes('Hello world'), 'Should include prompt text');
        assert.strictEqual(result.deliveryMethod, 'direct');
    });

    test('should build claude command with simple prompt using direct delivery', () => {
        const result = buildCliCommand('claude', { prompt: 'Explain this code' });

        assert.ok(result.command.includes('claude'), 'Should include claude command');
        assert.ok(result.command.includes('-i'), 'Should include -i flag for interactive mode');
        assert.ok(result.command.includes('Explain this code'), 'Should include prompt text');
        assert.strictEqual(result.deliveryMethod, 'direct');
    });

    test('should use file delivery for prompts with special characters', () => {
        // Prompts with quotes/special chars should use file delivery
        const result = buildCliCommand('copilot', { prompt: "it's a \"test\"" });

        // Should use file delivery due to quotes
        assert.strictEqual(result.deliveryMethod, 'file');
        assert.ok(result.tempFilePath, 'Should have temp file path');
        assert.ok(result.command.includes('-i'), 'Should include -i flag for interactive mode');
        assert.ok(result.command.includes('Follow the instructions in'), 'Should include redirect prompt');
    });
});

// ============================================================================
// escapeShellArg Tests (for external-terminal-launcher specific)
// ============================================================================

suite('ExternalTerminalLauncher - escapeShellArg', () => {
    suite('Unix/macOS Shell Escaping', () => {
        const platform: NodeJS.Platform = 'darwin';

        test('should wrap in single quotes', () => {
            const result = escapeShellArg('hello world', platform);
            assert.strictEqual(result, "'hello world'");
        });

        test('should escape single quotes', () => {
            const result = escapeShellArg("it's a test", platform);
            assert.strictEqual(result, "'it'\\''s a test'");
        });

        test('should handle empty string', () => {
            const result = escapeShellArg('', platform);
            assert.strictEqual(result, "''");
        });
    });

    suite('Windows Shell Escaping', () => {
        const platform: NodeJS.Platform = 'win32';

        test('should wrap in double quotes', () => {
            const result = escapeShellArg('hello world', platform);
            assert.strictEqual(result, '"hello world"');
        });

        test('should escape double quotes', () => {
            const result = escapeShellArg('say "hello"', platform);
            assert.strictEqual(result, '"say ""hello"""');
        });

        test('should escape percent signs', () => {
            const result = escapeShellArg('100% complete', platform);
            assert.strictEqual(result, '"100%% complete"');
        });

        test('should escape exclamation marks', () => {
            const result = escapeShellArg('Hello!', platform);
            assert.strictEqual(result, '"Hello^!"');
        });

        test('should convert newlines to literal \\n', () => {
            const result = escapeShellArg('line1\nline2', platform);
            assert.strictEqual(result, '"line1\\nline2"');
        });
    });

    suite('Linux Shell Escaping', () => {
        const platform: NodeJS.Platform = 'linux';

        test('should behave same as macOS', () => {
            const darwin = escapeShellArg('test "quote"', 'darwin');
            const linux = escapeShellArg('test "quote"', 'linux');
            assert.strictEqual(darwin, linux);
        });
    });
});

// ============================================================================
// macOS Terminal Tests
// ============================================================================

suite('ExternalTerminalLauncher - macOS', () => {
    const platform: NodeJS.Platform = 'darwin';

    suite('Terminal Detection', () => {
        test('should detect iTerm when available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'iterm');
        });

        test('should fall back to Terminal.app when iTerm not available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'terminal.app');
        });

        test('should return unknown when no terminal available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'unknown');
        });

        test('should prefer iTerm over Terminal.app', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm', 'Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'iterm');
        });
    });

    suite('Terminal Availability', () => {
        test('should report iTerm as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('iterm');

            assert.strictEqual(result, true);
        });

        test('should report Terminal.app as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('terminal.app');

            assert.strictEqual(result, true);
        });

        test('should report terminal as unavailable when not installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('iterm');

            assert.strictEqual(result, false);
        });

        test('should cache terminal availability results', () => {
            const { fn: execSyncFn, calls } = createMockExecSync(new Set(['iTerm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            // First call
            launcher.isTerminalAvailable('iterm');
            const callsAfterFirst = calls.length;

            // Second call should use cache
            launcher.isTerminalAvailable('iterm');
            assert.strictEqual(calls.length, callsAfterFirst);
        });

        test('should clear cache when requested', () => {
            const { fn: execSyncFn, calls } = createMockExecSync(new Set(['iTerm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            launcher.isTerminalAvailable('iterm');
            const callsAfterFirst = calls.length;

            launcher.clearCache();

            launcher.isTerminalAvailable('iterm');
            assert.strictEqual(calls.length, callsAfterFirst + 1);
        });
    });

    suite('Available Terminals', () => {
        test('should return all available terminals', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm', 'Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.getAvailableTerminals();

            assert.deepStrictEqual(result, ['iterm', 'terminal.app']);
        });

        test('should return empty array when no terminals available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.getAvailableTerminals();

            assert.deepStrictEqual(result, []);
        });
    });

    suite('Launch Terminal', () => {
        test('should launch iTerm with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/path/to/project',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'iterm');
            assert.strictEqual(result.pid, 12345);

            // Verify spawn was called with osascript
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].cmd, 'osascript');
            assert.ok(calls[0].args.some(arg => arg.includes('iTerm')));
        });

        test('should launch Terminal.app when iTerm not available', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/path/to/project',
                tool: 'claude'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'terminal.app');

            // Verify spawn was called with osascript for Terminal.app
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].cmd, 'osascript');
            assert.ok(calls[0].args.some(arg => arg.includes('Terminal')));
        });

        test('should use preferred terminal when specified and available', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['iTerm', 'Terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/path/to/project',
                tool: 'copilot',
                preferredTerminal: 'terminal.app'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'terminal.app');
        });

        test('should include initial prompt in command', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/path/to/project',
                tool: 'copilot',
                initialPrompt: 'Explain this code'
            };

            await launcher.launch(options);

            // Verify the command includes the prompt
            const args = calls[0].args.join(' ');
            assert.ok(args.includes('copilot'), 'Should include copilot command');
            assert.ok(args.includes('-i'), 'Should include -i flag for interactive mode');
        });

        test('should return error when no terminal available', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/path/to/project',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.terminalType, 'unknown');
            assert.ok(result.error?.includes('No supported terminal'));
        });

        test('should set detached and stdio options for spawn', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            await launcher.launch({
                workingDirectory: '/test',
                tool: 'copilot'
            });

            assert.strictEqual(calls[0].options.detached, true);
            assert.strictEqual(calls[0].options.stdio, 'ignore');
        });
    });
});

// ============================================================================
// Windows Terminal Tests
// ============================================================================

suite('ExternalTerminalLauncher - Windows', () => {
    const platform: NodeJS.Platform = 'win32';

    suite('Terminal Detection', () => {
        test('should detect Windows Terminal when available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['wt']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'windows-terminal');
        });

        test('should fall back to PowerShell when Windows Terminal not available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['powershell']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'powershell');
        });

        test('should fall back to cmd when others not available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'cmd');
        });

        test('should return unknown when no terminal available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'unknown');
        });

        test('should prefer Windows Terminal over PowerShell over cmd', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['wt', 'powershell', 'cmd']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'windows-terminal');
        });
    });

    suite('Terminal Availability', () => {
        test('should report Windows Terminal as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['wt']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('windows-terminal');

            assert.strictEqual(result, true);
        });

        test('should report PowerShell as available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['powershell']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('powershell');

            assert.strictEqual(result, true);
        });

        test('should report cmd as available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('cmd');

            assert.strictEqual(result, true);
        });
    });

    suite('Launch Terminal', () => {
        test('should launch Windows Terminal with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['wt']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: 'C:\\Projects\\myapp',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'windows-terminal');

            // Verify spawn was called with wt
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].cmd, 'wt');
            assert.ok(calls[0].args.includes('-d'));
            assert.ok(calls[0].args.includes('C:\\Projects\\myapp'));
        });

        test('should launch PowerShell with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['powershell']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: 'C:\\Projects',
                tool: 'claude'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'powershell');

            assert.strictEqual(calls[0].cmd, 'powershell');
            assert.ok(calls[0].args.includes('-NoExit'));
        });

        test('should launch cmd with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: 'C:\\Projects',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'cmd');

            assert.strictEqual(calls[0].cmd, 'cmd');
            assert.ok(calls[0].args.includes('/k'));
        });

        test('should set shell option to true for Windows', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            await launcher.launch({
                workingDirectory: 'C:\\test',
                tool: 'copilot'
            });

            assert.strictEqual(calls[0].options.shell, true);
        });
    });
});

// ============================================================================
// Linux Terminal Tests
// ============================================================================

suite('ExternalTerminalLauncher - Linux', () => {
    const platform: NodeJS.Platform = 'linux';

    suite('Terminal Detection', () => {
        test('should detect gnome-terminal when available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'gnome-terminal');
        });

        test('should fall back to konsole when gnome-terminal not available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['konsole']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'konsole');
        });

        test('should fall back to xfce4-terminal', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xfce4-terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'xfce4-terminal');
        });

        test('should fall back to xterm as last resort', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xterm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'xterm');
        });

        test('should return unknown when no terminal available', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'unknown');
        });

        test('should follow preference order', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.detectTerminal();

            assert.strictEqual(result, 'gnome-terminal');
        });
    });

    suite('Terminal Availability', () => {
        test('should report gnome-terminal as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('gnome-terminal');

            assert.strictEqual(result, true);
        });

        test('should report konsole as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['konsole']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('konsole');

            assert.strictEqual(result, true);
        });

        test('should report xfce4-terminal as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xfce4-terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('xfce4-terminal');

            assert.strictEqual(result, true);
        });

        test('should report xterm as available when installed', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xterm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('xterm');

            assert.strictEqual(result, true);
        });
    });

    suite('Launch Terminal', () => {
        test('should launch gnome-terminal with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/home/user/projects',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'gnome-terminal');

            assert.strictEqual(calls[0].cmd, 'gnome-terminal');
            assert.ok(calls[0].args.includes('--working-directory'));
            assert.ok(calls[0].args.includes('/home/user/projects'));
        });

        test('should launch konsole with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['konsole']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/home/user/projects',
                tool: 'claude'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'konsole');

            assert.strictEqual(calls[0].cmd, 'konsole');
            assert.ok(calls[0].args.includes('--workdir'));
        });

        test('should launch xfce4-terminal with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xfce4-terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/home/user/projects',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'xfce4-terminal');

            assert.strictEqual(calls[0].cmd, 'xfce4-terminal');
            assert.ok(calls[0].args.includes('--working-directory'));
        });

        test('should launch xterm with correct arguments', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xterm']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            const options: ExternalTerminalLaunchOptions = {
                workingDirectory: '/home/user/projects',
                tool: 'copilot'
            };

            const result = await launcher.launch(options);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'xterm');

            assert.strictEqual(calls[0].cmd, 'xterm');
            assert.ok(calls[0].args.includes('-e'));
        });

        test('should not set shell option for Linux', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal']));
            const { fn: spawnFn, calls } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher(platform, execSyncFn, spawnFn);

            await launcher.launch({
                workingDirectory: '/test',
                tool: 'copilot'
            });

            assert.strictEqual(calls[0].options.shell, false);
        });
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('ExternalTerminalLauncher - Cross-Platform', () => {

    suite('getSupportedTerminals Static Method', () => {
        test('should return macOS terminals for darwin', () => {
            const terminals = ExternalTerminalLauncher.getSupportedTerminals('darwin');
            assert.deepStrictEqual(terminals, ['iterm', 'terminal.app']);
        });

        test('should return Windows terminals for win32', () => {
            const terminals = ExternalTerminalLauncher.getSupportedTerminals('win32');
            assert.deepStrictEqual(terminals, ['windows-terminal', 'powershell', 'cmd']);
        });

        test('should return Linux terminals for linux', () => {
            const terminals = ExternalTerminalLauncher.getSupportedTerminals('linux');
            assert.deepStrictEqual(terminals, ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
        });

        test('should return Linux terminals for other Unix platforms', () => {
            const terminals = ExternalTerminalLauncher.getSupportedTerminals('freebsd');
            assert.deepStrictEqual(terminals, ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
        });
    });

    suite('getPlatform', () => {
        test('should return the platform it was constructed with', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set());
            const { fn: spawnFn } = createMockSpawn();

            const darwinLauncher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);
            assert.strictEqual(darwinLauncher.getPlatform(), 'darwin');

            const win32Launcher = new ExternalTerminalLauncher('win32', execSyncFn, spawnFn);
            assert.strictEqual(win32Launcher.getPlatform(), 'win32');

            const linuxLauncher = new ExternalTerminalLauncher('linux', execSyncFn, spawnFn);
            assert.strictEqual(linuxLauncher.getPlatform(), 'linux');
        });
    });

    suite('Preferred Terminal Fallback', () => {
        test('should fall back to detected terminal when preferred not available - macOS', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);

            const result = await launcher.launch({
                workingDirectory: '/test',
                tool: 'copilot',
                preferredTerminal: 'iterm' // Not available
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'terminal.app');
        });

        test('should fall back to detected terminal when preferred not available - Windows', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('win32', execSyncFn, spawnFn);

            const result = await launcher.launch({
                workingDirectory: 'C:\\test',
                tool: 'copilot',
                preferredTerminal: 'windows-terminal' // Not available
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'cmd');
        });

        test('should fall back to detected terminal when preferred not available - Linux', async () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['xterm']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('linux', execSyncFn, spawnFn);

            const result = await launcher.launch({
                workingDirectory: '/test',
                tool: 'copilot',
                preferredTerminal: 'gnome-terminal' // Not available
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.terminalType, 'xterm');
        });
    });

    suite('Invalid Terminal Type', () => {
        test('should return false for unsupported terminal type on macOS', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('gnome-terminal');

            assert.strictEqual(result, false);
        });

        test('should return false for unsupported terminal type on Windows', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['cmd']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('win32', execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('iterm');

            assert.strictEqual(result, false);
        });

        test('should return false for unsupported terminal type on Linux', () => {
            const { fn: execSyncFn } = createMockExecSync(new Set(['gnome-terminal']));
            const { fn: spawnFn } = createMockSpawn();

            const launcher = new ExternalTerminalLauncher('linux', execSyncFn, spawnFn);
            const result = launcher.isTerminalAvailable('windows-terminal');

            assert.strictEqual(result, false);
        });
    });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

suite('ExternalTerminalLauncher - Edge Cases', () => {
    test('should handle spawn throwing an error', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));

        const throwingSpawn = (() => {
            throw new Error('Spawn failed');
        }) as typeof import('child_process').spawn;

        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, throwingSpawn);

        const result = await launcher.launch({
            workingDirectory: '/test',
            tool: 'copilot'
        });

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Failed to launch terminal'));
    });

    test('should handle working directory with spaces - macOS', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
        const { fn: spawnFn, calls } = createMockSpawn();

        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);

        await launcher.launch({
            workingDirectory: '/path/to/my project',
            tool: 'copilot'
        });

        // Verify the path is included in the command
        const allArgs = calls[0].args.join(' ');
        assert.ok(allArgs.includes('/path/to/my project'));
    });

    test('should handle working directory with spaces - Windows', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['wt']));
        const { fn: spawnFn, calls } = createMockSpawn();

        const launcher = new ExternalTerminalLauncher('win32', execSyncFn, spawnFn);

        await launcher.launch({
            workingDirectory: 'C:\\My Projects\\app',
            tool: 'copilot'
        });

        // Verify the path is in the arguments
        assert.ok(calls[0].args.includes('C:\\My Projects\\app'));
    });

    test('should handle prompt with special characters', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
        const { fn: spawnFn, calls } = createMockSpawn();

        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);

        await launcher.launch({
            workingDirectory: '/test',
            tool: 'copilot',
            initialPrompt: 'What does "request->set" do?'
        });

        // Should not throw and should include the prompt
        assert.strictEqual(calls.length, 1);
    });

    test('should handle empty initial prompt', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
        const { fn: spawnFn, calls } = createMockSpawn();

        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);

        await launcher.launch({
            workingDirectory: '/test',
            tool: 'copilot',
            initialPrompt: ''
        });

        // Should launch without the -i flag (interactive mode with prompt)
        const allArgs = calls[0].args.join(' ');
        assert.ok(!allArgs.includes('-i'), 'Should not include -i flag for empty prompt');
    });

    test('should handle undefined initial prompt', async () => {
        const { fn: execSyncFn } = createMockExecSync(new Set(['Terminal']));
        const { fn: spawnFn, calls } = createMockSpawn();

        const launcher = new ExternalTerminalLauncher('darwin', execSyncFn, spawnFn);

        await launcher.launch({
            workingDirectory: '/test',
            tool: 'copilot'
            // initialPrompt not provided
        });

        // Should launch without the -i flag (interactive mode with prompt)
        const allArgs = calls[0].args.join(' ');
        assert.ok(!allArgs.includes('-i'), 'Should not include -i flag for undefined prompt');
    });
});
