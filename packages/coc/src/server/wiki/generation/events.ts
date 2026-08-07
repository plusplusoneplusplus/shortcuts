/**
 * Wiki Generation Events
 *
 * Typed events emitted by the generation runners. Runners never touch HTTP —
 * they emit these events and a sink decides where they go. The SSE sink maps
 * them onto the existing wire format one-to-one, so the admin UI sees exactly
 * the same payloads it did when the handler wrote SSE inline.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type * as http from 'http';
import { sendSSE } from '../ask-handler';

// ============================================================================
// Event Types
// ============================================================================

export interface GenerationStatusEvent {
    type: 'status';
    phase?: number;
    state: string;
    componentId?: string;
    message: string;
}

export interface GenerationLogEvent {
    type: 'log';
    phase?: number;
    message: string;
}

export interface GenerationPhaseCompleteEvent {
    type: 'phase-complete';
    phase: number;
    success: boolean;
    duration: number;
    message: string;
}

export interface GenerationErrorEvent {
    type: 'error';
    phase?: number;
    message: string;
}

export interface GenerationDoneEvent {
    type: 'done';
    success: boolean;
    componentId?: string;
    duration?: number;
    message?: string;
    error?: string;
}

export type GenerationEvent =
    | GenerationStatusEvent
    | GenerationLogEvent
    | GenerationPhaseCompleteEvent
    | GenerationErrorEvent
    | GenerationDoneEvent;

/** Receives generation events. Returns false when the consumer is gone. */
export type GenerationEventSink = (event: GenerationEvent) => boolean;

// ============================================================================
// Sinks
// ============================================================================

/**
 * Map generation events onto the SSE wire format.
 *
 * Keys absent from the event object are omitted from the payload, which keeps
 * the emitted JSON byte-identical to the previous inline `sendSSE` calls.
 */
export function createSseEventSink(res: http.ServerResponse): GenerationEventSink {
    return (event: GenerationEvent) => {
        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(event)) {
            if (value !== undefined) {
                payload[key] = value;
            }
        }
        return sendSSE(res, payload);
    };
}

/** Collect events in an array. Useful for tests and non-HTTP callers. */
export function createRecordingEventSink(target: GenerationEvent[]): GenerationEventSink {
    return (event: GenerationEvent) => {
        target.push(event);
        return true;
    };
}
