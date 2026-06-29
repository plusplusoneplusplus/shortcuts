/**
 * Shared mock factory for ProcessStore with in-memory backing maps.
 *
 * Consolidates the duplicated createMockStore() from:
 *   - test/server/queue-executor-bridge.test.ts
 *   - test/server/executor-session-tracking.test.ts
 */

import { vi } from 'vitest';
import type { ProcessStore, AIProcess, WorkspaceInfo, ConversationTurn, TimelineItem } from '@plusplusoneplusplus/forge';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Extended mock store with observable backing data for test assertions */
export interface MockProcessStore extends ProcessStore {
    /** Backing map — inspect directly for assertions */
    processes: Map<string, AIProcess>;
    /** Accumulated output chunks per process ID */
    outputs: Map<string, string[]>;
    /** Completion events per process ID */
    completions: Map<string, { status: string; duration: string }>;
}

/** Configuration for process store mock behavior */
export interface MockProcessStoreOptions {
    /** Pre-populate the store with these processes */
    initialProcesses?: AIProcess[];
    /** Pre-populate workspaces */
    initialWorkspaces?: WorkspaceInfo[];
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory mock ProcessStore backed by Map instances.
 * Every method is a vi.fn() with a working in-memory implementation.
 *
 * Identical behavior to the inline createMockStore() in
 * queue-executor-bridge.test.ts and executor-session-tracking.test.ts.
 */
export function createMockProcessStore(options?: MockProcessStoreOptions): MockProcessStore {
    const processes = new Map<string, AIProcess>();
    const outputs = new Map<string, string[]>();
    const completions = new Map<string, { status: string; duration: string }>();

    if (options?.initialProcesses) {
        for (const proc of options.initialProcesses) {
            processes.set(proc.id, { ...proc });
        }
    }

    return {
        processes,
        outputs,
        completions,
        // addProcess uses Map.set — naturally upsert (matching FileProcessStore behavior).
        addProcess: vi.fn(async (process: AIProcess) => {
            processes.set(process.id, { ...process });
        }),
        updateProcess: vi.fn(async (id: string, updates: Partial<AIProcess>) => {
            const existing = processes.get(id);
            if (existing) {
                processes.set(id, { ...existing, ...updates });
            }
        }),
        getProcess: vi.fn(async (id: string, workspaceId?: string) => {
            const p = processes.get(id);
            if (!p) { return undefined; }
            if (workspaceId !== undefined) {
                const wsId = p.metadata?.workspaceId ?? '';
                return wsId === workspaceId ? p : undefined;
            }
            return p;
        }),
        getAllProcesses: vi.fn(async () => Array.from(processes.values())),
        removeProcess: vi.fn(async (id: string) => { processes.delete(id); }),
        clearProcesses: vi.fn(async () => {
            const count = processes.size;
            processes.clear();
            return count;
        }),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        removeWorkspace: vi.fn(async () => false),
        updateWorkspace: vi.fn(async () => undefined),
        getWikis: vi.fn(async () => []),
        registerWiki: vi.fn(async () => {}),
        removeWiki: vi.fn(async () => false),
        updateWiki: vi.fn(async () => undefined),
        clearAllWorkspaces: vi.fn(async () => 0),
        clearAllWikis: vi.fn(async () => 0),
        getStorageStats: vi.fn(async () => ({
            totalProcesses: processes.size,
            totalWorkspaces: 0,
            totalWikis: 0,
            storageSize: 0,
        })),
        onProcessOutput: vi.fn((_id: string, _callback: any) => () => {}),
        emitProcessOutput: vi.fn((id: string, content: string) => {
            const existing = outputs.get(id) || [];
            existing.push(content);
            outputs.set(id, existing);
        }),
        emitProcessComplete: vi.fn((id: string, status: string, duration: string) => {
            completions.set(id, { status, duration });
        }),
        emitProcessEvent: vi.fn((_id: string, _event: any) => {}),
        appendConversationTurn: vi.fn(async (processId: string, makeTurn: (turnIndex: number) => ConversationTurn, options?: any) => {
            const existing = processes.get(processId);
            if (!existing) return undefined;
            let turns = existing.conversationTurns ?? [];
            if (options?.filterStreaming) {
                turns = turns.filter((t: ConversationTurn) => !(t.role === 'assistant' && t.streaming));
            }
            const turnIndex = turns.length;
            const turn = makeTurn(turnIndex);
            const allTurns = [...turns, turn];
            const extraUpdates = typeof options?.additionalUpdates === 'function'
                ? options.additionalUpdates(existing)
                : (options?.additionalUpdates ?? {});
            processes.set(processId, { ...existing, ...extraUpdates, conversationTurns: allTurns });
            return { turn, allTurns };
        }),
        appendPendingMessage: vi.fn(async (processId: string, message: any) => {
            const existing = processes.get(processId);
            if (!existing) return undefined;
            const pendingMessages = [...(existing.pendingMessages ?? []), message];
            processes.set(processId, { ...existing, pendingMessages });
            return pendingMessages;
        }),
        upsertStreamingTurn: vi.fn(async (processId: string, content: string, streaming: boolean, timeline?: TimelineItem[]) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            let streamingIdx = -1;
            for (let i = turns.length - 1; i >= 0; i--) {
                if (turns[i].role === 'assistant' && turns[i].streaming) { streamingIdx = i; break; }
            }
            let updatedTurns: ConversationTurn[];
            if (streamingIdx !== -1) {
                updatedTurns = turns.map((turn: ConversationTurn, i: number) =>
                    i === streamingIdx
                        ? { ...turn, content, streaming: streaming || undefined, ...(timeline ? { timeline } : {}) }
                        : turn
                );
            } else {
                updatedTurns = [...turns, {
                    role: 'assistant' as const, content, timestamp: new Date(),
                    turnIndex: turns.length, streaming: streaming || undefined, timeline: timeline ?? [],
                }];
            }
            processes.set(processId, { ...existing, conversationTurns: updatedTurns });
        }),
        updateTurnContent: vi.fn(async (processId: string, turnIndex: number, content: string) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            if (turnIndex < 0 || turnIndex >= turns.length) return;
            const updatedTurns = turns.map((turn: ConversationTurn, i: number) => i === turnIndex ? { ...turn, content } : turn);
            processes.set(processId, { ...existing, conversationTurns: updatedTurns });
        }),
        updateTurnSdkEventId: vi.fn(async (processId: string, turnIndex: number, sdkEventId: string) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            if (turnIndex < 0 || turnIndex >= turns.length) return;
            if (turns[turnIndex].role !== 'user') return;
            const updatedTurns = turns.map((turn: ConversationTurn, i: number) => i === turnIndex ? { ...turn, sdkEventId } : turn);
            processes.set(processId, { ...existing, conversationTurns: updatedTurns });
        }),
        truncateConversationTurns: vi.fn(async (processId: string, fromTurnIndex: number) => {
            const existing = processes.get(processId);
            if (!existing) return undefined;
            const turns = existing.conversationTurns ?? [];
            const removed = turns.filter((t: ConversationTurn) => t.turnIndex >= fromTurnIndex);
            const allTurns = turns.filter((t: ConversationTurn) => t.turnIndex < fromTurnIndex);
            processes.set(processId, { ...existing, conversationTurns: allTurns });
            return { removed, allTurns };
        }),
        getProcessIds: vi.fn(async () => Array.from(processes.keys())),
    } as MockProcessStore;
}

/**
 * Creates a minimal valid AIProcess with sensible defaults.
 * All fields can be overridden.
 */
export function createProcessFixture(overrides?: Partial<AIProcess>): AIProcess {
    return {
        id: overrides?.id ?? 'proc-test',
        type: overrides?.type ?? 'clarification',
        promptPreview: overrides?.promptPreview ?? 'test',
        fullPrompt: overrides?.fullPrompt ?? 'test prompt',
        status: overrides?.status ?? 'completed',
        startTime: overrides?.startTime ?? new Date(),
        ...overrides,
    };
}

/**
 * Convenience for creating a completed process with an SDK session and optional
 * conversation turns. Used heavily in follow-up and session-tracking tests.
 */
export function createCompletedProcessWithSession(
    id: string,
    sessionId: string,
    turns?: ConversationTurn[],
): AIProcess {
    return createProcessFixture({
        id,
        status: 'completed',
        sdkSessionId: sessionId,
        conversationTurns: turns ?? [
            { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    });
}
