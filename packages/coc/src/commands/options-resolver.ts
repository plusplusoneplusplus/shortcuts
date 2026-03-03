/**
 * CLI Options Resolver
 *
 * Dedicated resolver functions that merge CLI options with config defaults
 * for each command. Eliminates inline type assertions and manual field mapping
 * from command handlers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ResolvedCLIConfig } from '../config';
import type { RunCommandOptions } from './run';
import type { WipeDataCommandOptions } from './wipe-data';
import type { OutputFormat } from '../output-formatter';
import type { ServeCommandOptions } from '@plusplusoneplusplus/coc-server';

/**
 * Resolve options for the run command.
 * CLI flags take precedence over config file values.
 */
export function resolveRunOptions(
    opts: Record<string, unknown>,
    config: ResolvedCLIConfig
): RunCommandOptions {
    return {
        model: (opts.model as string) || config.model,
        parallel: (opts.parallel as number) || config.parallel,
        output: ((opts.output as string) || config.output) as OutputFormat,
        outputFile: opts.outputFile as string | undefined,
        workspaceRoot: opts.workspaceRoot as string | undefined,
        params: opts.param as Record<string, string>,
        verbose: Boolean(opts.verbose),
        dryRun: Boolean(opts.dryRun),
        timeout: (opts.timeout as number) || config.timeout,
        noColor: !opts.color,
        approvePermissions: Boolean(opts.approvePermissions) || config.approvePermissions,
        persist: (opts.persist as boolean) ?? config.persist,
        dataDir: config.serve?.dataDir,
    };
}

/**
 * Resolve options for the list command.
 */
export function resolveListOptions(
    opts: Record<string, unknown>,
    config: ResolvedCLIConfig
): { format: OutputFormat } {
    return {
        format: ((opts.output as string) || config.output) as OutputFormat,
    };
}

/**
 * Resolve options for the serve command.
 */
export function resolveServeOptions(
    opts: Record<string, unknown>,
    config: ResolvedCLIConfig
): ServeCommandOptions {
    return {
        port: (opts.port as number | undefined) ?? config.serve?.port,
        host: (opts.host as string | undefined) ?? config.serve?.host,
        dataDir: (opts.dataDir as string | undefined) ?? config.serve?.dataDir,
        open: opts.open as boolean | undefined,
        theme: ((opts.theme as string | undefined) ?? config.serve?.theme) as ServeCommandOptions['theme'],
        noColor: opts.color === false,
        drainTimeout: opts.drainTimeout as number | undefined,
        noDrain: opts.drain === false,
        queueRestartPolicy: (opts.queueRestartPolicy as ServeCommandOptions['queueRestartPolicy'] | undefined) ?? config.queue?.restartPolicy,
        queueHistoryLimit: (opts.queueHistoryLimit as number | undefined) ?? config.queue?.historyLimit,
    };
}

/**
 * Resolve options for the admin wipe-data command.
 */
export function resolveWipeDataOptions(
    opts: Record<string, unknown>,
    config: ResolvedCLIConfig
): WipeDataCommandOptions {
    return {
        confirm: Boolean(opts.confirm),
        includeWikis: Boolean(opts.includeWikis),
        dryRun: Boolean(opts.dryRun),
        dataDir: (opts.dataDir as string | undefined) ?? config.serve?.dataDir,
        noColor: opts.color === false,
    };
}
