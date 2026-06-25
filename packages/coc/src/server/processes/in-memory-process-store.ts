/**
 * In-Memory Process Store
 *
 * Minimal in-memory ProcessStore used when no store is injected.
 * Supports event emission for SSE streaming and process tracking.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import type { ProcessStore, AIProcess, ProcessChangeCallback, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import type { ConversationTurn, TimelineItem } from '@plusplusoneplusplus/forge';

export function createStubStore(): ProcessStore {
    const processes = new Map<string, AIProcess>();
    const emitters = new Map<string, EventEmitter>();
    let changeCallback: ProcessChangeCallback | undefined;

    function getOrCreateEmitter(id: string): EventEmitter {
        let emitter = emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            emitters.set(id, emitter);
        }
        return emitter;
    }

    const store: ProcessStore = {
        addProcess: async (proc) => {
            processes.set(proc.id, proc);
            changeCallback?.({ type: 'process-added', process: proc });
        },
        updateProcess: async (id, updates) => {
            if ('conversationTurns' in updates) {
                throw new Error('Use appendConversationTurn/upsertStreamingTurn/updateTurnContent to modify conversationTurns');
            }
            const existing = processes.get(id);
            if (!existing) return;
            const merged = { ...existing, ...updates };
            processes.set(id, merged as AIProcess);
            changeCallback?.({ type: 'process-updated', process: merged as AIProcess });
        },
        getProcess: async (id) => processes.get(id),
        getAllProcesses: async () => Array.from(processes.values()),
        removeProcess: async (id) => {
            const proc = processes.get(id);
            processes.delete(id);
            if (proc) changeCallback?.({ type: 'process-removed', process: proc });
        },
        clearProcesses: async () => { const count = processes.size; processes.clear(); changeCallback?.({ type: 'processes-cleared' }); return count; },
        getWorkspaces: async () => [],
        registerWorkspace: async () => {},
        removeWorkspace: async () => false,
        updateWorkspace: async () => undefined,
        renameWorkspaceId: async () => false,
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => undefined,
        clearAllWorkspaces: async () => 0,
        clearAllWikis: async () => 0,
        getProcessCount: async () => processes.size,
        getProcessIds: async () => Array.from(processes.keys()),
        getStorageStats: async () => ({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
        onProcessOutput: (id, callback) => {
            const emitter = getOrCreateEmitter(id);
            const listener = (event: ProcessOutputEvent) => callback(event);
            emitter.on('output', listener);
            return () => { emitter.removeListener('output', listener); };
        },
        emitProcessOutput: (id, content) => {
            const emitter = getOrCreateEmitter(id);
            emitter.emit('output', { type: 'chunk', content });
        },
        emitProcessComplete: (id, status, duration) => {
            const emitter = emitters.get(id);
            if (!emitter) return;
            emitter.emit('output', { type: 'complete', status, duration });
            emitters.delete(id);
        },
        emitProcessEvent: (id, event) => {
            const emitter = getOrCreateEmitter(id);
            emitter.emit('output', event);
        },
        appendConversationTurn: async (processId, makeTurn, options) => {
            const existing = processes.get(processId);
            if (!existing) return undefined;
            let turns = existing.conversationTurns ?? [];
            if (options?.filterStreaming) {
                turns = turns.filter(t => !(t.role === 'assistant' && t.streaming));
            }
            const turnIndex = turns.length;
            const turn = makeTurn(turnIndex);
            const allTurns = [...turns, turn];
            const extraUpdates = typeof options?.additionalUpdates === 'function'
                ? options.additionalUpdates(existing)
                : (options?.additionalUpdates ?? {});
            const merged = { ...existing, ...extraUpdates, conversationTurns: allTurns };
            processes.set(processId, merged);
            changeCallback?.({ type: 'process-updated', process: merged });
            return { turn, allTurns };
        },
        upsertStreamingTurn: async (processId, content, streaming, timeline) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            let streamingIdx = -1;
            for (let i = turns.length - 1; i >= 0; i--) {
                if (turns[i].role === 'assistant' && turns[i].streaming) { streamingIdx = i; break; }
            }
            let updatedTurns: ConversationTurn[];
            if (streamingIdx !== -1) {
                updatedTurns = turns.map((turn, i) =>
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
            const merged = { ...existing, conversationTurns: updatedTurns };
            processes.set(processId, merged);
            changeCallback?.({ type: 'process-updated', process: merged });
        },
        updateTurnContent: async (processId, turnIndex, content) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            if (turnIndex < 0 || turnIndex >= turns.length) return;
            const updatedTurns = turns.map((turn, i) => i === turnIndex ? { ...turn, content } : turn);
            const merged = { ...existing, conversationTurns: updatedTurns };
            processes.set(processId, merged);
            changeCallback?.({ type: 'process-updated', process: merged });
        },
        updateTurnSdkEventId: async (processId, turnIndex, sdkEventId) => {
            const existing = processes.get(processId);
            if (!existing) return;
            const turns = existing.conversationTurns ?? [];
            if (turnIndex < 0 || turnIndex >= turns.length) return;
            if (turns[turnIndex].role !== 'user') return;
            const updatedTurns = turns.map((turn, i) => i === turnIndex ? { ...turn, sdkEventId } : turn);
            const merged = { ...existing, conversationTurns: updatedTurns };
            processes.set(processId, merged);
            changeCallback?.({ type: 'process-updated', process: merged });
        },
    };

    // Expose onProcessChange setter via defineProperty
    Object.defineProperty(store, 'onProcessChange', {
        get: () => changeCallback,
        set: (cb: ProcessChangeCallback | undefined) => { changeCallback = cb; },
        enumerable: true,
        configurable: true,
    });

    return store;
}
