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
        getWikis: async () => [],
        registerWiki: async () => {},
        removeWiki: async () => false,
        updateWiki: async () => undefined,
        clearAllWorkspaces: async () => 0,
        clearAllWikis: async () => 0,
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
