import { EventEmitter } from 'node:events';
import type { ProcessStore, ProcessOutputEvent } from './process-store';

export type ProcessEventBus = Pick<ProcessStore,
    'onProcessOutput' | 'emitProcessOutput' | 'emitProcessComplete' | 'emitProcessEvent'>;

/** A bus belongs to one store; completing a process releases its emitter. */
export function createProcessEventBus(): ProcessEventBus {
    const emitters = new Map<string, EventEmitter>();
    function getOrCreateEmitter(id: string): EventEmitter {
        let emitter = emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            emitters.set(id, emitter);
        }
        return emitter;
    }

    return {
        onProcessOutput(id, callback) {
            const emitter = getOrCreateEmitter(id);
            const listener = (event: ProcessOutputEvent) => callback(event);
            emitter.on('output', listener);
            return () => { emitter.removeListener('output', listener); };
        },
        emitProcessOutput(id, content) {
            getOrCreateEmitter(id).emit('output', { type: 'chunk', content } satisfies ProcessOutputEvent);
        },
        emitProcessComplete(id, status, duration) {
            const emitter = emitters.get(id);
            if (!emitter) return;
            emitter.emit('output', { type: 'complete', status, duration } satisfies ProcessOutputEvent);
            emitters.delete(id);
        },
        emitProcessEvent(id, event) {
            getOrCreateEmitter(id).emit('output', event);
        },
    };
}
