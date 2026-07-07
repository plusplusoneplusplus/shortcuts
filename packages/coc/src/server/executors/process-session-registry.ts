import type { TimelineItem } from '@plusplusoneplusplus/forge';
import type { AskUserAnswerInput, AskUserAnswerValue } from '../llm-tools/ask-user-tool';
import type { RalphGrillProcessState } from '../ralph/grill-planning';

export interface StreamingTurnState {
    outputBuffer: string;
    timelineBuffer: TimelineItem[];
    throttleState: { chunksSinceLastFlush: number; lastFlushTime: number };
    turnFinalized: boolean;
}

export interface TurnWriteState {
    chain: Promise<void>;
}

export interface InteractiveAskUserHandles {
    answerQuestion: (questionId: string, answer: AskUserAnswerValue) => boolean;
    skipQuestion: (questionId: string) => boolean;
    answerQuestions: (responses: AskUserAnswerInput[]) => boolean;
    cancelAll: () => void;
    hasPending: () => boolean;
}

export interface InteractiveAskUserState {
    handles?: InteractiveAskUserHandles;
}

export interface SuggestionState {
    pendingSuggestions?: string[];
}

export interface RalphGrillState {
    current?: RalphGrillProcessState;
}

interface ProcessSessionEntry {
    streaming: StreamingTurnState;
    writes: TurnWriteState;
    askUser: InteractiveAskUserState;
    suggestions: SuggestionState;
    ralphGrill: RalphGrillState;
}

function createStreamingTurnState(): StreamingTurnState {
    return {
        outputBuffer: '',
        timelineBuffer: [],
        throttleState: { chunksSinceLastFlush: 0, lastFlushTime: 0 },
        turnFinalized: false,
    };
}

function createEntry(ralphGrill?: RalphGrillProcessState): ProcessSessionEntry {
    return {
        streaming: createStreamingTurnState(),
        writes: { chain: Promise.resolve() },
        askUser: {},
        suggestions: {},
        ralphGrill: { current: ralphGrill },
    };
}

export class ProcessSessionRegistry {
    private readonly entries = new Map<string, ProcessSessionEntry>();

    has(processId: string): boolean {
        return this.entries.has(processId);
    }

    getStreaming(processId: string): StreamingTurnState {
        return this.getOrCreateEntry(processId).streaming;
    }

    getStreamingIfPresent(processId: string): StreamingTurnState | undefined {
        return this.entries.get(processId)?.streaming;
    }

    resetStreaming(processId: string): void {
        const entry = this.getOrCreateEntry(processId);
        entry.streaming = createStreamingTurnState();
        entry.suggestions.pendingSuggestions = undefined;
    }

    getTurnWrite(processId: string): TurnWriteState {
        return this.getOrCreateEntry(processId).writes;
    }

    getPendingSuggestions(processId: string): string[] | undefined {
        return this.entries.get(processId)?.suggestions.pendingSuggestions;
    }

    setPendingSuggestions(processId: string, suggestions: string[]): void {
        this.getOrCreateEntry(processId).suggestions.pendingSuggestions = suggestions;
    }

    setAskUserHandles(processId: string, handles: InteractiveAskUserHandles): void {
        this.getOrCreateEntry(processId).askUser.handles = handles;
    }

    getAskUserHandles(processId: string): InteractiveAskUserHandles | undefined {
        return this.entries.get(processId)?.askUser.handles;
    }

    clearAskUserHandles(processId: string): void {
        const entry = this.entries.get(processId);
        if (entry) entry.askUser.handles = undefined;
    }

    cancelAskUserHandles(processId: string): void {
        this.getAskUserHandles(processId)?.cancelAll();
        this.clearAskUserHandles(processId);
    }

    getRalphGrillState(processId: string): RalphGrillProcessState | undefined {
        return this.entries.get(processId)?.ralphGrill.current;
    }

    setRalphGrillState(processId: string, state: RalphGrillProcessState | undefined): void {
        this.getOrCreateEntry(processId).ralphGrill.current = state;
    }

    cleanupTurn(processId: string): void {
        const ralphGrill = this.getRalphGrillState(processId);
        if (!ralphGrill) {
            this.entries.delete(processId);
            return;
        }

        this.entries.set(processId, createEntry(ralphGrill));
    }

    private getOrCreateEntry(processId: string): ProcessSessionEntry {
        let entry = this.entries.get(processId);
        if (!entry) {
            entry = createEntry();
            this.entries.set(processId, entry);
        }
        return entry;
    }
}
