/**
 * StreamingStateMachine — pure state machine for streaming session lifecycle.
 *
 * States: Idle → Streaming → Settled | Cancelled
 *
 * No I/O, no timers, no SDK dependency. Fully unit-testable.
 */

// ============================================================================
// State enum (re-exported from streaming-session.ts for backward compatibility)
// ============================================================================

export const enum StreamingState {
    Idle      = 'Idle',
    Streaming = 'Streaming',
    Settled   = 'Settled',
    Cancelled = 'Cancelled',
}

// ============================================================================
// StreamingStateMachine
// ============================================================================

export class StreamingStateMachine {
    private _state: StreamingState = StreamingState.Idle;

    get state(): StreamingState {
        return this._state;
    }

    get isStreaming(): boolean {
        return this._state === StreamingState.Streaming;
    }

    get isTerminal(): boolean {
        return this._state === StreamingState.Settled || this._state === StreamingState.Cancelled;
    }

    /**
     * Transition from Idle → Streaming.
     * @throws if current state is not Idle.
     */
    start(): void {
        if (this._state !== StreamingState.Idle) {
            throw new Error('StreamingSession.run() can only be called once per instance');
        }
        this._state = StreamingState.Streaming;
    }

    /**
     * Transition from Streaming → Settled.
     * @returns true if the transition occurred, false if already terminal.
     */
    settle(): boolean {
        if (this._state !== StreamingState.Streaming) { return false; }
        this._state = StreamingState.Settled;
        return true;
    }

    /**
     * Transition from Streaming → Cancelled.
     * @returns true if the transition occurred, false if already terminal.
     */
    cancel(): boolean {
        if (this._state !== StreamingState.Streaming) { return false; }
        this._state = StreamingState.Cancelled;
        return true;
    }
}
