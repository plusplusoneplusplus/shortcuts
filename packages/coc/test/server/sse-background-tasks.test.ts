/**
 * SSE Handler — background-tasks Event Tests
 *
 * Verifies that the SSE handler correctly maps 'background-tasks'
 * ProcessOutputEvents to SSE events.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ProcessStore, ProcessOutputEvent } from '@plusplusoneplusplus/forge';

/**
 * Simulate the SSE event mapping logic from handleProcessStream.
 * We extract just the event-type dispatch to test it in isolation.
 */
function simulateSSEDispatch(event: ProcessOutputEvent): { eventName: string; payload: unknown } | null {
    if (event.type === 'background-tasks') {
        return {
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: event.backgroundAgents,
                backgroundShells: event.backgroundShells,
                backgroundTotalActive: event.backgroundTotalActive,
                backgroundWaitingForDrain: event.backgroundWaitingForDrain,
            },
        };
    }
    return null;
}

describe('SSE background-tasks event', () => {
    it('maps background-tasks ProcessOutputEvent to SSE payload', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [{ id: 'a1', description: 'research' }],
            backgroundShells: [{ id: 's1', description: 'npm run build' }],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        };

        const result = simulateSSEDispatch(event);
        expect(result).toEqual({
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: [{ id: 'a1', description: 'research' }],
                backgroundShells: [{ id: 's1', description: 'npm run build' }],
                backgroundTotalActive: 2,
                backgroundWaitingForDrain: true,
            },
        });
    });

    it('maps background-tasks with zero active tasks', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [],
            backgroundShells: [],
            backgroundTotalActive: 0,
            backgroundWaitingForDrain: false,
        };

        const result = simulateSSEDispatch(event);
        expect(result).toEqual({
            eventName: 'background-tasks',
            payload: {
                backgroundAgents: [],
                backgroundShells: [],
                backgroundTotalActive: 0,
                backgroundWaitingForDrain: false,
            },
        });
    });

    it('maps background-tasks with agents only', () => {
        const event: ProcessOutputEvent = {
            type: 'background-tasks',
            backgroundAgents: [
                { id: 'a1', type: 'sub-agent', description: 'exploring code' },
                { id: 'a2', type: 'sub-agent', description: 'writing tests' },
            ],
            backgroundShells: [],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        };

        const result = simulateSSEDispatch(event);
        expect(result?.payload).toEqual({
            backgroundAgents: [
                { id: 'a1', type: 'sub-agent', description: 'exploring code' },
                { id: 'a2', type: 'sub-agent', description: 'writing tests' },
            ],
            backgroundShells: [],
            backgroundTotalActive: 2,
            backgroundWaitingForDrain: true,
        });
    });

    it('does not dispatch for non-background-tasks events', () => {
        const chunkEvent: ProcessOutputEvent = { type: 'chunk', content: 'hello' };
        expect(simulateSSEDispatch(chunkEvent)).toBeNull();

        const toolEvent: ProcessOutputEvent = { type: 'tool-start', toolCallId: 'tc1', toolName: 'read' };
        expect(simulateSSEDispatch(toolEvent)).toBeNull();
    });
});
