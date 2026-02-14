/**
 * Init Command
 *
 * Generates a template `deep-wiki.config.yaml` configuration file.
 * Writes to the current directory or a specified output path.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { printSuccess, printError, printInfo } from '../logger';

// ============================================================================
// Template
// ============================================================================

/**
 * The template content for `deep-wiki.config.yaml`.
 * All options are commented out so users can uncomment only what they need.
 */
export const CONFIG_TEMPLATE = `# Deep Wiki Configuration
# Place this file at your repo root as deep-wiki.config.yaml
# CLI flags override these values. Per-phase settings override global settings.
#
# Resolution order (highest priority first):
#   1. CLI flags (--model, --timeout, etc.)
#   2. Phase-specific config (phases.analysis.model)
#   3. Global config file values (model, timeout, etc.)
#   4. Built-in defaults

# ── Global Settings ──────────────────────────────────────────────

# output: ./wiki                # Output directory for generated wiki
# model: claude-sonnet          # AI model (applies to all phases unless overridden)
# concurrency: 5                # Max parallel AI sessions
# timeout: 300                  # Timeout per phase in seconds
# depth: normal                 # Article detail level: shallow | normal | deep
# focus: src/                   # Focus on a specific subtree (e.g. "src/")
# theme: auto                   # Website theme: light | dark | auto
# title: My Project Wiki        # Override project name in website title
# seeds: auto                   # Seeds file path, or "auto" to generate
# force: false                  # Ignore all caches, regenerate everything
# useCache: false               # Use cache regardless of git hash changes
# noCluster: false              # Skip module consolidation (Phase 2)
# strict: true                  # Fail pipeline if any module fails
# skipWebsite: false            # Skip static website generation (Phase 5)
# phase: 1                      # Start from phase N (1-4)
# endPhase: 5                   # End at phase N (1-5), only runs phases from phase to endPhase

# ── Per-Phase Overrides ──────────────────────────────────────────
# Each phase can override: model, timeout, concurrency, depth
# Consolidation also supports: skipAI

# phases:
#   discovery:
#     model: claude-opus        # Use a stronger model for discovery
#     timeout: 300
#     concurrency: 3
#
#   consolidation:
#     skipAI: false             # Set to true to skip AI-based clustering
#
#   analysis:
#     model: claude-sonnet
#     depth: deep               # More detailed module analysis
#     timeout: 180
#     concurrency: 8
#
#   writing:
#     model: claude-sonnet
#     depth: normal
#     timeout: 600
#     concurrency: 5
`;

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Options for the `deep-wiki init` command.
 */
export interface InitCommandOptions {
    /** Output file path (default: deep-wiki.config.yaml in cwd) */
    output?: string;
    /** Overwrite existing file without prompting */
    force: boolean;
    /** Verbose logging */
    verbose: boolean;
}

/**
 * Execute the `deep-wiki init` command.
 *
 * @param options - Command options
 * @returns Exit code (0 = success, 1 = error)
 */
/** Default configuration file name */
export const DEFAULT_CONFIG_FILENAME = 'deep-wiki.config.yaml';

export async function executeInit(options: InitCommandOptions): Promise<number> {
    let outputPath = path.resolve(options.output || DEFAULT_CONFIG_FILENAME);

    // If the output path is an existing directory, or ends with a path separator,
    // treat it as a directory and append the default config filename.
    const endsWithSep = options.output?.endsWith('/') || options.output?.endsWith(path.sep);
    if (endsWithSep || (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory())) {
        outputPath = path.join(outputPath, DEFAULT_CONFIG_FILENAME);
    }

    if (options.verbose) {
        printInfo(`Writing config template to ${outputPath}`);
    }

    // Check if file already exists
    if (fs.existsSync(outputPath) && !options.force) {
        printError(`File already exists: ${outputPath}`);
        printInfo('Use --force to overwrite the existing file.');
        return 1;
    }

    // Ensure parent directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        fs.writeFileSync(outputPath, CONFIG_TEMPLATE, 'utf-8');
        printSuccess(`Created config template: ${outputPath}`);
        return 0;
    } catch (e) {
        printError(`Failed to write config file: ${(e as Error).message}`);
        return 1;
    }
}
