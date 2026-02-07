/**
 * CLI Argument Parser
 *
 * Defines the CLI commands and options using Commander.
 * Routes parsed arguments to the appropriate command handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { Command } from 'commander';
import { setColorEnabled, setVerbosity } from './logger';

// ============================================================================
// Exit Codes
// ============================================================================

export const EXIT_CODES = {
    SUCCESS: 0,
    EXECUTION_ERROR: 1,
    CONFIG_ERROR: 2,
    AI_UNAVAILABLE: 3,
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
        .name('deep-wiki')
        .description('Auto-generate comprehensive wikis for any codebase')
        .version('1.0.0');

    // ========================================================================
    // deep-wiki discover <repo-path>
    // ========================================================================

    program
        .command('discover')
        .description('Discover module graph for a repository')
        .argument('<repo-path>', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output directory for results', './wiki')
        .option('-m, --model <model>', 'AI model to use')
        .option('-t, --timeout <seconds>', 'Timeout in seconds for discovery', parseInt)
        .option('--focus <path>', 'Focus discovery on a specific subtree')
        .option('--force', 'Ignore cache, regenerate discovery', false)
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);

            // Lazy-load to avoid loading heavy deps when just checking --help
            const { executeDiscover } = await import('./commands/discover');
            const exitCode = await executeDiscover(repoPath, {
                output: opts.output as string,
                model: opts.model as string | undefined,
                timeout: opts.timeout as number | undefined,
                focus: opts.focus as string | undefined,
                force: Boolean(opts.force),
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki generate <repo-path>  (stub for future phases)
    // ========================================================================

    program
        .command('generate')
        .description('Generate full wiki for a repository (Discovery → Analysis → Articles)')
        .argument('<repo-path>', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output directory for wiki', './wiki')
        .option('-m, --model <model>', 'AI model to use')
        .option('-c, --concurrency <number>', 'Number of parallel AI sessions', parseInt)
        .option('-t, --timeout <seconds>', 'Timeout in seconds per phase', parseInt)
        .option('--focus <path>', 'Focus on a specific subtree')
        .option('--depth <level>', 'Article detail level: shallow, normal, deep', 'normal')
        .option('--force', 'Ignore cache, regenerate everything', false)
        .option('--phase <number>', 'Start from phase N (uses cached prior phases)', parseInt)
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);

            const { executeGenerate } = await import('./commands/generate');
            const exitCode = await executeGenerate(repoPath, {
                output: opts.output as string,
                model: opts.model as string | undefined,
                concurrency: opts.concurrency as number | undefined,
                timeout: opts.timeout as number | undefined,
                focus: opts.focus as string | undefined,
                depth: (opts.depth as 'shallow' | 'normal' | 'deep') || 'normal',
                force: Boolean(opts.force),
                phase: opts.phase as number | undefined,
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    return program;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Apply global options (colors, verbosity) based on CLI flags
 */
function applyGlobalOptions(opts: Record<string, unknown>): void {
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
