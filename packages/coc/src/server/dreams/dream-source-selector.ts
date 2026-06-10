import type {
    AIProcess,
    ConversationTurn,
    ProcessIndexEntry,
    ProcessStore,
} from '@plusplusoneplusplus/forge';
import type { DreamSourceRange } from './types';

export interface DreamEligibleTurn {
    turnIndex: number;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface DreamEligibleConversation {
    processId: string;
    workspaceId: string;
    title?: string;
    promptPreview: string;
    startTime: string;
    endTime?: string;
    activityAt: string;
    sourceRanges: DreamSourceRange[];
    turns: DreamEligibleTurn[];
    uncoveredTurnCount: number;
    visibleTurnCount: number;
}

export interface DreamConversationSelection {
    workspaceId: string;
    conversations: DreamEligibleConversation[];
    scannedProcessCount: number;
    skipped: {
        wrongWorkspace: number;
        nonCompleted: number;
        archived: number;
        missingProcess: number;
        noVisibleTurns: number;
        fullyCovered: number;
    };
}

export interface SelectEligibleDreamConversationsOptions {
    store: ProcessStore;
    workspaceId: string;
    coveredRanges?: readonly DreamSourceRange[];
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
}

interface LoadedProcessEntry {
    entry: ProcessIndexEntry;
    process?: AIProcess;
}

const DEFAULT_LIMIT = 20;
const MAX_FETCH_LIMIT = 100;
const FETCH_MULTIPLIER = 3;

function clampPositiveInteger(value: number | undefined, fallback: number, max: number): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(1, Math.trunc(value)), max);
}

function isoFromDate(value: Date | undefined): string | undefined {
    return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
}

function entryFromProcess(process: AIProcess, fallbackWorkspaceId: string): ProcessIndexEntry {
    const startTime = process.startTime.toISOString();
    const endTime = isoFromDate(process.endTime);
    const lastEventAt = isoFromDate(process.lastEventAt);
    return {
        id: process.id,
        workspaceId: process.metadata?.workspaceId ?? fallbackWorkspaceId,
        status: process.status,
        type: process.type,
        startTime,
        ...(endTime ? { endTime } : {}),
        promptPreview: process.promptPreview ?? '',
        ...(process.error ? { error: process.error } : {}),
        ...(process.parentProcessId ? { parentProcessId: process.parentProcessId } : {}),
        ...(process.title ? { title: process.title } : {}),
        ...(process.customTitle ? { customTitle: process.customTitle } : {}),
        ...(process.lastMessagePreview ? { lastMessagePreview: process.lastMessagePreview } : {}),
        ...(lastEventAt ? { lastEventAt } : {}),
        activityAt: lastEventAt ?? endTime ?? startTime,
        ...(process.pinnedAt ? { pinnedAt: process.pinnedAt } : {}),
        ...(process.archived ? { archived: true } : {}),
    };
}

async function loadRecentCompletedProcesses(
    store: ProcessStore,
    workspaceId: string,
    options: Pick<SelectEligibleDreamConversationsOptions, 'since' | 'until' | 'offset'>,
    fetchLimit: number,
): Promise<LoadedProcessEntry[]> {
    if (store.getProcessSummaries) {
        const { entries } = await store.getProcessSummaries({
            workspaceId,
            status: 'completed',
            since: options.since,
            until: options.until,
            limit: fetchLimit,
            offset: options.offset,
        });
        return entries.map(entry => ({ entry }));
    }

    if (store.listRecentProcesses) {
        const entries = await store.listRecentProcesses({
            workspaceId,
            since: options.since,
            until: options.until,
            limit: fetchLimit,
            offset: options.offset,
        });
        return entries.map(entry => ({ entry }));
    }

    const processes = await store.getAllProcesses({
        workspaceId,
        status: 'completed',
        since: options.since,
        until: options.until,
        limit: fetchLimit,
        offset: options.offset,
    });
    return processes.map(process => ({
        entry: entryFromProcess(process, workspaceId),
        process,
    }));
}

async function loadTurns(
    store: ProcessStore,
    workspaceId: string,
    loaded: LoadedProcessEntry,
): Promise<ConversationTurn[] | undefined> {
    if (loaded.process?.conversationTurns) {
        return loaded.process.conversationTurns;
    }
    if (store.getConversationTurns) {
        return store.getConversationTurns(loaded.entry.id);
    }
    const process = await store.getProcess(loaded.entry.id, workspaceId);
    return process?.conversationTurns;
}

function isVisibleDreamTurn(turn: ConversationTurn): boolean {
    return !turn.deletedAt
        && !turn.archived
        && !turn.streaming
        && !turn.interrupted
        && turn.content.trim().length > 0;
}

function normalizeCoveredRanges(ranges: readonly DreamSourceRange[] | undefined): Map<string, DreamSourceRange[]> {
    const byProcess = new Map<string, DreamSourceRange[]>();
    for (const range of ranges ?? []) {
        const processId = range.processId.trim();
        if (!processId) {
            throw new Error('coveredRanges entries must include processId');
        }
        if (!Number.isInteger(range.startTurnIndex) || range.startTurnIndex < 0) {
            throw new Error('coveredRanges entries must include a non-negative startTurnIndex');
        }
        if (!Number.isInteger(range.endTurnIndex) || range.endTurnIndex < range.startTurnIndex) {
            throw new Error('coveredRanges entries must include endTurnIndex >= startTurnIndex');
        }
        const normalized: DreamSourceRange = {
            processId,
            startTurnIndex: range.startTurnIndex,
            endTurnIndex: range.endTurnIndex,
        };
        const existing = byProcess.get(processId);
        if (existing) {
            existing.push(normalized);
        } else {
            byProcess.set(processId, [normalized]);
        }
    }
    return byProcess;
}

function isTurnCovered(turn: ConversationTurn, coveredRanges: readonly DreamSourceRange[]): boolean {
    return coveredRanges.some(range =>
        turn.turnIndex >= range.startTurnIndex && turn.turnIndex <= range.endTurnIndex
    );
}

function buildContiguousSourceRanges(processId: string, turns: readonly DreamEligibleTurn[]): DreamSourceRange[] {
    const ranges: DreamSourceRange[] = [];
    for (const turn of turns) {
        const previous = ranges[ranges.length - 1];
        if (previous && previous.endTurnIndex + 1 === turn.turnIndex) {
            previous.endTurnIndex = turn.turnIndex;
            continue;
        }
        ranges.push({
            processId,
            startTurnIndex: turn.turnIndex,
            endTurnIndex: turn.turnIndex,
        });
    }
    return ranges;
}

function toEligibleTurn(turn: ConversationTurn): DreamEligibleTurn {
    return {
        turnIndex: turn.turnIndex,
        role: turn.role,
        content: turn.content.trim(),
        timestamp: turn.timestamp.toISOString(),
    };
}

function activityAt(entry: ProcessIndexEntry): string {
    return entry.activityAt ?? entry.lastEventAt ?? entry.endTime ?? entry.startTime;
}

export async function selectEligibleDreamConversations(
    options: SelectEligibleDreamConversationsOptions,
): Promise<DreamConversationSelection> {
    const workspaceId = options.workspaceId.trim();
    if (!workspaceId) {
        throw new Error('workspaceId is required');
    }

    const limit = clampPositiveInteger(options.limit, DEFAULT_LIMIT, MAX_FETCH_LIMIT);
    const fetchLimit = Math.min(MAX_FETCH_LIMIT, Math.max(limit, limit * FETCH_MULTIPLIER));
    const coveredRangesByProcess = normalizeCoveredRanges(options.coveredRanges);
    const loadedEntries = await loadRecentCompletedProcesses(options.store, workspaceId, options, fetchLimit);
    const conversations: DreamEligibleConversation[] = [];
    const skipped = {
        wrongWorkspace: 0,
        nonCompleted: 0,
        archived: 0,
        missingProcess: 0,
        noVisibleTurns: 0,
        fullyCovered: 0,
    };

    for (const loaded of loadedEntries) {
        const { entry } = loaded;
        if (entry.workspaceId !== workspaceId) {
            skipped.wrongWorkspace += 1;
            continue;
        }
        if (entry.status !== 'completed') {
            skipped.nonCompleted += 1;
            continue;
        }
        if (entry.archived) {
            skipped.archived += 1;
            continue;
        }

        const turns = await loadTurns(options.store, workspaceId, loaded);
        if (!turns) {
            skipped.missingProcess += 1;
            continue;
        }

        const visibleTurns = turns
            .filter(isVisibleDreamTurn)
            .sort((a, b) => a.turnIndex - b.turnIndex);
        if (visibleTurns.length === 0) {
            skipped.noVisibleTurns += 1;
            continue;
        }

        const processCoveredRanges = coveredRangesByProcess.get(entry.id) ?? [];
        const uncoveredTurns = visibleTurns.filter(turn => !isTurnCovered(turn, processCoveredRanges));
        if (uncoveredTurns.length === 0) {
            skipped.fullyCovered += 1;
            continue;
        }

        const eligibleTurns = uncoveredTurns.map(toEligibleTurn);
        conversations.push({
            processId: entry.id,
            workspaceId,
            ...(entry.title ? { title: entry.title } : {}),
            promptPreview: entry.promptPreview,
            startTime: entry.startTime,
            ...(entry.endTime ? { endTime: entry.endTime } : {}),
            activityAt: activityAt(entry),
            sourceRanges: buildContiguousSourceRanges(entry.id, eligibleTurns),
            turns: eligibleTurns,
            uncoveredTurnCount: eligibleTurns.length,
            visibleTurnCount: visibleTurns.length,
        });

        if (conversations.length >= limit) {
            break;
        }
    }

    return {
        workspaceId,
        conversations,
        scannedProcessCount: loadedEntries.length,
        skipped,
    };
}
