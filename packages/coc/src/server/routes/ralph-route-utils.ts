import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { RalphSessionRecord } from '../ralph/types';
import { AiSelectionParseError, isReasoningEffort, parseAiSelection, type AiSelection } from '../tasks/ai-selection';
import { isAutoProviderRoutingRequested, parseAutoProviderRoutingContext } from '../tasks/auto-provider-routing';
import { resolveChatProvider } from '../tasks/task-types';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

// Shared utilities for Ralph session resume routes and final-check gap loops.
export const RALPH_RESUME_HARD_CAP = 500;
export const RALPH_RESUME_ADDITIONAL_LIMIT = 200;

export interface InFlightRalphTask {
    id: string;
    status: 'queued' | 'running';
}

export type AdditionalIterationsResult =
    | { value: number | undefined }
    | { error: string };

export interface RecoveredIterationPaths {
    workingDirectory: string | undefined;
    folderPath: string | undefined;
    provider: ChatProvider | undefined;
    model: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
    autoProviderRouting?: boolean;
    effortTier?: RalphEffortTier;
}

export type RalphEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface RalphAiSelection {
    provider: ChatProvider | undefined;
    model: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
    effortTier: RalphEffortTier | undefined;
    autoProviderRouting: boolean | undefined;
}

export type RalphAiSelectionParseResult =
    | { value: RalphAiSelection }
    | { error: string };

const VALID_RALPH_EFFORT_TIERS: ReadonlySet<string> = new Set(['very-low', 'low', 'medium', 'high']);

export function findInFlightRalphTask(
    bridge: MultiRepoQueueRouter,
    sessionId: string,
): InFlightRalphTask | undefined {
    for (const manager of bridge.registry.getAllQueues().values()) {
        for (const task of manager.getAll()) {
            const taskSessionId = getRalphSessionId(task);
            if (taskSessionId !== sessionId) {
                continue;
            }
            if (task.status === 'queued' || task.status === 'running') {
                return { id: task.id, status: task.status };
            }
        }
    }
    return undefined;
}

export function parseAdditionalIterations(
    body: unknown,
    limit: number,
): AdditionalIterationsResult {
    if (!hasOwn(body, 'additionalIterations')) {
        return { value: undefined };
    }

    const raw = body.additionalIterations;
    if (typeof raw !== 'number'
        || !Number.isFinite(raw)
        || !Number.isInteger(raw)
        || raw < 1
        || raw > limit) {
        return { error: `additionalIterations must be an integer between 1 and ${limit}` };
    }

    return { value: raw };
}

export function parseRalphAiSelection(body: unknown): RalphAiSelectionParseResult {
    const request = isRecord(body) ? body : {};
    const config = isRecord(request.config) ? request.config : {};
    let selection: AiSelection;
    try {
        selection = parseAiSelection({
            provider: request.provider,
            config: {
                model: typeof config.model === 'string' ? config.model : undefined,
                reasoningEffort: config.reasoningEffort ?? request.reasoningEffort,
            },
        });
    } catch (error) {
        if (error instanceof AiSelectionParseError) return { error: error.message };
        throw error;
    }

    const rawEffortTier = config.effortTier ?? request.effortTier;
    const effortTier = rawEffortTier === undefined
        ? undefined
        : typeof rawEffortTier === 'string' && VALID_RALPH_EFFORT_TIERS.has(rawEffortTier)
            ? rawEffortTier as RalphEffortTier
            : undefined;
    if (rawEffortTier !== undefined && !effortTier) {
        return { error: `Invalid effortTier: '${String(rawEffortTier)}'. Valid effortTier values: ${[...VALID_RALPH_EFFORT_TIERS].join(', ')}` };
    }

    return {
        value: {
            ...selection,
            effortTier,
            autoProviderRouting: request.autoProviderRouting === undefined
                ? undefined : request.autoProviderRouting === true,
        },
    };
}

export function resolveRalphContinuationAiSelection(
    requested: RalphAiSelection | undefined,
    recovered: RecoveredIterationPaths,
): RalphAiSelection {
    const recoveredAuto = recovered.autoProviderRouting === true;
    const autoProviderRouting = requested?.provider === undefined
        && (requested?.autoProviderRouting ?? recoveredAuto);
    const effortTier = requested?.effortTier ?? (autoProviderRouting ? recovered.effortTier : undefined);
    const inheritConcrete = effortTier === undefined;
    return {
        provider: requested?.provider ?? (autoProviderRouting ? undefined : recovered.provider),
        model: requested?.model ?? (inheritConcrete ? recovered.model : undefined),
        reasoningEffort: requested?.reasoningEffort ?? (inheritConcrete ? recovered.reasoningEffort : undefined),
        effortTier,
        autoProviderRouting,
    };
}

export function resolveRalphAdditionalIterations(
    explicit: number | undefined,
    dataDir: string | undefined,
    workspaceId: string | undefined,
): number {
    if (explicit !== undefined) {
        return explicit;
    }
    if (!dataDir || !workspaceId) {
        return RALPH_DEFAULT_MAX_ITERATIONS;
    }

    let prefMax: number | undefined;
    try {
        prefMax = readRepoPreferences(dataDir, workspaceId).maxRalphIterations;
    } catch {
        // Preferences are optional.
    }
    return prefMax ?? RALPH_DEFAULT_MAX_ITERATIONS;
}

export async function recoverIterationPaths(
    record: RalphSessionRecord,
    store: ProcessStore,
    workspaceId: string | undefined,
): Promise<RecoveredIterationPaths> {
    // When the session was launched with an isolated worktree that still exists,
    // its checkout is the authoritative working directory for resume/continue/
    // new-loop — never fall back to the source workspace path for such sessions.
    const activeWorktreePath = record.worktree && record.worktree.status === 'active'
        ? record.worktree.path
        : undefined;
    const unavailable: RecoveredIterationPaths = {
        workingDirectory: activeWorktreePath,
        folderPath: undefined,
        provider: undefined,
        model: undefined,
        reasoningEffort: undefined,
    };

    const lastIter = [...record.iterations].sort((a, b) => b.iteration - a.iteration)[0];
    if (!lastIter?.processId) {
        return unavailable;
    }

    try {
        const proc = await store.getProcess(lastIter.processId, workspaceId);
        const procWithPayload = proc as (typeof proc & { payload?: Record<string, unknown> }) | undefined;
        const payload = isRecord(procWithPayload?.payload) ? procWithPayload.payload : undefined;
        const metadata = isRecord(procWithPayload?.metadata) ? procWithPayload.metadata : undefined;
        const owner = metadata?.workspaceId ?? payload?.workspaceId;
        if (owner !== undefined && owner !== (workspaceId ?? record.workspaceId)) return unavailable;
        const payloadContext = parseAutoProviderRoutingContext(payload?.context);
        const routingContext = payloadContext?.autoProviderRouting !== undefined
            ? payloadContext : parseAutoProviderRoutingContext(metadata);
        const autoProviderRouting = isAutoProviderRoutingRequested(routingContext);
        const effortTier = typeof metadata?.afterEffortTier === 'string'
            && VALID_RALPH_EFFORT_TIERS.has(metadata.afterEffortTier)
            ? metadata.afterEffortTier as RalphEffortTier
            : undefined;
        const payloadWorkingDirectory = asString(payload?.workingDirectory);
        const payloadFolderPath = asString(payload?.folderPath);
        return {
            workingDirectory: activeWorktreePath
                ?? payloadWorkingDirectory
                ?? payloadFolderPath
                ?? procWithPayload?.workingDirectory,
            folderPath: payloadFolderPath,
            provider: resolveChatProvider(payload?.provider) ?? resolveChatProvider(metadata?.provider),
            model: asString(payload?.model) ?? asString(metadata?.model),
            reasoningEffort: asReasoningEffort(payload?.reasoningEffort) ?? asReasoningEffort(metadata?.reasoningEffort),
            ...(autoProviderRouting ? { autoProviderRouting: true } : {}),
            ...(effortTier ? { effortTier } : {}),
        };
    } catch {
        return unavailable;
    }
}

function getRalphSessionId(task: QueuedTask): string | undefined {
    const context = isRecord(task.payload.context) ? task.payload.context : undefined;
    const ralph = isRecord(context?.ralph) ? context.ralph : undefined;
    return asString(ralph?.sessionId);
}

function hasOwn<T extends string>(
    value: unknown,
    key: T,
): value is Record<T, unknown> {
    return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function asReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return isReasoningEffort(value) ? value : undefined;
}
