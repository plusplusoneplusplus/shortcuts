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
    // deep-wiki seeds <repo-path>
    // ========================================================================

    program
        .command('seeds')
        .description('Generate topic seeds for breadth-first discovery')
        .argument('<repo-path>', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output file path', 'seeds.json')
        .option('--max-topics <n>', 'Maximum number of topics to generate', parseInt, 20)
        .option('--min-topics <n>', 'Minimum number of topics', parseInt, 5)
        .option('-m, --model <model>', 'AI model to use')
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);
            const { executeSeeds } = await import('./commands/seeds');
            const exitCode = await executeSeeds(repoPath, {
                output: opts.output as string,
                maxTopics: (opts.maxTopics as number) || 20,
                minTopics: (opts.minTopics as number) || 5,
                model: opts.model as string | undefined,
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

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
        .option('--seeds <path>', 'Path to seeds file for breadth-first discovery, or "auto" to generate')
        .option('--force', 'Ignore cache, regenerate discovery', false)
        .option('--use-cache', 'Use existing cache regardless of git hash', false)
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
                seeds: opts.seeds as string | undefined,
                force: Boolean(opts.force),
                useCache: Boolean(opts.useCache),
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki generate <repo-path>  (stub for future phases)
    // ========================================================================

    program
        .command('generate')
        .description('Generate full wiki for a repository (Discovery → Analysis → Articles → Website)')
        .argument('<repo-path>', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output directory for wiki', './wiki')
        .option('-m, --model <model>', 'AI model to use')
        .option('-c, --concurrency <number>', 'Number of parallel AI sessions', parseInt)
        .option('-t, --timeout <seconds>', 'Timeout in seconds per phase', parseInt)
        .option('--focus <path>', 'Focus on a specific subtree')
        .option('--seeds <path>', 'Path to seeds file for breadth-first discovery, or "auto" to generate')
        .option('--depth <level>', 'Article detail level: shallow, normal, deep', 'normal')
        .option('--force', 'Ignore cache, regenerate everything', false)
        .option('--use-cache', 'Use existing cache regardless of git hash', false)
        .option('--phase <number>', 'Start from phase N (uses cached prior phases)', parseInt)
        .option('--skip-website', 'Skip website generation (Phase 4)', false)
        .option('--theme <theme>', 'Website theme: light, dark, auto', 'auto')
        .option('--title <title>', 'Override project name in website title')
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
                seeds: opts.seeds as string | undefined,
                depth: (opts.depth as 'shallow' | 'normal' | 'deep') || 'normal',
                force: Boolean(opts.force),
                useCache: Boolean(opts.useCache),
                phase: opts.phase as number | undefined,
                skipWebsite: Boolean(opts.skipWebsite),
                theme: (opts.theme as 'light' | 'dark' | 'auto') || undefined,
                title: opts.title as string | undefined,
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
