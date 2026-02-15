/**
 * CLI Argument Parser
 *
 * Defines the CLI commands and options using Commander.
 * Routes parsed arguments to the appropriate command handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import { Command } from 'commander';
import { getErrorMessage } from './utils/error-utils';
import { setColorEnabled, setVerbosity, getVerbosity, printInfo } from './logger';
import { loadConfig, mergeConfigWithCLI, discoverConfigFile } from './config-loader';

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
    // deep-wiki init
    // ========================================================================

    program
        .command('init')
        .description('Generate a template deep-wiki.config.yaml configuration file')
        .option('-o, --output <path>', 'Output file path', 'deep-wiki.config.yaml')
        .option('--force', 'Overwrite existing file', false)
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);
            const { executeInit } = await import('./commands/init');
            const exitCode = await executeInit({
                output: opts.output as string | undefined,
                force: Boolean(opts.force),
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki seeds [repo-path]
    // ========================================================================

    program
        .command('seeds')
        .description('Generate theme seeds for breadth-first discovery')
        .argument('[repo-path]', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output file path', 'seeds.json')
        .option('--max-themes <n>', 'Maximum number of themes to generate', (v: string) => parseInt(v, 10), 50)
        .option('-m, --model <model>', 'AI model to use')
        .option('-t, --timeout <seconds>', 'Timeout in seconds for seeds session', (v: string) => parseInt(v, 10))
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string | undefined, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);
            const resolvedRepoPath = resolveRepoPath(repoPath, undefined);
            if (!resolvedRepoPath) {
                process.stderr.write('Error: No repository path provided. Pass <repo-path> or set repoPath in deep-wiki.config.yaml\n');
                process.exit(EXIT_CODES.CONFIG_ERROR);
            }
            if (resolvedRepoPath !== repoPath) {
                getVerbosity() === 'verbose' && printInfo(`Using repoPath from config: ${resolvedRepoPath}`);
            }
            const { executeSeeds } = await import('./commands/seeds');
            const exitCode = await executeSeeds(resolvedRepoPath, {
                output: opts.output as string,
                maxThemes: (opts.maxThemes as number) || 50,
                model: opts.model as string | undefined,
                timeout: opts.timeout as number | undefined,
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki discover [repo-path]
    // ========================================================================

    program
        .command('discover')
        .description('Discover component graph for a repository')
        .argument('[repo-path]', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output directory for results', './wiki')
        .option('-m, --model <model>', 'AI model to use')
        .option('-t, --timeout <seconds>', 'Timeout in seconds for discovery', (v: string) => parseInt(v, 10))
        .option('--focus <path>', 'Focus discovery on a specific subtree')
        .option('--seeds <path>', 'Path to seeds file for breadth-first discovery, or "auto" to generate')
        .option('--large-repo-threshold <number>', 'File count threshold for multi-round discovery (default: 3000)', (v: string) => parseInt(v, 10))
        .option('--force', 'Ignore cache, regenerate discovery', false)
        .option('--use-cache', 'Use existing cache regardless of git hash', false)
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string | undefined, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);
            const resolvedRepoPath = resolveRepoPath(repoPath, undefined);
            if (!resolvedRepoPath) {
                process.stderr.write('Error: No repository path provided. Pass <repo-path> or set repoPath in deep-wiki.config.yaml\n');
                process.exit(EXIT_CODES.CONFIG_ERROR);
            }
            if (resolvedRepoPath !== repoPath) {
                getVerbosity() === 'verbose' && printInfo(`Using repoPath from config: ${resolvedRepoPath}`);
            }

            // Lazy-load to avoid loading heavy deps when just checking --help
            const { executeDiscover } = await import('./commands/discover');
            const exitCode = await executeDiscover(resolvedRepoPath, {
                output: opts.output as string,
                model: opts.model as string | undefined,
                timeout: opts.timeout as number | undefined,
                focus: opts.focus as string | undefined,
                seeds: opts.seeds as string | undefined,
                largeRepoThreshold: opts.largeRepoThreshold as number | undefined,
                force: Boolean(opts.force),
                useCache: Boolean(opts.useCache),
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki generate [repo-path]  (stub for future phases)
    // ========================================================================

    program
        .command('generate')
        .description('Generate full wiki for a repository (Discovery → Analysis → Articles → Website)')
        .argument('[repo-path]', 'Path to the local git repository')
        .option('-o, --output <path>', 'Output directory for wiki', './wiki')
        .option('-m, --model <model>', 'AI model to use')
        .option('-c, --concurrency <number>', 'Number of parallel AI sessions', (v: string) => parseInt(v, 10))
        .option('-t, --timeout <seconds>', 'Timeout in seconds per phase', (v: string) => parseInt(v, 10))
        .option('--focus <path>', 'Focus on a specific subtree')
        .option('--seeds <path>', 'Path to seeds file for breadth-first discovery, or "auto" to generate')
        .option('--large-repo-threshold <number>', 'File count threshold for multi-round discovery (default: 3000)', (v: string) => parseInt(v, 10))
        .option('--depth <level>', 'Article detail level: shallow, normal, deep', 'normal')
        .option('--force', 'Ignore cache, regenerate everything', false)
        .option('--use-cache', 'Use existing cache regardless of git hash', false)
        .option('--phase <number>', 'Start from phase N (uses cached prior phases)', (v: string) => parseInt(v, 10))
        .option('--end-phase <number>', 'End at phase N (only run phases from --phase to --end-phase)', (v: string) => parseInt(v, 10))
        .option('--skip-website', 'Skip website generation (Phase 5)', false)
        .option('--no-cluster', 'Skip component consolidation (keep original granularity)')
        .option('--no-strict', 'Allow partial failures (default: strict, any failure aborts)')
        .option('--theme <theme>', 'Website theme: light, dark, auto', 'auto')
        .option('--title <title>', 'Override project name in website title')
        .option('--config <path>', 'Path to YAML configuration file (deep-wiki.config.yaml)')
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
            applyGlobalOptions(opts);

            // Build base CLI options
            let cliOptions: import('./types').GenerateCommandOptions = {
                output: opts.output as string,
                model: opts.model as string | undefined,
                concurrency: opts.concurrency as number | undefined,
                timeout: opts.timeout as number | undefined,
                focus: opts.focus as string | undefined,
                seeds: opts.seeds as string | undefined,
                largeRepoThreshold: opts.largeRepoThreshold as number | undefined,
                depth: (opts.depth as 'shallow' | 'normal' | 'deep') || 'normal',
                force: Boolean(opts.force),
                useCache: Boolean(opts.useCache),
                phase: opts.phase as number | undefined,
                endPhase: opts.endPhase as number | undefined,
                skipWebsite: Boolean(opts.skipWebsite),
                noCluster: opts.cluster === false,
                strict: opts.strict !== false,
                theme: (opts.theme as 'light' | 'dark' | 'auto') || undefined,
                title: opts.title as string | undefined,
                verbose: Boolean(opts.verbose),
                config: opts.config as string | undefined,
            };

            // Load config file if --config is specified, or auto-discover
            const configSearchDir = repoPath || process.cwd();
            const configPath = cliOptions.config || discoverConfigFile(configSearchDir);
            if (configPath) {
                try {
                    const config = loadConfig(configPath);
                    // Determine which CLI flags were explicitly set (not defaults)
                    const explicitFields = getExplicitFields(cmd, opts);
                    cliOptions = mergeConfigWithCLI(config, cliOptions, explicitFields);
                    // Resolve config repoPath relative to config file directory
                    if (cliOptions.repoPath && config.repoPath) {
                        cliOptions.repoPath = path.resolve(path.dirname(configPath), config.repoPath);
                    }
                    if (cliOptions.verbose) {
                        printInfo(`Loaded config from ${configPath}`);
                    }
                } catch (e) {
                    // If --config was explicitly passed, this is a fatal error
                    if (opts.config) {
                        process.stderr.write(`Error: ${getErrorMessage(e)}\n`);
                        process.exit(EXIT_CODES.CONFIG_ERROR);
                    }
                    // Auto-discovered config with errors — warn and continue
                    if (cliOptions.verbose) {
                        process.stderr.write(`Warning: Ignoring config file: ${getErrorMessage(e)}\n`);
                    }
                }
            }

            // Resolve repo path: CLI positional arg overrides config
            const resolvedRepoPath = repoPath || cliOptions.repoPath;
            if (!resolvedRepoPath) {
                process.stderr.write('Error: No repository path provided. Pass <repo-path> or set repoPath in deep-wiki.config.yaml\n');
                process.exit(EXIT_CODES.CONFIG_ERROR);
            }
            if (!repoPath && cliOptions.repoPath) {
                getVerbosity() === 'verbose' && printInfo(`Using repoPath from config: ${cliOptions.repoPath}`);
            }

            const { executeGenerate } = await import('./commands/generate');
            const exitCode = await executeGenerate(resolvedRepoPath, cliOptions);
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki theme <repo-path> [theme-name]
    // ========================================================================

    program
        .command('theme')
        .description('Generate focused wiki articles about a specific theme/feature')
        .argument('<repo-path>', 'Path to the repository to analyze')
        .argument('[theme-name]', 'Theme to generate (e.g., "compaction", "authentication")')
        .option('-d, --description <text>', 'Description to guide theme discovery')
        .option('-w, --wiki <path>', 'Path to existing wiki directory', './wiki')
        .option('--force', 'Regenerate even if theme already exists', false)
        .option('--check', 'Only check if theme exists, do not generate', false)
        .option('--list', 'List existing theme articles', false)
        .option('-m, --model <model>', 'AI model to use')
        .option('--depth <level>', 'Article detail level: shallow, normal, deep', 'normal')
        .option('-t, --timeout <seconds>', 'Timeout per AI call in seconds', (v: string) => parseInt(v, 10), 120)
        .option('-c, --concurrency <number>', 'Parallel AI sessions', (v: string) => parseInt(v, 10), 3)
        .option('--no-cross-link', 'Skip cross-linking component articles')
        .option('--no-website', 'Skip website regeneration')
        .option('--interactive', 'Review outline before generating', false)
        .option('-v, --verbose', 'Verbose output', false)
        .option('--no-color', 'Disable colored output')
        .action(async (repoPath: string, themeName: string | undefined, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);
            const { executeTheme } = await import('./commands/theme');
            const exitCode = await executeTheme(repoPath, themeName, {
                theme: themeName ?? '',
                description: opts.description as string | undefined,
                wiki: opts.wiki as string,
                force: Boolean(opts.force),
                check: Boolean(opts.check),
                list: Boolean(opts.list),
                model: opts.model as string | undefined,
                depth: (opts.depth as 'shallow' | 'normal' | 'deep') || 'normal',
                timeout: (opts.timeout as number) || 120,
                concurrency: (opts.concurrency as number) || 3,
                noCrossLink: opts.crossLink === false,
                noWebsite: opts.website === false,
                interactive: Boolean(opts.interactive),
                verbose: Boolean(opts.verbose),
            });
            process.exit(exitCode);
        });

    // ========================================================================
    // deep-wiki serve <wiki-dir>
    // ========================================================================

    program
        .command('serve')
        .description('Start an interactive server to explore the wiki')
        .argument('<wiki-dir>', 'Path to the wiki output directory')
        .option('-p, --port <number>', 'Port to listen on', (v: string) => parseInt(v, 10), 3000)
        .option('-H, --host <address>', 'Bind address', 'localhost')
        .option('-g, --generate [repo-path]', 'Generate wiki before serving (uses config repoPath if omitted)')
        .option('-w, --watch', 'Watch repo for changes (requires --generate)', false)
        .option('--no-ai', 'Disable AI Q&A and deep-dive features')
        .option('-m, --model <model>', 'AI model for Q&A sessions')
        .option('--open', 'Open browser automatically', false)
        .option('--theme <theme>', 'Website theme: light, dark, auto', 'auto')
        .option('--title <title>', 'Override project name in website title')
        .option('-v, --verbose', 'Verbose logging', false)
        .option('--no-color', 'Disable colored output')
        .action(async (wikiDir: string, opts: Record<string, unknown>) => {
            applyGlobalOptions(opts);

            // Resolve --generate: if boolean true (no value), fall back to config repoPath
            let generateRepoPath: string | undefined;
            if (opts.generate === true) {
                // --generate was passed without a value; try config fallback
                generateRepoPath = resolveRepoPath(undefined, undefined);
                if (!generateRepoPath) {
                    process.stderr.write('Error: --generate requires a repo path or repoPath in deep-wiki.config.yaml\n');
                    process.exit(EXIT_CODES.CONFIG_ERROR);
                }
                getVerbosity() === 'verbose' && printInfo(`Using repoPath from config for --generate: ${generateRepoPath}`);
            } else if (typeof opts.generate === 'string') {
                generateRepoPath = opts.generate;
            }

            const { executeServe } = await import('./commands/serve');
            const exitCode = await executeServe(wikiDir, {
                port: opts.port as number | undefined,
                host: opts.host as string | undefined,
                generate: generateRepoPath,
                watch: Boolean(opts.watch),
                ai: Boolean(opts.ai),
                model: opts.model as string | undefined,
                open: Boolean(opts.open),
                theme: opts.theme as string | undefined,
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
 * Resolve the repository path from CLI positional arg or config file.
 *
 * Priority: CLI arg > config file repoPath > undefined
 *
 * @param cliRepoPath - Positional argument from CLI (may be undefined)
 * @param configPath - Explicit config file path (may be undefined)
 * @returns Resolved repo path, or undefined if neither source provides one
 */
export function resolveRepoPath(cliRepoPath: string | undefined, configPath: string | undefined): string | undefined {
    if (cliRepoPath) {
        return cliRepoPath;
    }

    // Try to discover config file in CWD and read repoPath
    const discoveredConfigPath = configPath || discoverConfigFile(process.cwd());
    if (discoveredConfigPath) {
        try {
            const config = loadConfig(discoveredConfigPath);
            if (config.repoPath) {
                return path.resolve(path.dirname(discoveredConfigPath), config.repoPath);
            }
        } catch {
            // Config file errors are handled by individual command actions
        }
    }

    return undefined;
}

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

/**
 * Determine which CLI option fields were explicitly set by the user (not defaults).
 * Uses Commander's internal state to distinguish user-provided values from defaults.
 *
 * @param cmd - The Commander Command instance
 * @param opts - The parsed options object
 * @returns Set of field names that were explicitly provided
 */
function getExplicitFields(cmd: Command, opts: Record<string, unknown>): Set<string> {
    const explicit = new Set<string>();

    // Commander tracks which options were explicitly set via setOptionValueWithSource
    // We can check the source: 'cli' means user passed it, 'default' means it's a default
    for (const option of cmd.options) {
        const key = option.attributeName();
        const source = cmd.getOptionValueSource(key);
        if (source === 'cli') {
            // Map Commander's attribute names to our field names
            explicit.add(key);
        }
    }

    return explicit;
}
