import type {
    AIProcess,
    ConversationTurn,
    ProcessIndexEntry,
    ProcessStore,
    QueuedTask,
} from '@plusplusoneplusplus/forge';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import {
    analyzeDreamConversations,
    DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS,
    type DreamAnalysisPolicy,
    type DreamAnalysisResult,
    type DreamRelatedRecord,
    type DreamSystemPromptResolver,
} from './dream-analyzer';
import type { DreamInternalProcessPurpose, DreamInternalStepRunner } from './dream-internal-process';
import { selectEligibleDreamConversations, type DreamConversationSelection } from './dream-source-selector';
import type { FileDreamStore } from './dream-store';
import type { DreamCard, DreamRunRecord, DreamRunTrigger, DreamSourceRange } from './types';

export const DEFAULT_DREAM_MIN_IDLE_MS = 15 * 60 * 1000;
export const DEFAULT_DREAM_CONVERSATION_LIMIT = 20;

export interface DreamRunPolicy extends DreamAnalysisPolicy {
    conversationLimit?: number;
    minIdleMs?: number;
}

export interface DreamRunExecutorOptions extends DreamRunPolicy {
    store: FileDreamStore;
    processStore: ProcessStore;
    runInternalStep: DreamInternalStepRunner;
    resolveSystemPrompt: DreamSystemPromptResolver;
    getDreamsEnabled: () => boolean | Promise<boolean>;
    getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    listWorkspaceTasks?: (workspaceId: string) => readonly QueuedTask[] | Promise<readonly QueuedTask[]>;
    getRelatedRecords?: (workspaceId: string) => readonly DreamRelatedRecord[] | Promise<readonly DreamRelatedRecord[]>;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    now?: () => Date;
}

export interface DreamRunRequestOptions extends DreamRunPolicy {
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    signal?: AbortSignal;
    parentProcessId?: string;
}

export interface DreamRunExecutionResult {
    run: DreamRunRecord;
    selection: DreamConversationSelection;
    analysis: DreamAnalysisResult;
    cards: DreamCard[];
}

export interface DreamIdleCheckResult {
    isIdle: boolean;
    reasons: string[];
    queuedTaskCount: number;
    runningTaskCount: number;
    activeStreamingChatProcessIds: string[];
    minIdleMs: number;
    latestActivityAt?: string;
    idleForMs?: number;
}

export type DreamIdleRunResult =
    | { started: true; result: DreamRunExecutionResult }
    | { started: false; reason: string; idle: DreamIdleCheckResult };

function normalizeWorkspaceId(workspaceId: string): string {
    const trimmed = workspaceId.trim();
    if (!trimmed) {
        throw new Error('workspaceId is required');
    }
    return trimmed;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.trunc(value));
}

function normalizeMinIdleMs(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.trunc(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function candidateSourceRanges(selection: DreamConversationSelection | undefined): DreamSourceRange[] {
    return selection?.conversations.flatMap(conversation => conversation.sourceRanges) ?? [];
}

function isQueuedOrRunning(task: QueuedTask): boolean {
    return task.status === 'queued' || task.status === 'running';
}

function taskBelongsToWorkspace(task: QueuedTask, workspaceId: string): boolean {
    const payloadWorkspaceId = typeof task.payload?.workspaceId === 'string' ? task.payload.workspaceId : undefined;
    return task.repoId === workspaceId || payloadWorkspaceId === workspaceId;
}

function parseActivityTime(value: string | Date | undefined): number | undefined {
    if (!value) return undefined;
    const millis = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(millis) ? millis : undefined;
}

function processActivityAt(process: AIProcess): string | undefined {
    return process.lastEventAt?.toISOString()
        ?? process.endTime?.toISOString()
        ?? process.startTime?.toISOString();
}

function entryActivityAt(entry: ProcessIndexEntry): string | undefined {
    return entry.activityAt ?? entry.lastEventAt ?? entry.endTime ?? entry.startTime;
}

async function listRecentProcessEntries(
    processStore: ProcessStore,
    workspaceId: string,
    limit: number,
): Promise<ProcessIndexEntry[]> {
    if (processStore.getProcessSummaries) {
        const { entries } = await processStore.getProcessSummaries({ workspaceId, limit });
        return entries;
    }
    if (processStore.listRecentProcesses) {
        return processStore.listRecentProcesses({ workspaceId, limit });
    }
    const processes = await processStore.getAllProcesses({
        workspaceId,
        limit,
        exclude: ['conversation', 'toolCalls'],
    });
    return processes.map(process => ({
        id: process.id,
        workspaceId: process.metadata?.workspaceId ?? workspaceId,
        status: process.status,
        type: process.type,
        startTime: process.startTime.toISOString(),
        ...(process.endTime ? { endTime: process.endTime.toISOString() } : {}),
        promptPreview: process.promptPreview ?? '',
        ...(process.error ? { error: process.error } : {}),
        ...(process.parentProcessId ? { parentProcessId: process.parentProcessId } : {}),
        ...(process.title ? { title: process.title } : {}),
        ...(process.customTitle ? { customTitle: process.customTitle } : {}),
        ...(process.lastMessagePreview ? { lastMessagePreview: process.lastMessagePreview } : {}),
        ...(process.lastEventAt ? { lastEventAt: process.lastEventAt.toISOString() } : {}),
        activityAt: processActivityAt(process) ?? process.startTime.toISOString(),
        ...(process.pinnedAt ? { pinnedAt: process.pinnedAt } : {}),
        ...(process.archived ? { archived: true } : {}),
    }));
}

async function loadRunningChatProcesses(
    processStore: ProcessStore,
    workspaceId: string,
): Promise<Array<{ processId: string; turns: ConversationTurn[] }>> {
    if (processStore.getProcessSummaries) {
        const { entries } = await processStore.getProcessSummaries({
            workspaceId,
            status: 'running',
            type: 'chat',
            limit: 100,
        });
        const processes = await Promise.all(entries.map(async entry => ({
            processId: entry.id,
            turns: processStore.getConversationTurns
                ? await processStore.getConversationTurns(entry.id)
                : (await processStore.getProcess(entry.id, workspaceId))?.conversationTurns ?? [],
        })));
        return processes;
    }

    const processes = await processStore.getAllProcesses({
        workspaceId,
        status: 'running',
        type: 'chat',
        limit: 100,
    });
    return processes.map(process => ({
        processId: process.id,
        turns: process.conversationTurns ?? [],
    }));
}

async function getLatestWorkspaceActivityAt(
    processStore: ProcessStore,
    workspaceId: string,
): Promise<string | undefined> {
    const entries = await listRecentProcessEntries(processStore, workspaceId, 1);
    return entryActivityAt(entries[0]);
}

export class DreamRunExecutor {
    private readonly store: FileDreamStore;
    private readonly processStore: ProcessStore;
    private readonly runInternalStep: DreamInternalStepRunner;
    private readonly resolveSystemPrompt: DreamSystemPromptResolver;
    private readonly getDreamsEnabled: () => boolean | Promise<boolean>;
    private readonly getWorkspaceDreamsEnabled: (workspaceId: string) => boolean | Promise<boolean>;
    private readonly listWorkspaceTasks?: (workspaceId: string) => readonly QueuedTask[] | Promise<readonly QueuedTask[]>;
    private readonly getRelatedRecords?: (workspaceId: string) => readonly DreamRelatedRecord[] | Promise<readonly DreamRelatedRecord[]>;
    private readonly defaultProvider?: ChatProvider;
    private readonly defaultModel?: string;
    private readonly defaultReasoningEffort?: ReasoningEffort;
    private readonly defaultTimeoutMs?: number;
    private readonly defaultConversationLimit?: number;
    private readonly defaultConfidenceThreshold?: number;
    private readonly defaultMaxCandidates?: number;
    private readonly defaultMinIdleMs?: number;
    private readonly now: () => Date;

    constructor(options: DreamRunExecutorOptions) {
        this.store = options.store;
        this.processStore = options.processStore;
        this.runInternalStep = options.runInternalStep;
        this.resolveSystemPrompt = options.resolveSystemPrompt;
        this.getDreamsEnabled = options.getDreamsEnabled;
        this.getWorkspaceDreamsEnabled = options.getWorkspaceDreamsEnabled;
        this.listWorkspaceTasks = options.listWorkspaceTasks;
        this.getRelatedRecords = options.getRelatedRecords;
        this.defaultProvider = options.provider;
        this.defaultModel = options.model;
        this.defaultReasoningEffort = options.reasoningEffort;
        this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS;
        this.defaultConversationLimit = options.conversationLimit;
        this.defaultConfidenceThreshold = options.confidenceThreshold;
        this.defaultMaxCandidates = options.maxCandidates;
        this.defaultMinIdleMs = options.minIdleMs;
        this.now = options.now ?? (() => new Date());
    }

    async runManual(workspaceId: string, options: DreamRunRequestOptions = {}): Promise<DreamRunExecutionResult> {
        return this.executeRun(normalizeWorkspaceId(workspaceId), 'manual', options);
    }

    async runQueued(workspaceId: string, trigger: DreamRunTrigger, options: DreamRunRequestOptions = {}): Promise<DreamRunExecutionResult> {
        return this.executeRun(normalizeWorkspaceId(workspaceId), trigger, options);
    }

    async runIdle(workspaceId: string, options: DreamRunRequestOptions = {}): Promise<DreamIdleRunResult> {
        const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
        if (!this.listWorkspaceTasks) {
            throw new Error('listWorkspaceTasks is required for idle dream runs');
        }
        await this.assertEnabled(normalizedWorkspaceId);
        const idle = await this.checkIdleReadiness(normalizedWorkspaceId, options);
        if (!idle.isIdle) {
            return {
                started: false,
                reason: idle.reasons.join('; '),
                idle,
            };
        }
        return {
            started: true,
            result: await this.executeRun(normalizedWorkspaceId, 'idle', options, { skipEnabledCheck: true }),
        };
    }

    async checkIdleReadiness(workspaceId: string, options: Pick<DreamRunRequestOptions, 'minIdleMs'> = {}): Promise<DreamIdleCheckResult> {
        const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
        const minIdleMs = normalizeMinIdleMs(options.minIdleMs, this.defaultMinIdleMs ?? DEFAULT_DREAM_MIN_IDLE_MS);
        const nowMillis = this.now().getTime();
        const tasks = this.listWorkspaceTasks ? await this.listWorkspaceTasks(normalizedWorkspaceId) : [];
        const workspaceTasks = tasks.filter(task => taskBelongsToWorkspace(task, normalizedWorkspaceId) && isQueuedOrRunning(task));
        const queuedTaskCount = workspaceTasks.filter(task => task.status === 'queued').length;
        const runningTaskCount = workspaceTasks.filter(task => task.status === 'running').length;
        const activeStreamingChatProcessIds = (await loadRunningChatProcesses(this.processStore, normalizedWorkspaceId))
            .filter(process => process.turns.some(turn => turn.role === 'assistant' && turn.streaming))
            .map(process => process.processId);
        const latestActivityAt = await getLatestWorkspaceActivityAt(this.processStore, normalizedWorkspaceId);
        const latestActivityMillis = parseActivityTime(latestActivityAt);
        const idleForMs = latestActivityMillis === undefined
            ? undefined
            : Math.max(0, nowMillis - latestActivityMillis);

        const reasons: string[] = [];
        if (queuedTaskCount > 0 || runningTaskCount > 0) {
            reasons.push(`workspace has ${queuedTaskCount} queued and ${runningTaskCount} running task(s)`);
        }
        if (activeStreamingChatProcessIds.length > 0) {
            reasons.push(`workspace has active streaming chat process(es): ${activeStreamingChatProcessIds.join(', ')}`);
        }
        if (idleForMs !== undefined && idleForMs < minIdleMs) {
            reasons.push(`workspace has been idle for ${idleForMs}ms, below required ${minIdleMs}ms`);
        }

        return {
            isIdle: reasons.length === 0,
            reasons,
            queuedTaskCount,
            runningTaskCount,
            activeStreamingChatProcessIds,
            minIdleMs,
            ...(latestActivityAt ? { latestActivityAt } : {}),
            ...(idleForMs !== undefined ? { idleForMs } : {}),
        };
    }

    private async executeRun(
        workspaceId: string,
        trigger: DreamRunTrigger,
        options: DreamRunRequestOptions,
        executionOptions: { skipEnabledCheck?: boolean } = {},
    ): Promise<DreamRunExecutionResult> {
        if (!executionOptions.skipEnabledCheck) {
            await this.assertEnabled(workspaceId);
        }

        const provider = options.provider ?? this.defaultProvider;
        const model = options.model ?? this.defaultModel;
        const reasoningEffort = options.reasoningEffort ?? this.defaultReasoningEffort;
        const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
        const run = await this.store.createRun({
            workspaceId,
            trigger,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        });
        let selection: DreamConversationSelection | undefined;
        let analysis: DreamAnalysisResult | undefined;
        let analyzerProcessId: string | undefined;
        let criticProcessId: string | undefined;
        const cards: DreamCard[] = [];
        const candidateCardIds: string[] = [];

        try {
            const coveredRanges = await this.store.listCoveredSourceRanges(workspaceId);
            selection = await selectEligibleDreamConversations({
                store: this.processStore,
                workspaceId,
                coveredRanges,
                limit: normalizePositiveInteger(
                    options.conversationLimit,
                    this.defaultConversationLimit ?? DEFAULT_DREAM_CONVERSATION_LIMIT,
                ),
            });
            const existingCards = await this.store.listCards(workspaceId, { includeHidden: true });
            const relatedRecords = await this.getRelatedRecords?.(workspaceId) ?? [];
            analysis = await analyzeDreamConversations({
                runInternalStep: this.runInternalStep,
                resolveSystemPrompt: this.resolveSystemPrompt,
                workspaceId,
                runId: run.id,
                ...(options.parentProcessId ? { parentProcessId: options.parentProcessId } : {}),
                selection,
                existingCards,
                relatedRecords,
                timeoutMs,
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(reasoningEffort ? { reasoningEffort } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
                confidenceThreshold: options.confidenceThreshold ?? this.defaultConfidenceThreshold,
                maxCandidates: options.maxCandidates ?? this.defaultMaxCandidates,
                onInternalProcessStarted: (purpose: DreamInternalProcessPurpose, processId: string) => {
                    if (purpose === 'analyzer') {
                        analyzerProcessId = processId;
                    } else {
                        criticProcessId = processId;
                    }
                },
            });
            analyzerProcessId = analysis.analyzerProcessId ?? analyzerProcessId;
            criticProcessId = analysis.criticProcessId ?? criticProcessId;

            for (const validated of analysis.candidates) {
                const candidate = await this.store.createCandidate(validated.candidate);
                candidateCardIds.push(candidate.id);
                const promoted = await this.store.promoteCandidate(workspaceId, candidate.id, {
                    criticRationale: validated.criticRationale,
                    ...(validated.dedupRationale ? { dedupRationale: validated.dedupRationale } : {}),
                });
                cards.push(promoted);
            }

            const completedRun = await this.store.completeRun(workspaceId, run.id, {
                sourceRanges: analysis.sourceRanges,
                candidateCardIds,
                ...(analyzerProcessId ? { analyzerProcessId } : {}),
                ...(criticProcessId ? { criticProcessId } : {}),
            });
            return {
                run: completedRun,
                selection,
                analysis,
                cards,
            };
        } catch (error) {
            try {
                await this.store.failRun(workspaceId, run.id, {
                    error: errorMessage(error),
                    sourceRanges: analysis?.sourceRanges ?? candidateSourceRanges(selection),
                    candidateCardIds,
                    ...(analyzerProcessId ? { analyzerProcessId } : {}),
                    ...(criticProcessId ? { criticProcessId } : {}),
                });
            } catch (persistError) {
                throw new Error(`Dream run failed: ${errorMessage(error)}; additionally failed to persist failure: ${errorMessage(persistError)}`);
            }
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(errorMessage(error));
        }
    }

    private async assertEnabled(workspaceId: string): Promise<void> {
        if (!await this.getDreamsEnabled()) {
            throw new Error('Dreaming is disabled by global config');
        }
        if (!await this.getWorkspaceDreamsEnabled(workspaceId)) {
            throw new Error(`Dreaming is not enabled for workspace '${workspaceId}'`);
        }
    }
}
