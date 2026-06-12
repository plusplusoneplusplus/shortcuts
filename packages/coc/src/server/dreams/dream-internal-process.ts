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

/**
 * Provenance for the bundled skill section that supplied a dream step's system
 * prompt. Persisted on `proc.metadata.dreamStep.skill` so history/audit can see
 * that the analyzer/critic prompts are sourced from the `dream` skill rather
 * than inline constants.
 */
export interface DreamStepSkillProvenance {
    name: string;
    section: DreamInternalProcessPurpose;
}

/**
 * Groupable subset of a dream internal step's persisted metadata
 * (`proc.metadata.dreamStep`). The posture flags are constant by construction:
 * dream steps are always read-only, tool-less, MCP-less, deny-all.
 */
export interface DreamStepContext {
    kind: DreamInternalProcessPurpose;
    purpose: string;
    workspaceId: string;
    runId: string;
    readOnly: true;
    toolsEnabled: false;
    mcpEnabled: false;
    permissionPolicy: 'deny-all';
    timeoutMs: number;
    skill: DreamStepSkillProvenance;
    parentProcessId?: string;
    analyzerProcessId?: string;
}
