/**
 * Tests for StreamingStateMachine
 *
 * Verifies all state transitions and guards for the pure state machine.
 */

import { describe, it, expect } from 'vitest';
import { StreamingStateMachine, StreamingState } from '../../src/streaming-state-machine';

describe('StreamingStateMachine', () => {
    it('starts in Idle state', () => {
        const sm = new StreamingStateMachine();
        expect(sm.state).toBe(StreamingState.Idle);
        expect(sm.isStreaming).toBe(false);
        expect(sm.isTerminal).toBe(false);
    });

    it('transitions Idle → Streaming on start()', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        expect(sm.state).toBe(StreamingState.Streaming);
        expect(sm.isStreaming).toBe(true);
        expect(sm.isTerminal).toBe(false);
    });

    it('throws if start() called twice', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        expect(() => sm.start()).toThrow('can only be called once');
    });

    it('transitions Streaming → Settled on settle()', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        expect(sm.settle()).toBe(true);
        expect(sm.state).toBe(StreamingState.Settled);
        expect(sm.isStreaming).toBe(false);
        expect(sm.isTerminal).toBe(true);
    });

    it('transitions Streaming → Cancelled on cancel()', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        expect(sm.cancel()).toBe(true);
        expect(sm.state).toBe(StreamingState.Cancelled);
        expect(sm.isStreaming).toBe(false);
        expect(sm.isTerminal).toBe(true);
    });

    it('settle() returns false when already Settled', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        sm.settle();
        expect(sm.settle()).toBe(false);
    });

    it('cancel() returns false when already Settled', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        sm.settle();
        expect(sm.cancel()).toBe(false);
    });

    it('settle() returns false when already Cancelled', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        sm.cancel();
        expect(sm.settle()).toBe(false);
    });

    it('cancel() returns false when already Cancelled', () => {
        const sm = new StreamingStateMachine();
        sm.start();
        sm.cancel();
        expect(sm.cancel()).toBe(false);
    });

    it('settle() returns false from Idle (not started)', () => {
        const sm = new StreamingStateMachine();
        expect(sm.settle()).toBe(false);
    });

    it('cancel() returns false from Idle (not started)', () => {
        const sm = new StreamingStateMachine();
        expect(sm.cancel()).toBe(false);
    });
});
