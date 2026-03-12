/**
 * Admin Wipe-Data Command
 *
 * Implements the `coc admin wipe-data` CLI command.
 * Deletes all runtime data (processes, workspaces, wikis, queues, preferences)
 * while preserving system configuration files.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { EXIT_CODES } from '../cli';
import {
    printSuccess,
    printError,
    printInfo,
    printWarning,
    bold,
    red,
    yellow,
    cyan,
    dim,
} from '../logger';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { DataWiper } from '@plusplusoneplusplus/coc-server';
import type { WipeResult } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

export interface WipeDataCommandOptions {
    /** Auto-confirm without interactive prompt. */
    confirm?: boolean;
    /** Include wiki output directories in the wipe. */
    includeWikis?: boolean;
    /** Preview what would be deleted without executing. */
    dryRun?: boolean;
    /** Data directory (default: ~/.coc). */
    dataDir?: string;
    /** Disable colored output. */
    noColor?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function resolveDataDir(input: string): string {
    if (input.startsWith('~')) {
        return path.join(os.homedir(), input.slice(1));
    }
    return path.resolve(input);
}

function askQuestion(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function printSummary(result: WipeResult, dryRun: boolean): void {
    const prefix = dryRun ? '[DRY RUN] ' : '';
    const verb = dryRun ? 'Would delete' : 'Deleted';

    printInfo('');
    printInfo(`${prefix}${bold('Wipe Summary:')}`);
    printInfo(`  Processes:    ${verb} ${cyan(String(result.deletedProcesses))}`);
    printInfo(`  Workspaces:   ${verb} ${cyan(String(result.deletedWorkspaces))}`);
    printInfo(`  Wikis:        ${verb} ${cyan(String(result.deletedWikis))}`);
    printInfo(`  Queue files:  ${verb} ${cyan(String(result.deletedQueues))}`);
    printInfo(`  Preferences:  ${result.deletedPreferences ? verb : 'None to delete'}`);

    if (result.deletedWikiDirs.length > 0) {
        printInfo(`  Wiki dirs:    ${verb} ${cyan(String(result.deletedWikiDirs.length))} directory(ies)`);
        for (const dir of result.deletedWikiDirs) {
            printInfo(`    - ${dim(dir)}`);
        }
    }

    if (result.preservedFiles.length > 0) {
        printInfo('');
        printInfo(`  ${bold('Preserved:')}`);
        for (const f of result.preservedFiles) {
            printInfo(`    ✓ ${dim(f)}`);
        }
    }

    if (result.errors.length > 0) {
        printInfo('');
        printWarning(`  ${bold('Errors:')} ${result.errors.length}`);
        for (const err of result.errors) {
            printError(`    ✗ ${err}`);
        }
    }
}

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Execute the admin wipe-data command.
 */
export async function executeWipeData(options: WipeDataCommandOptions): Promise<number> {
    const dataDir = resolveDataDir(options.dataDir ?? '~/.coc');

    const store = new FileProcessStore({ dataDir });
    const wiper = new DataWiper(dataDir, store);

    try {
        // Always show preview first
        const preview = await wiper.getDryRunSummary({ includeWikis: options.includeWikis ?? false });

        const totalItems = preview.deletedProcesses
            + preview.deletedWorkspaces
            + preview.deletedWikis
            + preview.deletedQueues
            + (preview.deletedPreferences ? 1 : 0);

        if (totalItems === 0) {
            printInfo('Nothing to delete — data directory is already clean.');
            return EXIT_CODES.SUCCESS;
        }

        // Show what will be deleted
        printSummary(preview, true);

        if (options.dryRun) {
            return EXIT_CODES.SUCCESS;
        }

        // Confirmation
        if (!options.confirm) {
            printInfo('');
            printWarning(red(bold('⚠  This action is irreversible!')));
            printInfo(`   Config files (${dim('config.yaml')}) will be preserved.`);
            printInfo('');

            const answer = await askQuestion(
                yellow("Type 'DELETE ALL DATA' to proceed: ")
            );

            if (answer !== 'DELETE ALL DATA') {
                printInfo('Aborted — no data was deleted.');
                return EXIT_CODES.SUCCESS;
            }
        }

        // Execute wipe
        const result = await wiper.wipeData({
            includeWikis: options.includeWikis ?? false,
        });

        printSummary(result, false);

        if (result.errors.length > 0) {
            printWarning('Wipe completed with some errors.');
            return EXIT_CODES.EXECUTION_ERROR;
        }

        printSuccess('All runtime data wiped successfully.');
        return EXIT_CODES.SUCCESS;
    } catch (err: any) {
        printError(`Wipe failed: ${err.message}`);
        return EXIT_CODES.EXECUTION_ERROR;
    }
}
