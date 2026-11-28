/** Serialize instance and publication operations per workspace/conversation.
 * A failed operation settles its own caller and leaves the queue usable.
 * Entries are removed as soon as their pending work drains.
 */
const chains = new Map<string, Promise<void>>();

/** NUL cannot appear in a workspace or canvas id, so the key is unambiguous. */
function chainKey(workspaceId: string, canvasId: string): string {
    return `${workspaceId}\u0000${canvasId}`;
}

/**
 * Run `task` once every previously queued task for this canvas has settled.
 *
 * The caller's result and errors pass through untouched. A task that throws
 * does NOT break the chain for the next one — the tail is built from a promise
 * that swallows the outcome, so one failing operation cannot wedge a canvas.
 */
export function queueCanvasExtensionOperation<T>(
    workspaceId: string,
    canvasId: string,
    task: () => Promise<T>,
): Promise<T> {
    const key = chainKey(workspaceId, canvasId);
    const previous = chains.get(key) ?? Promise.resolve();

    const run = previous.then(task, task);
    const tail: Promise<void> = run.then(() => undefined, () => undefined).then(() => {
        // Only the CURRENT tail may clear the entry; a task queued behind this
        // one has already replaced it and must keep its place.
        if (chains.get(key) === tail) {chains.delete(key); }
    });
    chains.set(key, tail);

    return run;
}

/** Canvases with capability work queued or running. Test/diagnostic hook. */
export function getQueuedCanvasCount(): number {
    return chains.size;
}
