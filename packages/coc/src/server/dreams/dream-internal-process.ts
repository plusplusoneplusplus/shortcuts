import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';

export type DreamInternalProcessPurpose = 'analyzer' | 'critic';

export interface DreamInternalStepRequest {
    purpose: DreamInternalProcessPurpose;
    workspaceId: string;
    runId: string;
    prompt: string;
    systemPrompt: string;
    timeoutMs: number;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    signal?: AbortSignal;
    parentProcessId?: string;
    analyzerProcessId?: string;
    onProcessStarted?: (processId: string) => void;
}

export interface DreamInternalStepResult {
    processId: string;
    response: string;
}

export type DreamInternalStepRunner = (request: DreamInternalStepRequest) => Promise<DreamInternalStepResult>;
