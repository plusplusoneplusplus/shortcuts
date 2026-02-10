/**
 * Serve Command
 *
 * Implements the `deep-wiki serve <wiki-dir>` command.
 * Starts an HTTP server to host the wiki with interactive features.
 *
 * Options:
 *   --port <n>           Port to listen on (default: 3000)
 *   --host <addr>        Bind address (default: localhost)
 *   --generate <repo>    Generate wiki before serving
 *   --watch              Watch repo for changes (requires --generate)
 *   --no-ai              Disable AI Q&A and deep-dive features (enabled by default)
 *   --model <model>      AI model for Q&A sessions
 *   --open               Open browser on start
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import { createServer } from '../server';
import type { AskAIFunction } from '../server';
import { EXIT_CODES } from '../cli';
import {
    printSuccess,
    printError,
    printWarning,
    printInfo,
    printHeader,
    printKeyValue,
    bold,
} from '../logger';
import type { ServeCommandOptions } from '../types';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Execute Serve Command
// ============================================================================

/**
 * Execute the serve command.
 *
 * @param wikiDir - Path to the wiki output directory
 * @param options - Command options
 * @returns Exit code (never returns normally — server runs until SIGINT)
 */
export async function executeServe(
    wikiDir: string,
    options: ServeCommandOptions
): Promise<number> {
    const resolvedWikiDir = path.resolve(wikiDir);

    // ================================================================
    // Optional: Generate wiki before serving
    // ================================================================
    if (options.generate) {
        const repoPath = path.resolve(options.generate);

        if (!fs.existsSync(repoPath)) {
            printError(`Repository path does not exist: ${repoPath}`);
            return EXIT_CODES.CONFIG_ERROR;
        }

        printHeader('Generating wiki before serving...');

        try {
            const { executeGenerate } = await import('./generate');
            const exitCode = await executeGenerate(repoPath, {
                output: resolvedWikiDir,
                model: options.model,
                depth: 'normal',
                force: false,
                useCache: true,
                verbose: false,
            });

            if (exitCode !== EXIT_CODES.SUCCESS) {
                printError('Wiki generation failed. Cannot serve.');
                return exitCode;
            }
        } catch (error) {
            printError(`Wiki generation failed: ${getErrorMessage(error)}`);
            return EXIT_CODES.EXECUTION_ERROR;
        }
    }

    // ================================================================
    // Validate wiki directory
    // ================================================================
    if (!fs.existsSync(resolvedWikiDir)) {
        printError(`Wiki directory does not exist: ${resolvedWikiDir}`);
        printInfo('Run `deep-wiki generate <repo-path>` first, or use `--generate <repo-path>`.');
        return EXIT_CODES.CONFIG_ERROR;
    }

    const graphPath = path.join(resolvedWikiDir, 'module-graph.json');
    if (!fs.existsSync(graphPath)) {
        printError(`module-graph.json not found in ${resolvedWikiDir}`);
        printInfo('The wiki directory does not contain generated wiki data.');
        printInfo('Run `deep-wiki generate <repo-path>` first, or use `--generate <repo-path>`.');
        return EXIT_CODES.CONFIG_ERROR;
    }

    // ================================================================
    // Watch mode validation
    // ================================================================
    if (options.watch && !options.generate) {
        printWarning('--watch requires --generate <repo-path>. Ignoring --watch.');
    }

    // ================================================================
    // Initialize AI service if enabled
    // ================================================================
    const aiEnabled = options.ai !== false; // Default to true
    let aiSendMessage: AskAIFunction | undefined;

    if (aiEnabled) {
        try {
            aiSendMessage = await createAISendFunction(options.model, resolvedWikiDir);
            printInfo('AI service initialized successfully.');
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            printWarning(`AI service unavailable: ${errMsg}`);
            printWarning('Server will start without AI features.');
        }
    }

    // ================================================================
    // Start server
    // ================================================================
    printHeader('Deep Wiki — Interactive Server');
    printKeyValue('Wiki Directory', resolvedWikiDir);
    printKeyValue('Port', String(options.port || 3000));
    printKeyValue('Host', options.host || 'localhost');
    printKeyValue('AI Features', aiSendMessage ? 'Enabled' : aiEnabled ? 'Unavailable' : 'Disabled');
    if (options.watch && options.generate) { printKeyValue('Watch Mode', 'Enabled'); }
    process.stderr.write('\n');

    try {
        const wiki = await createServer({
            wikiDir: resolvedWikiDir,
            port: options.port || 3000,
            host: options.host || 'localhost',
            aiEnabled: !!aiSendMessage,
            aiSendMessage,
            aiModel: options.model,
            repoPath: options.generate ? path.resolve(options.generate) : resolvedWikiDir,
            theme: (options.theme as 'light' | 'dark' | 'auto') || 'auto',
            title: options.title,
        });

        printSuccess(`Server running at ${bold(wiki.url)}`);
        printInfo('Press Ctrl+C to stop.');

        // Open browser if requested
        if (options.open) {
            openBrowser(wiki.url);
        }

        // Wait for SIGINT/SIGTERM
        await new Promise<void>((resolve) => {
            const shutdown = async () => {
                process.stderr.write('\n');
                printInfo('Shutting down server...');
                await wiki.close();
                printSuccess('Server stopped.');
                resolve();
            };

            process.on('SIGINT', () => void shutdown());
            process.on('SIGTERM', () => void shutdown());
        });

        return EXIT_CODES.SUCCESS;

    } catch (error) {
        const errMsg = getErrorMessage(error);
        if (errMsg.includes('EADDRINUSE')) {
            printError(`Port ${options.port || 3000} is already in use. Try a different port with --port.`);
        } else {
            printError(`Failed to start server: ${errMsg}`);
        }
        return EXIT_CODES.EXECUTION_ERROR;
    }
}

// ============================================================================
// AI Initialization
// ============================================================================

/**
 * Create an AskAIFunction that wraps the Copilot SDK service.
 *
 * Uses direct sessions (usePool: false) without MCP tools —
 * all wiki context is provided in the prompt by the context builder.
 *
 * @param defaultModel - Default AI model override
 * @param defaultWorkingDirectory - Default working directory for SDK sessions (typically the wiki directory)
 * @returns A function matching the AskAIFunction signature
 */
async function createAISendFunction(
    defaultModel?: string,
    defaultWorkingDirectory?: string,
): Promise<AskAIFunction> {
    const { getCopilotSDKService } = await import('@plusplusoneplusplus/pipeline-core');
    const service = getCopilotSDKService();

    // Verify the service is available before returning the function
    const availability = await service.isAvailable();
    if (!availability.available) {
        throw new Error(availability.error || 'Copilot SDK is not available');
    }

    return async (prompt: string, options?: { model?: string; workingDirectory?: string; onStreamingChunk?: (chunk: string) => void }): Promise<string> => {
        const result = await service.sendMessage({
            prompt,
            model: options?.model || defaultModel,
            workingDirectory: options?.workingDirectory || defaultWorkingDirectory,
            usePool: false,
            loadDefaultMcpConfig: false,
            onStreamingChunk: options?.onStreamingChunk,
        });

        if (!result.success) {
            throw new Error(result.error || 'AI request failed');
        }

        return result.response || '';
    };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Open the default browser to the given URL.
 * Cross-platform: uses `open` on macOS, `start` on Windows, `xdg-open` on Linux.
 */
function openBrowser(url: string): void {
    const { exec } = require('child_process') as typeof import('child_process');

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
            printWarning(`Could not open browser automatically. Open ${url} manually.`);
        }
    });
}
