/**
 * Serve Command
 *
 * Implements the `pipeline serve` command.
 * Starts the AI Execution Dashboard web server.
 *
 * Mirrors packages/deep-wiki/src/commands/serve.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { EXIT_CODES } from '../cli';
import {
    printSuccess,
    printError,
    printInfo,
    bold,
    cyan,
} from '../logger';
import type { ServeCommandOptions } from '../server/types';

// ============================================================================
// Execute Serve Command
// ============================================================================

/**
 * Execute the serve command.
 *
 * @param options - Command options
 * @returns Exit code (never returns normally — server runs until SIGINT)
 */
export async function executeServe(options: ServeCommandOptions): Promise<number> {
    const port = options.port ?? 4000;
    const host = options.host ?? 'localhost';
    const dataDir = resolveDataDir(options.dataDir ?? '~/.pipeline-server');

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    try {
        const { createExecutionServer } = await import('../server/index');

        const server = await createExecutionServer({
            port,
            host,
            dataDir,
            theme: options.theme ?? 'auto',
        });

        // Load process count for banner
        const processes = await server.store.getAllProcesses();
        const processCount = processes.length;

        // Print startup banner
        printBanner({
            url: server.url,
            dataDir,
            processCount,
        });

        // Open browser unless disabled
        if (options.open !== false) {
            openBrowser(server.url);
        }

        // Wait for SIGINT/SIGTERM
        await new Promise<void>((resolve) => {
            const shutdown = async () => {
                process.stderr.write('\n');
                printInfo('Shutting down server...');
                await server.close();
                printSuccess('Server stopped.');
                resolve();
            };
            process.on('SIGINT', () => void shutdown());
            process.on('SIGTERM', () => void shutdown());
        });

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('EADDRINUSE')) {
            printError(`Port ${port} is already in use. Try a different port with --port.`);
        } else {
            printError(`Failed to start server: ${errMsg}`);
        }
        return EXIT_CODES.EXECUTION_ERROR;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve data directory path, expanding `~` to home directory.
 */
function resolveDataDir(dir: string): string {
    if (dir.startsWith('~')) {
        return path.join(os.homedir(), dir.slice(1));
    }
    return path.resolve(dir);
}

/**
 * Print startup banner to stderr.
 */
function printBanner(info: { url: string; dataDir: string; processCount: number }): void {
    const header = bold('AI Execution Dashboard');
    const line = '───────────────────────────';
    const lines = [
        '',
        `┌─────────────────────────────────────┐`,
        `│  ${header}`,
        `│  ${line}`,
        `│  Local:     ${cyan(info.url)}`,
        `│  Data:      ${info.dataDir}`,
        `│  Processes: ${info.processCount}`,
        `│`,
        `│  Press ${bold('Ctrl+C')} to stop`,
        `└─────────────────────────────────────┘`,
        '',
    ];
    process.stderr.write(lines.join('\n') + '\n');
}

/**
 * Open the default browser to the given URL.
 * Cross-platform: uses `open` on macOS, `start` on Windows, `xdg-open` on Linux.
 */
function openBrowser(url: string): void {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
        command = `open "${url}"`;
    } else if (platform === 'win32') {
        command = `start "" "${url}"`;
    } else {
        command = `xdg-open "${url}"`;
    }

    exec(command, (error: Error | null) => {
        if (error) {
            printInfo(`Could not open browser automatically. Open ${url} manually.`);
        }
    });
}

// Export for testing
export { resolveDataDir, printBanner, openBrowser };
