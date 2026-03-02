/**
 * CLI Argument Parser
 *
 * Defines the CLI commands and options using Commander.
 * Routes parsed arguments to the appropriate command handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { Command } from 'commander';
import { executeRun } from './commands/run';
import { executeValidate } from './commands/validate';
import { executeList } from './commands/list';
import { resolveRunOptions, resolveListOptions, resolveServeOptions, resolveWipeDataOptions } from './commands/options-resolver';
import { resolveConfig } from './config';
import type { ResolvedCLIConfig } from './config';
import { setColorEnabled, setVerbosity } from './logger';

// ============================================================================
// Exit Codes
// ============================================================================

export const EXIT_CODES = {
    SUCCESS: 0,
    EXECUTION_ERROR: 1,
    CONFIG_ERROR: 2,
    AI_UNAVAILABLE: 3,
    RESTART_REQUESTED: 75,
    CANCELLED: 130,
} as const;

// ============================================================================
// CLI Setup
// ============================================================================

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
    const program = new Command();

    program
        .name('coc')
        .description('CoC (Copilot of Copilot) - Execute YAML-based AI pipelines from the command line')
        .version('1.0.0');

    // ========================================================================
    // coc run <path>
    // ========================================================================

    program
        .command('run')
        .description('Execute a pipeline from a YAML file')
        .argument('<path>', 'Path to pipeline.yaml or pipeline package directory')
        .option('-m, --model <model>', 'Override AI model')
        .option('-p, --parallel <number>', 'Override parallelism limit', parseInt)
        .option('-o, --output <format>', 'Output format: table, json, csv, markdown', 'table')
        .option('-f, --output-file <path>', 'Write results to file instead of stdout')
        .option('-w, --workspace-root <path>', 'Workspace root for skill resolution')
        .option('--param <key=value...>', 'Pipeline parameters (repeatable)', collectParams, {})
        .option('-v, --verbose', 'Verbose logging with per-item progress', false)
        .option('--dry-run', 'Parse and validate without executing', false)
        .option('--timeout <seconds>', 'Overall execution timeout in seconds', parseInt)
        .option('--no-color', 'Disable colored output')
        .option('--approve-permissions', 'Auto-approve all AI permission requests', false)
        .option('--no-persist', 'Do not save run results to process store')
        .action(async (pipelinePath: string, opts: Record<string, unknown>) => {
            const config = resolveConfig();
            applyGlobalOptions(opts, config);
            const options = resolveRunOptions(opts, config);

            const exitCode = await executeRun(pipelinePath, options);
            process.exit(exitCode);
        });

    // ========================================================================
    // coc validate <path>
    // ========================================================================

    program
        .command('validate')
        .description('Validate a pipeline YAML file without executing')
        .argument('<path>', 'Path to pipeline.yaml or pipeline package directory')
        .option('--no-color', 'Disable colored output')
        .action((pipelinePath: string, opts: Record<string, unknown>) => {
            const config = resolveConfig();
            applyGlobalOptions(opts, config);

            const exitCode = executeValidate(pipelinePath);
            process.exit(exitCode);
        });

    // ========================================================================
    // coc list [dir]
    // ========================================================================

    program
        .command('list')
        .description('List pipeline packages in a directory')
        .argument('[dir]', 'Directory to scan for pipeline packages', '.')
        .option('-o, --output <format>', 'Output format: table, json, csv, markdown', 'table')
        .option('--no-color', 'Disable colored output')
        .action((dirPath: string, opts: Record<string, unknown>) => {
            const config = resolveConfig();
            applyGlobalOptions(opts, config);
            const { format } = resolveListOptions(opts, config);

            const exitCode = executeList(dirPath, format);
            process.exit(exitCode);
        });

    // ========================================================================
    // coc serve
    // ========================================================================

    program
        .command('serve')
        .description('Start the CoC (Copilot Of Copilot) web server')
        .option('-p, --port <number>', 'Port number', (v: string) => parseInt(v, 10))
        .option('-H, --host <string>', 'Bind address')
        .option('-d, --data-dir <path>', 'Data directory for process storage')
        .option('--no-open', 'Don\'t auto-open browser')
        .option('--theme <theme>', 'UI theme: auto, light, dark')
        .option('--drain-timeout <seconds>', 'Max wait for queue drain on shutdown (default: infinite)', (v: string) => parseInt(v, 10))
        .option('--no-drain', 'Skip graceful queue draining on shutdown')
        .option('--no-color', 'Disable colored output')
        .action(async (opts: Record<string, unknown>) => {
            const config = resolveConfig();
            applyGlobalOptions(opts, config);
            const options = resolveServeOptions(opts, config);

            const { executeServe } = await import('./commands/serve');
            const exitCode = await executeServe(options);
            process.exit(exitCode);
        });

    // ========================================================================
    // coc admin wipe-data
    // ========================================================================

    const admin = program
        .command('admin')
        .description('Administrative commands');

    admin
        .command('wipe-data')
        .description('Delete all runtime data (processes, workspaces, wikis, queues, preferences)')
        .option('--confirm', 'Skip interactive confirmation', false)
        .option('--include-wikis', 'Also delete generated wiki output directories', false)
        .option('--dry-run', 'Preview what would be deleted without executing', false)
        .option('-d, --data-dir <path>', 'Data directory for process storage')
        .option('--no-color', 'Disable colored output')
        .action(async (opts: Record<string, unknown>) => {
            const config = resolveConfig();
            applyGlobalOptions(opts, config);
            const options = resolveWipeDataOptions(opts, config);

            const { executeWipeData } = await import('./commands/wipe-data');
            const exitCode = await executeWipeData(options);
            process.exit(exitCode);
        });

    return program;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Collect --param key=value pairs into an object
 */
function collectParams(value: string, previous: Record<string, string>): Record<string, string> {
    const [key, ...rest] = value.split('=');
    if (key && rest.length > 0) {
        previous[key] = rest.join('=');
    }
    return previous;
}

/**
 * Apply global options (colors, verbosity) based on CLI flags and config
 */
function applyGlobalOptions(opts: Record<string, unknown>, config: ResolvedCLIConfig): void {
    // Handle --no-color: commander sets color: false when --no-color is used
    if (opts.color === false) {
        setColorEnabled(false);
    }

    // Also respect NO_COLOR env variable
    if (process.env.NO_COLOR !== undefined) {
        setColorEnabled(false);
    }

    // Set verbosity
    if (opts.verbose) {
        setVerbosity('verbose');
    }
}
