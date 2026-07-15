/**
 * Serve Command
 *
 * Implements the `coc serve` command.
 * Starts the CoC (Copilot Of Copilot) web server.
 *
 * Mirrors packages/deep-wiki/src/commands/serve.ts pattern.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { exec } from 'child_process';
import { EXIT_CODES } from '../cli';
import {
    printSuccess,
    printError,
    printInfo,
    bold,
    cyan,
} from '../logger';
import { loadConfigFile, createProcessStore } from '../config';
import { setupServerLogging } from '../server/logging/setup-server-logging';
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
    const host = options.host ?? '127.0.0.1';
    const dataDir = resolveDataDir(options.dataDir ?? '~/.coc');
    const drainEnabled = options.noDrain !== true;
    const DEFAULT_DRAIN_TIMEOUT_S = 30;
    const drainTimeoutMs = options.drainTimeout !== undefined && options.drainTimeout > 0
        ? options.drainTimeout * 1000
        : DEFAULT_DRAIN_TIMEOUT_S * 1000;

    // Set up Pino loggers before anything else. The shared helper wires the
    // capture proxy + AI-service/SDK/forge loggers identically for the desktop
    // forked server (see server/logging/setup-server-logging.ts).
    const logDir = options.logDir ?? path.join(dataDir, 'logs');
    const fileConfig = loadConfigFile();
    const { coc } = setupServerLogging({
        logLevel: options.logLevel,
        logDir,
        fileConfig,
    });

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    try {
        const { createExecutionServer } = await import('../server/index');

        const store = createProcessStore(dataDir, fileConfig?.store?.backend);

        const server = await createExecutionServer({
            port,
            host,
            dataDir,
            store,
            theme: options.theme ?? 'auto',
            fileConfig,
            containerUrl: options.containerUrl,
            containerAgentName: options.containerAgentName,
            queue: (options.queueRestartPolicy || options.queueHistoryLimit || options.queueRestartDelay !== undefined) ? {
                restartPolicy: options.queueRestartPolicy,
                historyLimit: options.queueHistoryLimit,
                restartPickupDelayMs: options.queueRestartDelay,
            } : undefined,
        });

        const processCount = await server.store.getProcessCount();

        // Print startup banner
        printBanner({
            url: server.url,
            dataDir,
            processCount,
        });

        // Structured log for tooling/file consumers
        coc.info({ url: server.url, dataDir, port }, 'Server started');

        // Open browser unless disabled
        if (options.open !== false) {
            openBrowser(server.url);
        }

        // Wait for SIGINT/SIGTERM with graceful drain support
        await new Promise<void>((resolve) => {
            let signalCount = 0;
            let isShuttingDown = false;

            const shutdown = async (forceImmediate: boolean = false) => {
                if (isShuttingDown && !forceImmediate) {
                    return;
                }
                isShuttingDown = true;
                process.stderr.write('\n');

                if (drainEnabled && !forceImmediate) {
                    const timeoutLabel = ` (timeout: ${drainTimeoutMs / 1000}s — send signal again to force)`;
                    printInfo(`Draining queue before shutdown...${timeoutLabel}`);

                    const result = await server.close({ drain: true, drainTimeoutMs });
                    if (result.drainOutcome === 'timeout') {
                        printInfo('Drain timeout reached — shutting down with tasks still running.');
                    } else {
                        printSuccess('All tasks completed. Server stopped.');
                    }
                } else {
                    printInfo('Shutting down server...');
                    await server.close();
                    printSuccess('Server stopped.');
                }
                resolve();
            };

            const onSignal = () => {
                signalCount++;
                if (signalCount >= 2) {
                    // Force immediate shutdown on second signal
                    process.stderr.write('\n');
                    printInfo('Force shutdown requested.');
                    void shutdown(true);
                } else {
                    void shutdown(false);
                }
            };

            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);

            // On Windows, SIGINT may not fire in all terminal environments.
            // Use readline interface to reliably capture Ctrl+C.
            if (process.platform === 'win32') {
                const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
                rl.on('SIGINT', onSignal);
                rl.on('close', onSignal);
            }
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
    const header = bold('CoC (Copilot Of Copilot)');
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
