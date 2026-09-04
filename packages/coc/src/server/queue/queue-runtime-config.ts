/**
 * The single configuration boundary between the server's authoritative
 * {@link RuntimeConfigService} and the queue/executor graph.
 *
 * Queue execution used to read configuration three incompatible ways: values
 * captured once at startup, live getter callbacks, and no-argument
 * `loadConfigFile()` calls that always resolve `~/.coc/config.yaml` regardless
 * of the `--config` path the server was started with. This port replaces all
 * three with one narrow interface.
 *
 * Design rules:
 * - **Narrow, not a service locator.** Only queue-owned settings get a getter.
 *   Persistence, revisions, source metadata and the admin APIs stay on
 *   `RuntimeConfigService` and never reach the queue.
 * - **Getters, not values.** Every setting here is classified `live` in
 *   `admin-setting-definitions.ts`, so consumers call the getter at the point
 *   the setting is meant to take effect rather than caching it at composition.
 *   A per-task setting is still read once when execution starts, so a mid-task
 *   admin edit cannot change behavior halfway through a turn.
 * - **Explicit source.** Every composition root supplies an adapter. There is
 *   no implicit home-directory fallback, so a server started with an explicit
 *   config path can never execute tasks against a different file.
 */

import { DEFAULT_AI_IDLE_TIMEOUT_MS, DEFAULT_AI_TIMEOUT_MS } from '@plusplusoneplusplus/forge';
import { DEFAULT_CONFIG } from '../../config';
import type { CLIConfig, ResolvedCLIConfig } from '../../config';

// ============================================================================
// Types
// ============================================================================

/** Follow-up suggestion policy applied when a chat turn completes. */
export interface QueueFollowUpSuggestionsConfig {
    readonly enabled: boolean;
    readonly count: number;
}

/** Ask User interactive-tool policy applied when a chat turn is built. */
export interface QueueAskUserConfig {
    readonly enabled: boolean;
}

/**
 * Global skill-folder settings applied across all workspaces. Repo-scoped
 * skill preferences are resolved separately by `resolveSkillConfig` and are
 * deliberately not part of this global port.
 */
export interface QueueSkillFoldersConfig {
    readonly globalExtraFolders?: string[];
    readonly autoDetectDefaultFolders?: boolean;
}

/** Ralph final-check loop policy. */
export interface QueueRalphFinalCheckPolicy {
    readonly maxGapFixLoops: number;
}

/**
 * Typed getters for the configuration the queue and its executors own.
 *
 * Implementations must be side-effect free and cheap: `getSkillFolders()` runs
 * on every task execution, so an implementation must not reparse YAML there.
 */
export interface QueueRuntimeConfig {
    /** Default AI task timeout in ms, for tasks with no `config.timeoutMs`. */
    getDefaultTimeoutMs(): number;
    /** Default AI idle (no streaming activity) timeout in ms. */
    getDefaultIdleTimeoutMs(): number;
    /** Follow-up suggestion policy for the next completed turn. */
    getFollowUpSuggestions(): QueueFollowUpSuggestionsConfig;
    /** Ask User policy for the next turn built. */
    getAskUser(): QueueAskUserConfig;
    /** Global skill-source folder settings for the next skill resolution. */
    getSkillFolders(): QueueSkillFoldersConfig;
    /** Ralph final-check loop policy for the next final check scheduled. */
    getRalphFinalCheckPolicy(): QueueRalphFinalCheckPolicy;
}

// ============================================================================
// Derivation helpers
// ============================================================================

/**
 * Convert the config file's `timeout` (seconds) into the milliseconds the
 * executors expect. Mirrors the conversion in `createExecutionServer` so both
 * sides of the boundary agree on the unit.
 */
export function resolveDefaultTimeoutMs(timeoutSeconds: number | undefined): number {
    return timeoutSeconds ? timeoutSeconds * 1000 : DEFAULT_AI_TIMEOUT_MS;
}

/**
 * Convert the config file's `idleTimeout` (seconds) into milliseconds. Unset or
 * zero falls back to {@link DEFAULT_AI_IDLE_TIMEOUT_MS}, so leaving the admin
 * field blank keeps the 1-hour SDK behaviour.
 */
export function resolveDefaultIdleTimeoutMs(idleTimeoutSeconds: number | undefined): number {
    return idleTimeoutSeconds ? idleTimeoutSeconds * 1000 : DEFAULT_AI_IDLE_TIMEOUT_MS;
}

/**
 * Read every queue-owned setting out of one resolved config snapshot.
 *
 * Kept separate from the adapters so the live adapter and the fixed adapter
 * cannot drift in how they interpret the same snapshot.
 */
function readFromSnapshot(config: ResolvedCLIConfig): {
    timeoutMs: number;
    idleTimeoutMs: number;
    followUpSuggestions: QueueFollowUpSuggestionsConfig;
    askUser: QueueAskUserConfig;
    skillFolders: QueueSkillFoldersConfig;
    ralphFinalCheck: QueueRalphFinalCheckPolicy;
} {
    return {
        timeoutMs: resolveDefaultTimeoutMs(config.timeout),
        idleTimeoutMs: resolveDefaultIdleTimeoutMs(config.idleTimeout),
        followUpSuggestions: config.chat.followUpSuggestions,
        askUser: config.chat.askUser,
        skillFolders: {
            globalExtraFolders: config.skills.globalExtraFolders,
            autoDetectDefaultFolders: config.skills.autoDetectDefaultFolders,
        },
        ralphFinalCheck: {
            maxGapFixLoops: config.ralph.finalCheck.maxGapFixLoops,
        },
    };
}

// ============================================================================
// Adapters
// ============================================================================

/**
 * Minimal view of {@link RuntimeConfigService} this port needs. Typing the
 * parameter structurally keeps the queue layer from depending on the full
 * service surface (updates, listeners, revisions, persistence).
 */
export interface QueueConfigSource {
    readonly config: ResolvedCLIConfig;
}

/**
 * Live adapter over the server's authoritative config service.
 *
 * Each getter re-reads `source.config`, so an admin edit applied through
 * `RuntimeConfigService.updateConfig()` takes effect on the next read without
 * a restart — and always from the config path the server was started with.
 */
export function createQueueRuntimeConfig(source: QueueConfigSource): QueueRuntimeConfig {
    return Object.freeze({
        getDefaultTimeoutMs: () => readFromSnapshot(source.config).timeoutMs,
        getDefaultIdleTimeoutMs: () => readFromSnapshot(source.config).idleTimeoutMs,
        getFollowUpSuggestions: () => readFromSnapshot(source.config).followUpSuggestions,
        getAskUser: () => readFromSnapshot(source.config).askUser,
        getSkillFolders: () => readFromSnapshot(source.config).skillFolders,
        getRalphFinalCheckPolicy: () => readFromSnapshot(source.config).ralphFinalCheck,
    });
}

/**
 * Fixed adapter for composition roots that have no config service — CLI-only
 * entry points and tests that construct a `CLITaskExecutor` directly.
 *
 * Callers pass the config they already resolved (from their own explicit path)
 * plus any direct value overrides. Anything omitted falls back to
 * {@link DEFAULT_CONFIG}; nothing is read from disk, so this adapter can never
 * silently pick up an unrelated `~/.coc/config.yaml`.
 */
export function createFixedQueueRuntimeConfig(overrides: {
    /** Config snapshot the caller already resolved from its own explicit path. */
    config?: CLIConfig;
    defaultTimeoutMs?: number;
    defaultIdleTimeoutMs?: number;
    followUpSuggestions?: QueueFollowUpSuggestionsConfig;
    askUser?: QueueAskUserConfig;
    skillFolders?: QueueSkillFoldersConfig;
    ralphFinalCheck?: QueueRalphFinalCheckPolicy;
} = {}): QueueRuntimeConfig {
    const file = overrides.config;

    const timeoutMs = overrides.defaultTimeoutMs
        ?? resolveDefaultTimeoutMs(file?.timeout);
    const idleTimeoutMs = overrides.defaultIdleTimeoutMs
        ?? resolveDefaultIdleTimeoutMs(file?.idleTimeout);
    const followUpSuggestions: QueueFollowUpSuggestionsConfig = overrides.followUpSuggestions ?? {
        enabled: file?.chat?.followUpSuggestions?.enabled
            ?? DEFAULT_CONFIG.chat.followUpSuggestions.enabled,
        count: file?.chat?.followUpSuggestions?.count
            ?? DEFAULT_CONFIG.chat.followUpSuggestions.count,
    };
    const askUser: QueueAskUserConfig = overrides.askUser ?? {
        enabled: file?.chat?.askUser?.enabled ?? DEFAULT_CONFIG.chat.askUser.enabled,
    };
    const skillFolders: QueueSkillFoldersConfig = overrides.skillFolders ?? {
        globalExtraFolders: file?.skills?.globalExtraFolders,
        autoDetectDefaultFolders: file?.skills?.autoDetectDefaultFolders,
    };
    const ralphFinalCheck: QueueRalphFinalCheckPolicy = overrides.ralphFinalCheck ?? {
        maxGapFixLoops: file?.ralph?.finalCheck?.maxGapFixLoops
            ?? DEFAULT_CONFIG.ralph.finalCheck.maxGapFixLoops,
    };

    return Object.freeze({
        getDefaultTimeoutMs: () => timeoutMs,
        getDefaultIdleTimeoutMs: () => idleTimeoutMs,
        getFollowUpSuggestions: () => followUpSuggestions,
        getAskUser: () => askUser,
        getSkillFolders: () => skillFolders,
        getRalphFinalCheckPolicy: () => ralphFinalCheck,
    });
}

/**
 * Default port for callers that supply nothing at all. Backed entirely by
 * {@link DEFAULT_CONFIG}, never by disk.
 */
export const DEFAULT_QUEUE_RUNTIME_CONFIG: QueueRuntimeConfig = createFixedQueueRuntimeConfig();
