/**
 * CanvasUpdateNotifier — the ONE place a "this canvas changed" event is emitted.
 *
 * A canvas mutation has to reach two independent realtime channels, and they are
 * not interchangeable:
 *   - a `canvas-updated` WebSocket process event, so other dashboard tabs
 *     viewing the same canvas can refresh
 *   - a ProcessStore/SSE event on the owning process, so the chat timeline and
 *     chat-side canvas panel see the update
 *
 * They were previously fanned out by a helper that most routes called and the
 * user-save route open-coded half of — so a manual edit reached other tabs but
 * never the process timeline. Routing every mutation through this one object is
 * what makes that class of drift impossible: there is no second place to add a
 * mutation that emits a different subset.
 *
 * Exactly one event per channel per successful mutation. A canvas with no
 * `processId` has no process timeline to notify, so the SSE half is skipped —
 * that is the only case where a channel is legitimately silent.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { emitCanvasUpdated } from '../streaming/sse-handler';
import type { CanvasRecord } from './canvas-store';

/** Who made the change — carried through to both channels for the UI to badge. */
export type CanvasUpdateEditor = 'ai' | 'user';

export interface CanvasUpdateNotifier {
    /** Announce a successful canvas mutation on every realtime channel. */
    canvasUpdated(workspaceId: string, canvas: CanvasRecord, editor: CanvasUpdateEditor): void;
}

export interface CanvasUpdateNotifierDeps {
    /** Resolved lazily: the WS server is not up when routes are registered. */
    getWsServer?: () => ProcessWebSocketServer | undefined;
    /** Absent in contexts with no process timeline (some tests, some embeds). */
    processStore?: ProcessStore;
}

export function createCanvasUpdateNotifier({ getWsServer, processStore }: CanvasUpdateNotifierDeps): CanvasUpdateNotifier {
    return {
        canvasUpdated(workspaceId, canvas, editor) {
            getWsServer?.()?.broadcastProcessEvent({
                type: 'canvas-updated',
                workspaceId,
                canvasId: canvas.id,
                processId: canvas.processId,
                title: canvas.title,
                revision: canvas.revision,
                editor,
                timestamp: Date.now(),
            });
            if (processStore && canvas.processId) {
                emitCanvasUpdated(processStore, canvas.processId, {
                    canvasId: canvas.id,
                    title: canvas.title,
                    revision: canvas.revision,
                    editor,
                });
            }
        },
    };
}
