import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import type { RalphSessionRecord } from '../ralph/types';
import { VALID_CHAT_PROVIDERS, VALID_REASONING_EFFORTS } from '../tasks/task-types';
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
}

export type RalphEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface RalphAiSelection {
    provider: ChatProvider | undefined;
    model: string | undefined;
    reasoningEffort: ReasoningEffort | undefined;
    effortTier: RalphEffortTier | undefined;
    autoProviderRouting: boolean;
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
    const provider = request.provider === undefined
        ? undefined
        : request.provider as ChatProvider;
    if (provider !== undefined && !VALID_CHAT_PROVIDERS.has(provider)) {
        return { error: `Invalid provider: '${String(request.provider)}'. Valid providers: ${[...VALID_CHAT_PROVIDERS].join(', ')}` };
    }

    const config = isRecord(request.config) ? request.config : {};
    const model = typeof config.model === 'string' && config.model.trim()
        ? config.model.trim()
        : undefined;

    const rawReasoningEffort = config.reasoningEffort ?? request.reasoningEffort;
    const reasoningEffort = rawReasoningEffort === undefined
        ? undefined
        : rawReasoningEffort as ReasoningEffort;
    if (reasoningEffort !== undefined && !VALID_REASONING_EFFORTS.has(reasoningEffort)) {
        return { error: `Invalid reasoningEffort: '${String(rawReasoningEffort)}'. Valid reasoningEffort values: ${[...VALID_REASONING_EFFORTS].join(', ')}` };
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
            provider,
            model,
            reasoningEffort,
            effortTier,
            autoProviderRouting: request.autoProviderRouting === true,
        },
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
    const lastIter = [...record.iterations].sort((a, b) => b.iteration - a.iteration)[0];
    if (!lastIter?.processId) {
        return {
            workingDirectory: undefined,
            folderPath: undefined,
            provider: undefined,
            model: undefined,
            reasoningEffort: undefined,
        };
    }

    try {
        const proc = await store.getProcess(lastIter.processId, workspaceId);
        const procWithPayload = proc as (typeof proc & { payload?: Record<string, unknown> }) | undefined;
        const payload = isRecord(procWithPayload?.payload) ? procWithPayload.payload : undefined;
        const metadata = isRecord(procWithPayload?.metadata) ? procWithPayload.metadata : undefined;
        const payloadWorkingDirectory = asString(payload?.workingDirectory);
        const payloadFolderPath = asString(payload?.folderPath);
        return {
            workingDirectory: payloadWorkingDirectory
                ?? payloadFolderPath
                ?? procWithPayload?.workingDirectory,
            folderPath: payloadFolderPath,
            provider: asProvider(payload?.provider) ?? asProvider(metadata?.provider),
            model: asString(payload?.model) ?? asString(metadata?.model),
            reasoningEffort: asReasoningEffort(payload?.reasoningEffort),
        };
    } catch {
        return {
            workingDirectory: undefined,
            folderPath: undefined,
            provider: undefined,
            model: undefined,
            reasoningEffort: undefined,
        };
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

function asProvider(value: unknown): ChatProvider | undefined {
    return value === 'copilot' || value === 'codex' || value === 'claude'
        ? value
        : undefined;
}

function asReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
        ? value
        : undefined;
}
